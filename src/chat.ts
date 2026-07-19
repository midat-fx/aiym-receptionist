import { parseCrmConfig } from "./config";
import {
  getHistory,
  getOffered,
  saveConversation,
  type HistoryMsg,
} from "./conversation";
import { dispatchCrm } from "./crm/adapter";
import { getActiveServices, getResources, type BusinessRow, type ConversationRow, type ServiceRow } from "./db";
import { checkAvailability } from "./engine/slots";
import { addDays, todayInTz } from "./engine/time";
import type { Env } from "./env";
import { runConversation } from "./llm/gemini";
import { buildNowInfo, buildSystemPrompt } from "./llm/prompt";
import { dispatchTool, type DispatchContext, type TurnEvent } from "./llm/tools";

export type { TurnEvent };

export interface TurnResult {
  reply: string;
  events: TurnEvent[];
  handoffReason?: string;
}

/**
 * Past-tense claims that a booking already exists. Present/future offers
 * («запишу вас на 16:00?») must NOT match — only assertions of a done deed.
 */
const CLAIMS_BOOKED = /записал[аи]?\s+вас|вы\s+записан|запись\s+подтвержден|жд[ёе]м\s+вас\s+в\s+\d/i;

/** Compose a confirmation from what the engine actually wrote, with no LLM involved. */
function writeConfirmation(dctx: DispatchContext): string | null {
  if (!dctx.bookingConfirmed || !dctx.lastConfirmation) return null;
  const who = dctx.clientName ? `${dctx.clientName}, ` : "";
  return `${who}записала вас: ${dctx.lastConfirmation.service}, ${dctx.lastConfirmation.label}. Ждём вас!`;
}

/** Gemini-down degradation (§9.7): a real reply with tomorrow's free slots, no LLM. */
async function deterministicFallback(
  env: Env,
  business: BusinessRow,
  services: ServiceRow[],
  now: Date,
): Promise<string> {
  const svc = services[0];
  if (!svc) return "Извините, я сейчас не могу ответить. Напишите, пожалуйста, чуть позже 🙏";
  const tomorrow = addDays(todayInTz(business.tz, now), 1);
  const slots = await checkAvailability(env.DB, business.id, svc.id, tomorrow, tomorrow, "any", now).catch(() => []);
  if (slots.length === 0) return "Секунду, уточню свободное время у администратора 🙏";
  const labels = slots.slice(0, 3).map((s) => s.label).join("; ");
  return `Похоже, я на секунду задумалась 🙏 Из ближайшего свободного на завтра: ${labels}. Подскажите, что вас интересует?`;
}

/**
 * The single entry point for TG text, TG voice (already transcribed) and web chat.
 * Runs the Gemini function-calling loop against the deterministic engine, persists
 * the conversation, and returns the reply plus any booking events.
 */
export async function handleTurn(
  env: Env,
  business: BusinessRow,
  convo: ConversationRow,
  userText: string,
  ctx: ExecutionContext,
): Promise<TurnResult> {
  const services = await getActiveServices(env.DB, business.id);
  const resources = await getResources(env.DB, business.id);
  const now = new Date();
  const systemPrompt = buildSystemPrompt(business, services, resources, buildNowInfo(business.tz, now));

  const history: HistoryMsg[] = getHistory(convo);
  history.push({ role: "user", text: userText });

  const dctx: DispatchContext = {
    db: env.DB,
    business,
    services,
    resources,
    now,
    channel: convo.channel === "web" ? "web" : "tg",
    tgChatId: convo.channel === "tg" ? Number(convo.external_id) : undefined,
    webSessionId: convo.channel === "web" ? convo.external_id : undefined,
    lastOffered: getOffered(convo),
    events: [],
    crmEvents: [],
    clientName: convo.client_name ?? undefined,
    clientPhone: convo.client_phone ?? undefined,
  };

  let reply: string;
  try {
    const result = await runConversation(env, systemPrompt, history, (name, args) => dispatchTool(dctx, name, args));
    reply = result.reply;
    if (result.handoff && !dctx.handoffReason) dctx.handoffReason = "ассистент не смог помочь";
  } catch (e) {
    console.error("gemini turn failed:", (e as Error).message);
    // If the engine already wrote to the calendar, NEVER fall back to «предлагаю время» —
    // that would deny a booking that actually exists. Confirm it from the recorded event.
    reply = writeConfirmation(dctx) ?? (await deterministicFallback(env, business, services, now));
  }

  // The engine is the only source of truth about the calendar: if it did not confirm a
  // booking this turn, the assistant must not claim (past tense) that one exists.
  if (!dctx.bookingConfirmed && CLAIMS_BOOKED.test(reply)) {
    console.error("blocked a phantom booking confirmation:", reply.slice(0, 120));
    reply = "Секунду, уточню и подтвержу запись 🙏";
    if (!dctx.handoffReason) dctx.handoffReason = "модель подтвердила запись, которой нет";
  }

  history.push({ role: "model", text: reply });
  await saveConversation(env.DB, convo, {
    history,
    lastOffered: dctx.lastOffered,
    clientName: dctx.clientName ?? convo.client_name,
    clientPhone: dctx.clientPhone ?? convo.client_phone,
  });

  // Fan out to CRM adapters (each push is isolated; a CRM failure never affects the reply).
  if (dctx.crmEvents.length) {
    const crmCfg = parseCrmConfig(business.crm_config);
    for (const ev of dctx.crmEvents) dispatchCrm(ev, crmCfg, env, ctx);
  }
  // Handoff to a human is surfaced to the owner as a lead-style ping («📝 Заявка»),
  // never as a cancellation — the owner would hunt for a booking that never existed.
  if (dctx.handoffReason) {
    dispatchCrm(
      { type: "lead_created", business_id: business.id, summary: `Нужен человек: ${dctx.handoffReason}` },
      parseCrmConfig(business.crm_config),
      env,
      ctx,
    );
  }

  return { reply, events: dctx.events, handoffReason: dctx.handoffReason };
}
