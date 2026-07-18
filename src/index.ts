import { handleAdmin } from "./admin";
import { handleTurn } from "./chat";
import { ensureConversation } from "./conversation";
import { sha256hex } from "./crypto";
import { getBusinessByBotId, getBusinessBySlug, type BusinessRow } from "./db";
import { seenBefore } from "./dedup";
import { resetDemo } from "./demoReset";
import type { Env } from "./env";
import { todayInTz } from "./engine/time";
import { markdownToTelegramHtml, splitMessage } from "./format";
import { checkAndIncrement } from "./limits";
import { MAIN_KEYBOARD, Telegram } from "./telegram";
import { transcribeVoice } from "./voice/stt";
import { synthesizeVoice } from "./voice/tts";
import { handleChat, handleConfig, handleOwnerFeed, handleSlots } from "./web";

interface TgChat {
  id: number;
}
interface TgVoice {
  file_id: string;
  duration: number;
}
interface TgMessage {
  chat: TgChat;
  text?: string;
  voice?: TgVoice;
}
interface TgUpdate {
  update_id?: number;
  message?: TgMessage;
}

const NOT_IMPL = (stage: string) =>
  new Response(`Not implemented yet (${stage})`, { status: 501, headers: { "content-type": "text/plain; charset=utf-8" } });

const utcDay = (): string => new Date().toISOString().slice(0, 10);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (method === "GET" && pathname === "/") {
      return Response.redirect(new URL("/landing", url).toString(), 302);
    }
    if (method === "POST" && pathname.startsWith("/tg/")) {
      return handleTgWebhook(request, env, ctx);
    }
    if (method === "POST" && pathname === "/chat") {
      return handleChat(request, env, ctx);
    }
    if (method === "GET" && pathname === "/api/slots") {
      return handleSlots(request, env);
    }
    if (method === "GET" && pathname === "/api/demo/owner-feed") {
      return handleOwnerFeed(request, env);
    }
    if (method === "GET" && pathname === "/api/demo/config") {
      return handleConfig(request, env);
    }
    if (method === "GET" && pathname === "/api/tg/setup") {
      return handleTgSetup(request, env);
    }
    if (pathname.startsWith("/admin/api/")) {
      return handleAdmin(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // Nightly demo reset (cron 0 22 * * * UTC = 03:00 Almaty).
    try {
      await resetDemo(env.DB);
    } catch (e) {
      console.error("scheduled resetDemo failed:", (e as Error).message);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleTgWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  // Telegram authenticates itself with the secret_token set at setWebhook time.
  if (request.headers.get("x-telegram-bot-api-secret-token") !== env.WEBHOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  const botId = Number(new URL(request.url).pathname.split("/")[2]);
  if (!Number.isFinite(botId)) return new Response("Bad request", { status: 400 });

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const message = update.message;
  if (message?.chat && typeof update.update_id === "number") {
    // Answer instantly; do slow work in waitUntil so Telegram doesn't retry.
    if (!(await seenBefore(botId, update.update_id))) {
      ctx.waitUntil(
        processTgMessage(env, botId, message, ctx).catch((e: unknown) =>
          console.error("tg process crashed:", (e as Error).stack ?? e),
        ),
      );
    }
  }
  return new Response("ok");
}

async function sendReply(tg: Telegram, chatId: number, text: string): Promise<void> {
  for (const part of splitMessage(text)) {
    const html = markdownToTelegramHtml(part);
    try {
      await tg.sendMessage(chatId, html, { parse_mode: "HTML", disable_link_preview: true });
    } catch {
      await tg.sendMessage(chatId, part);
    }
  }
}

async function processTgMessage(env: Env, botId: number, message: TgMessage, ctx: ExecutionContext): Promise<void> {
  const business = await getBusinessByBotId(env.DB, botId);
  if (!business?.tg_bot_token) return; // unknown / unconfigured bot
  const tg = new Telegram(business.tg_bot_token);
  const chatId = message.chat.id;

  if (message.voice) {
    return processVoice(env, business, tg, chatId, message.voice, ctx);
  }

  const text = message.text?.trim();
  if (!text) {
    await tg.sendMessage(chatId, "Пока я понимаю только текстовые и голосовые сообщения 🙏");
    return;
  }
  if (text === "/start") {
    await tg.sendMessage(
      chatId,
      `Здравствуйте! Я ${business.assistant_name}, администратор «${business.name}». Помогу записаться, подскажу цены и свободное время. Что вас интересует?`,
      { reply_markup: MAIN_KEYBOARD },
    );
    return;
  }
  if (text.startsWith("/owner")) {
    const token = text.slice("/owner".length).trim();
    if (!token) {
      await tg.sendMessage(chatId, "Чтобы получать записи сюда, отправьте: /owner <ваш админ-токен>");
      return;
    }
    if ((await sha256hex(token)) === business.admin_token_hash) {
      await env.DB.prepare("UPDATE businesses SET owner_tg_chat_id = ? WHERE id = ?").bind(chatId, business.id).run();
      await tg.sendMessage(chatId, "Готово ✓ Уведомления о новых записях и заявках будут приходить сюда.");
    } else {
      await tg.sendMessage(chatId, "Токен не подошёл. Проверьте и отправьте ещё раз.");
    }
    return;
  }

  await respondTurn(env, business, tg, chatId, text, ctx, false);
}

/** Transcribe a voice note (with limits + degradation), then run the turn with a spoken reply. */
async function processVoice(
  env: Env,
  business: BusinessRow,
  tg: Telegram,
  chatId: number,
  voice: TgVoice,
  ctx: ExecutionContext,
): Promise<void> {
  if (voice.duration > 60) {
    await tg.sendMessage(chatId, "Голосовое длинновато — пришлите, пожалуйста, покороче 🙏");
    return;
  }
  const whisper = await checkAndIncrement(env.DB, "whisper", "global", utcDay(), 100);
  if (!whisper.ok) {
    await tg.sendMessage(chatId, "Не расслышала 😅 Напишите, пожалуйста, текстом.");
    return;
  }
  await tg.sendChatAction(chatId).catch(() => {});
  const stt = await transcribeVoice(env, tg, voice.file_id, voice.duration);
  if (!stt.ok) {
    await tg.sendMessage(chatId, "Не расслышала 😅 Напишите, пожалуйста, текстом.");
    return;
  }
  // Transparency: echo what was heard before answering.
  await tg.sendMessage(chatId, `🎙 «${stt.text}»`);
  await respondTurn(env, business, tg, chatId, stt.text, ctx, true);
}

/** Shared turn: message limits -> handleTurn -> text reply -> (voice) spoken reply. */
async function respondTurn(
  env: Env,
  business: BusinessRow,
  tg: Telegram,
  chatId: number,
  userText: string,
  ctx: ExecutionContext,
  voice: boolean,
): Promise<void> {
  const day = todayInTz(business.tz, new Date());
  const globalLimit = await checkAndIncrement(env.DB, "global_msg", String(business.id), utcDay(), 300);
  if (!globalLimit.ok) {
    await tg.sendMessage(chatId, "Сегодня необычно много сообщений — вернусь чуть позже 🙏");
    return;
  }
  const chatLimit = await checkAndIncrement(env.DB, "chat", `${business.id}:${chatId}`, day, 20);
  if (!chatLimit.ok) {
    await tg.sendMessage(chatId, "На сегодня достаточно сообщений — напишите, пожалуйста, завтра 🙏");
    return;
  }
  if (voice) {
    const voiceLimit = await checkAndIncrement(env.DB, "voice", `${business.id}:${chatId}`, day, 5);
    if (!voiceLimit.ok) {
      await tg.sendMessage(chatId, "На сегодня достаточно голосовых 🙏 Давайте продолжим текстом.");
      return;
    }
  }

  await tg.sendChatAction(chatId).catch(() => {});
  const convo = await ensureConversation(env.DB, business.id, "tg", String(chatId));
  const { reply } = await handleTurn(env, business, convo, userText, ctx);
  await sendReply(tg, chatId, reply);

  if (voice) {
    await tg.sendChatAction(chatId, "record_voice").catch(() => {});
    const audio = await synthesizeVoice(env, reply);
    if (audio) {
      const spoken = reply.slice(0, 160);
      const caption = `${spoken}${reply.length > 160 ? "…" : ""}\nголос: elevenlabs.io`;
      await tg.sendVoice(chatId, audio, caption).catch((e: unknown) => console.error("sendVoice failed:", (e as Error).message));
    }
  }
}

/** One-visit webhook registration: GET /api/tg/setup?secret=<WEBHOOK_SECRET>&biz=<slug>. */
async function handleTgSetup(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!env.WEBHOOK_SECRET || url.searchParams.get("secret") !== env.WEBHOOK_SECRET) {
    return Response.json({ ok: false, error: "pass ?secret=<WEBHOOK_SECRET>" }, { status: 403 });
  }
  const slug = url.searchParams.get("biz") ?? "";
  const business = await getBusinessBySlug(env.DB, slug);
  if (!business) return Response.json({ ok: false, error: `no business '${slug}'` }, { status: 404 });
  if (!business.tg_bot_token || business.tg_bot_id == null) {
    return Response.json({ ok: false, error: "business has no tg_bot_token/tg_bot_id set" }, { status: 400 });
  }
  const tg = new Telegram(business.tg_bot_token);
  try {
    const webhook = `${url.origin}/tg/${business.tg_bot_id}`;
    await tg.setWebhook(webhook, env.WEBHOOK_SECRET);
    return Response.json({ ok: true, webhook, next: "Message the bot on Telegram" });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 502 });
  }
}
