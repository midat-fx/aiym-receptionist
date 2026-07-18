import { getActiveServices, getResources, type BusinessRow, type ConversationRow, type ServiceRow } from "./db";
import {
  getHistory,
  getOffered,
  saveConversation,
  type HistoryMsg,
} from "./conversation";
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
  _ctx: ExecutionContext,
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
    reply = await deterministicFallback(env, business, services, now);
  }

  history.push({ role: "model", text: reply });
  await saveConversation(env.DB, convo, {
    history,
    lastOffered: dctx.lastOffered,
    clientName: dctx.clientName ?? convo.client_name,
    clientPhone: dctx.clientPhone ?? convo.client_phone,
  });

  return { reply, events: dctx.events, handoffReason: dctx.handoffReason };
}
