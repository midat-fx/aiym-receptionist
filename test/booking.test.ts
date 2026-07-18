import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { book, cancel } from "../src/engine/booking";
import { checkAvailability } from "../src/engine/slots";
import { localToTs } from "../src/engine/time";
import { applySchemaAndSeed } from "./sql";

const TZ = "Asia/Almaty";
const DAY = "2026-07-20"; // Monday, 10:00–20:00
const NOW = new Date("2026-07-20T04:00:00Z"); // 09:00 Almaty
const at = (hhmm: string) => localToTs(`${DAY}T${hhmm}`, TZ);

const MANI = 6; // Маникюр 90′, Инна (resource 2)
const ZHENSKAYA = 1; // Женская стрижка 60′, Айгерим (resource 1)
const OKRASH = 4; // Окрашивание 150′, Айгерим (resource 1)
const MUZHSKAYA = 2; // Мужская стрижка 30′, Айгерим (resource 1)

const tgClient = (name: string, tgChatId: number) => ({ name, channel: "tg" as const, tgChatId });

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

beforeAll(async () => {
  await applySchemaAndSeed();
});

// Reset the mutable tables between tests (per-test storage isolation is not
// relied upon); business/resources/services from the seed stay.
beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM booking_cells"),
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM leads"),
    env.DB.prepare("DELETE FROM conversations"),
    env.DB.prepare("DELETE FROM rate_limits"),
  ]);
});

describe("book — sacred principle", () => {
  it("writes N cells for a multi-cell booking (90′ -> 3 cells)", async () => {
    const r = await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("Салтанат", 111) }, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.booking.status).toBe("confirmed");
      expect(r.booking.resource_id).toBe(2);
      expect(r.booking.end_ts).toBe(at("15:00") + 90 * 60);
    }
    const cells = await env.DB.prepare(
      "SELECT cell_ts FROM booking_cells WHERE business_id = 1 AND resource_id = 2 ORDER BY cell_ts",
    ).all<{ cell_ts: number }>();
    expect(cells.results.map((c) => c.cell_ts)).toEqual([at("15:00"), at("15:30"), at("16:00")]);
  });

  it("two concurrent book() on the same slot -> exactly one row, the other gets conflict + alternatives", async () => {
    const [a, b] = await Promise.all([
      book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("A", 201) }, NOW),
      book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("B", 202) }, NOW),
    ]);
    expect([a, b].filter((r) => r.ok).length).toBe(1);
    const loser = [a, b].find((r) => !r.ok);
    expect(loser && loser.ok === false && loser.reason).toBe("conflict");
    if (loser && !loser.ok) expect(loser.alternatives.length).toBeGreaterThan(0);
    expect(await count("SELECT count(*) AS n FROM bookings WHERE start_ts = ? AND status = 'confirmed'", at("15:00"))).toBe(1);
  });

  it("a short booking overlapping a long one on the same master -> conflict", async () => {
    expect((await book(env.DB, { bizId: 1, serviceId: OKRASH, startTs: at("10:00"), client: tgClient("Мадина", 301) }, NOW)).ok).toBe(true);
    const clash = await book(env.DB, { bizId: 1, serviceId: MUZHSKAYA, startTs: at("11:00"), client: tgClient("Динара", 302) }, NOW);
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.reason).toBe("conflict");
    // A non-overlapping short booking on the same master still succeeds.
    expect((await book(env.DB, { bizId: 1, serviceId: MUZHSKAYA, startTs: at("13:00"), client: tgClient("Ер", 303) }, NOW)).ok).toBe(true);
  });

  it("the same time on DIFFERENT masters -> both ok", async () => {
    const inna = await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("клиент Инны", 401) }, NOW);
    const aigerim = await book(env.DB, { bizId: 1, serviceId: ZHENSKAYA, startTs: at("15:00"), client: tgClient("клиент Айгерим", 402) }, NOW);
    expect(inna.ok).toBe(true);
    expect(aigerim.ok).toBe(true);
  });

  it("rejects an off-grid time as invalid_slot without writing a row", async () => {
    const r = await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:15"), client: tgClient("Z", 501) }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid_slot");
    expect(await count("SELECT count(*) AS n FROM bookings WHERE start_ts = ?", at("15:15"))).toBe(0);
  });

  it("atomicity: a conflicting attempt leaves exactly one row and its cells only", async () => {
    expect((await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("first", 601) }, NOW)).ok).toBe(true);
    const second = await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("second", 602) }, NOW);
    expect(second.ok).toBe(false);
    expect(await count("SELECT count(*) AS n FROM bookings WHERE start_ts = ? AND status = 'confirmed'", at("15:00"))).toBe(1);
    expect(await count("SELECT count(*) AS n FROM booking_cells WHERE business_id = 1 AND resource_id = 2")).toBe(3);
  });

  it("cancel frees the cells and the slot becomes bookable again", async () => {
    const r = await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("Динара", 701) }, NOW);
    expect(r.ok).toBe(true);
    const c = await cancel(env.DB, { bizId: 1, tgChatId: 701 }, NOW);
    expect(c.ok).toBe(true);
    if (c.ok) expect(c.booking.status).toBe("cancelled");
    if (r.ok) expect(await count("SELECT count(*) AS n FROM booking_cells WHERE booking_id = ?", r.booking.id)).toBe(0);
    const avail = await checkAvailability(env.DB, 1, MANI, DAY, DAY, "any", NOW);
    expect(avail.some((s) => s.startTs === at("15:00"))).toBe(true);
  });

  it("an idempotent repeat by the same client returns already without a duplicate row", async () => {
    expect((await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("Айсулу", 801) }, NOW)).ok).toBe(true);
    const again = await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("Айсулу", 801) }, NOW);
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.already).toBe(true);
    expect(await count("SELECT count(*) AS n FROM bookings WHERE tg_chat_id = 801 AND start_ts = ? AND status = 'confirmed'", at("15:00"))).toBe(1);
    expect(await count("SELECT count(*) AS n FROM booking_cells WHERE business_id = 1 AND resource_id = 2")).toBe(3);
  });

  it("cancel with no active booking -> not_found", async () => {
    const c = await cancel(env.DB, { bizId: 1, tgChatId: 999999 }, NOW);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.reason).toBe("not_found");
  });
});

describe("checkAvailability — occupancy", () => {
  it("subtracts a booked slot from the free grid", async () => {
    await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("занято", 1001) }, NOW);
    const avail = await checkAvailability(env.DB, 1, MANI, DAY, DAY, "any", NOW);
    expect(avail.some((s) => s.startLocal === `${DAY}T15:00`)).toBe(false);
    expect(avail.some((s) => s.startLocal === `${DAY}T13:00`)).toBe(true);
  });

  it("removes only the partially overlapping starts of another service on the same master", async () => {
    await book(env.DB, { bizId: 1, serviceId: OKRASH, startTs: at("10:00"), client: tgClient("окраш", 1002) }, NOW);
    const avail = await checkAvailability(env.DB, 1, ZHENSKAYA, DAY, DAY, "any", NOW);
    expect(avail.some((s) => s.startLocal === `${DAY}T12:00`)).toBe(false); // 12:00 cell held by окрашивание
    expect(avail.some((s) => s.startLocal === `${DAY}T12:30`)).toBe(true); // first free start after the block
  });

  it("does not let one master's booking block another master", async () => {
    await book(env.DB, { bizId: 1, serviceId: MANI, startTs: at("15:00"), client: tgClient("Инна занята", 1003) }, NOW);
    const avail = await checkAvailability(env.DB, 1, ZHENSKAYA, DAY, DAY, "any", NOW);
    expect(avail.some((s) => s.startLocal === `${DAY}T15:00`)).toBe(true);
  });
});
