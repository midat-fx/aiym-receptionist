// Regression net for defects found by the audit (see PLAN.md journal, «Аудит и полировка»).
// Each test pins one previously-shipped bug so it cannot come back.
import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { countActiveBookings, getBusinessBySlug, getActiveServices, getResources, type BusinessRow, type ResourceRow, type ServiceRow } from "../src/db";
import { resetDemo } from "../src/demoReset";
import { cancel, getActiveBooking } from "../src/engine/booking";
import { localToTs } from "../src/engine/time";
import { dispatchTool, type DispatchContext } from "../src/llm/tools";
import { speakable } from "../src/voice/tts";
import { applySchemaAndSeed } from "./sql";

const TZ = "Asia/Almaty";
const DAY = "2026-07-20"; // Monday
const NOW = new Date(localToTs(`${DAY}T14:00`, TZ) * 1000); // 14:00 Almaty
const MANI = 6; // Маникюр 90′, Инна (resource 2)

let business: BusinessRow;
let services: ServiceRow[];
let resources: ResourceRow[];

/** Insert a booking directly — book() refuses past slots, which is exactly what we must simulate. */
async function insertBooking(id: string, startLocal: string, tgChatId: number, durMin = 90): Promise<void> {
  const startTs = localToTs(startLocal, TZ);
  await env.DB.prepare(
    "INSERT INTO bookings (id, business_id, service_id, resource_id, start_ts, end_ts, status, client_name, channel, tg_chat_id) VALUES (?, 1, 6, 2, ?, ?, 'confirmed', 'Тест', 'tg', ?)",
  )
    .bind(id, startTs, startTs + durMin * 60, tgChatId)
    .run();
}

beforeAll(async () => {
  await applySchemaAndSeed();
  business = (await getBusinessBySlug(env.DB, "demo-salon")) as BusinessRow;
  services = await getActiveServices(env.DB, business.id);
  resources = await getResources(env.DB, business.id);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM booking_cells"),
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM leads"),
    env.DB.prepare("DELETE FROM conversations"),
    env.DB.prepare("DELETE FROM rate_limits"),
  ]);
});

describe("F1 — a finished visit is not an active booking", () => {
  it("getActiveBooking skips the past booking and returns the upcoming one", async () => {
    await insertBooking("past", `${DAY}T10:00`, 9001); // ends 11:30, before NOW
    await insertBooking("future", `${DAY}T16:00`, 9001); // ends 17:30, after NOW
    const found = await getActiveBooking(env.DB, { bizId: 1, tgChatId: 9001 }, NOW);
    expect(found?.id).toBe("future");
  });

  it("cancel() never cancels an already-finished visit", async () => {
    await insertBooking("past", `${DAY}T10:00`, 9002);
    const res = await cancel(env.DB, { bizId: 1, tgChatId: 9002 }, NOW);
    expect(res.ok).toBe(false);
    const row = await env.DB.prepare("SELECT status FROM bookings WHERE id = 'past'").first<{ status: string }>();
    expect(row?.status).toBe("confirmed"); // untouched
  });

  it("the owner can still cancel any named booking from the admin panel", async () => {
    await insertBooking("past", `${DAY}T10:00`, 9003);
    const res = await cancel(env.DB, { bizId: 1, bookingId: "past" }, NOW);
    expect(res.ok).toBe(true);
  });

  it("countActiveBookings ignores past visits, so a repeat client is never locked out", async () => {
    await insertBooking("p1", `${DAY}T10:00`, 9004);
    await insertBooking("p2", `${DAY}T11:30`, 9004);
    expect(await countActiveBookings(env.DB, 1, { tgChatId: 9004 }, NOW)).toBe(0);
    await insertBooking("f1", `${DAY}T16:00`, 9004);
    expect(await countActiveBookings(env.DB, 1, { tgChatId: 9004 }, NOW)).toBe(1);
  });
});

describe("F10 — an idempotent repeat must not re-notify the owner", () => {
  it("books once, reports ok twice, emits exactly one CRM event", async () => {
    const ctx: DispatchContext = {
      db: env.DB, business, services, resources, now: NOW, channel: "tg", tgChatId: 9100,
      lastOffered: [], events: [], crmEvents: [],
    };
    await dispatchTool(ctx, "checkFreeSlots", { service_id: MANI, from_date: DAY, to_date: DAY });
    const first = await dispatchTool(ctx, "bookSlot", { service_id: MANI, slot_start: `${DAY}T16:00`, client_name: "Аружан" });
    const second = await dispatchTool(ctx, "bookSlot", { service_id: MANI, slot_start: `${DAY}T16:00`, client_name: "Аружан" });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    // Byte-identical reply keeps the TTS cache hitting (§8 stage 5).
    expect(JSON.stringify(second.confirmation)).toBe(JSON.stringify(first.confirmation));
    expect(ctx.crmEvents.length).toBe(1);
    expect(ctx.events.length).toBe(1);
    // ...but the engine still knows the slot is held, so the assistant may confirm it.
    expect(ctx.bookingConfirmed).toBe(true);
  });
});

describe("F7 — nightly reset must not wipe the monthly ElevenLabs credit counter", () => {
  it("keeps the YYYY-MM row and drops only stale daily rows", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rate_limits (scope,key,day,count) VALUES ('tts_credits','global','2026-07',5000)"),
      env.DB.prepare("INSERT INTO rate_limits (scope,key,day,count) VALUES ('chat','1:old','2026-07-01',9)"),
      env.DB.prepare("INSERT INTO rate_limits (scope,key,day,count) VALUES ('chat','1:new','2026-07-20',1)"),
    ]);
    await resetDemo(env.DB, NOW);
    const credits = await env.DB.prepare("SELECT count FROM rate_limits WHERE scope='tts_credits'").first<{ count: number }>();
    const stale = await env.DB.prepare("SELECT count(*) AS n FROM rate_limits WHERE key='1:old'").first<{ n: number }>();
    const fresh = await env.DB.prepare("SELECT count(*) AS n FROM rate_limits WHERE key='1:new'").first<{ n: number }>();
    expect(credits?.count).toBe(5000); // survived
    expect(stale?.n).toBe(0); // pruned
    expect(fresh?.n).toBe(1); // kept
  });
});

describe("F12 — the voice must not speak markdown or stop mid-word", () => {
  it("strips markdown and emoji", () => {
    expect(speakable("**Аружан**, записала вас 😊 на _маникюр_")).toBe("Аружан, записала вас на маникюр");
  });

  it("cuts on a sentence boundary, never mid-word", () => {
    const long =
      "Аружан, записала вас на маникюр с гель-лаком в эту пятницу, девятнадцатого июля, ровно в пятнадцать ноль-ноль. " +
      "Ждём вас в салоне Керемет по адресу Розыбакиева сто двадцать пять, приходите, пожалуйста, немного заранее.";
    expect(long.length).toBeGreaterThan(160); // the sample must actually need cutting
    const out = speakable(long);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith(".")).toBe(true); // whole sentence, not a severed word
    expect(long.startsWith(out)).toBe(true); // no invented text
  });

  it("leaves a short reply untouched", () => {
    expect(speakable("Записала вас на 15:00.")).toBe("Записала вас на 15:00.");
  });
});
