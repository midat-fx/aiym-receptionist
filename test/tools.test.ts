import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getActiveServices, getBusinessBySlug, getResources, type BusinessRow, type ResourceRow, type ServiceRow } from "../src/db";
import { localToTs } from "../src/engine/time";
import { dispatchTool, normalizePhone, type DispatchContext } from "../src/llm/tools";
import { applySchemaAndSeed } from "./sql";

const TZ = "Asia/Almaty";
const DAY = "2026-07-20"; // Monday
const NOW = new Date("2026-07-20T04:00:00Z"); // 09:00 Almaty
const MANI = 6;

let business: BusinessRow;
let services: ServiceRow[];
let resources: ResourceRow[];

function makeCtx(overrides: Partial<DispatchContext> = {}): DispatchContext {
  return {
    db: env.DB,
    business,
    services,
    resources,
    now: NOW,
    channel: "tg",
    tgChatId: 5001,
    lastOffered: [],
    events: [],
    crmEvents: [],
    ...overrides,
  };
}

async function count(sql: string, ...binds: unknown[]): Promise<number> {
  const row = await env.DB.prepare(sql)
    .bind(...binds)
    .first<{ n: number }>();
  return row?.n ?? 0;
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

describe("dispatchTool", () => {
  it("refuses bookSlot when nothing has been offered yet", async () => {
    const ctx = makeCtx();
    const r = await dispatchTool(ctx, "bookSlot", { service_id: MANI, slot_start: `${DAY}T15:00`, client_name: "Айгуль" });
    expect(r.error).toBeTruthy();
    expect(await count("SELECT count(*) AS n FROM bookings")).toBe(0);
  });

  it("refuses a bookSlot whose start is not among the offered slots", async () => {
    const ctx = makeCtx();
    await dispatchTool(ctx, "checkFreeSlots", { service_id: MANI, from_date: DAY, to_date: DAY });
    const r = await dispatchTool(ctx, "bookSlot", { service_id: MANI, slot_start: `${DAY}T15:15`, client_name: "Айгуль" });
    expect(r.error).toBeTruthy();
    expect(await count("SELECT count(*) AS n FROM bookings")).toBe(0);
  });

  it("books through the valid flow and records a booking_created event", async () => {
    const ctx = makeCtx();
    const offered = await dispatchTool(ctx, "checkFreeSlots", { service_id: MANI, from_date: DAY, to_date: DAY });
    expect((offered.slots as Array<{ start: string }>).some((s) => s.start === `${DAY}T15:00`)).toBe(true);
    const r = await dispatchTool(ctx, "bookSlot", { service_id: MANI, slot_start: `${DAY}T15:00`, client_name: "Салтанат" });
    expect(r.ok).toBe(true);
    expect((r.confirmation as { service: string }).service).toBe("Маникюр с гель-лаком");
    expect(ctx.events).toContainEqual({ type: "booking_created" });
    expect(await count("SELECT count(*) AS n FROM bookings WHERE start_ts = ? AND status = 'confirmed'", localToTs(`${DAY}T15:00`, TZ))).toBe(1);
  });

  it("saves a qualifyLead into the leads table", async () => {
    const ctx = makeCtx();
    const r = await dispatchTool(ctx, "qualifyLead", { service: "свадебный макияж", summary: "Хочет макияж на выезд в субботу" });
    expect(r.ok).toBe(true);
    expect(await count("SELECT count(*) AS n FROM leads WHERE business_id = ?", business.id)).toBe(1);
  });

  it("rejects garbage arguments (unknown service_id)", async () => {
    const ctx = makeCtx();
    const r = await dispatchTool(ctx, "checkFreeSlots", { service_id: 999, from_date: DAY, to_date: DAY });
    expect(r.error).toBe("unknown_service");
    const r2 = await dispatchTool(ctx, "bookSlot", { service_id: 999, slot_start: "nonsense", client_name: "" });
    expect(r2.error).toBeTruthy();
  });

  it("normalizes Kazakhstan phone numbers", async () => {
    expect(normalizePhone("8 701 123 45 67")).toBe("+77011234567");
    expect(normalizePhone("+7 701 123 45 67")).toBe("+77011234567");
    expect(normalizePhone("77011234567")).toBe("+77011234567");
    expect(normalizePhone("не скажу")).toBe("не скажу");

    const ctx = makeCtx();
    await dispatchTool(ctx, "checkFreeSlots", { service_id: MANI, from_date: DAY, to_date: DAY });
    await dispatchTool(ctx, "bookSlot", { service_id: MANI, slot_start: `${DAY}T15:00`, client_name: "Мадина", client_phone: "8 701 123 45 67" });
    const row = await env.DB.prepare("SELECT client_phone FROM bookings WHERE tg_chat_id = 5001 AND status = 'confirmed'").first<{ client_phone: string }>();
    expect(row?.client_phone).toBe("+77011234567");
  });
});
