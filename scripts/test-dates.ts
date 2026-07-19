/**
 * Date-eval (§8 stage 7 / Appendix A): 15 phrases through real Gemini with the
 * production system prompt and a pure generateCandidates dispatcher (no D1).
 * Fixed "now" = Saturday 2026-07-18 14:00 Almaty. NOT run in CI (~30-45 RPD).
 *   GEMINI_API_KEY=... npm run test:dates
 */
import { readFileSync } from "node:fs";
import type { BusinessRow, ResourceRow, ServiceRow } from "../src/db";
import { addDays, todayInTz } from "../src/engine/time";
import { generateCandidates, type PartOfDay } from "../src/engine/slots";
import { buildNowInfo, buildSystemPrompt } from "../src/llm/prompt";
import { toolDeclarations } from "../src/llm/tools";

const TZ = "Asia/Almaty";
const NOW = new Date("2026-07-18T09:00:00Z"); // Saturday 14:00 Almaty
const MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
// Public repo: the local .env fallback must not crash a stranger who just cloned this.
function localKeyFallback(): string {
  try {
    return (readFileSync(`${process.env.HOME}/projects/deka/.env`, "utf8").match(/GEMINI_API_KEY=(.+)/)?.[1] ?? "").trim();
  } catch {
    return "";
  }
}
const KEY = process.env.GEMINI_API_KEY || localKeyFallback();

const business: BusinessRow = {
  id: 1,
  slug: "demo-salon",
  name: "Керемет",
  assistant_name: "Айым",
  address: "ул. Розыбакиева 125, Алматы",
  tz: TZ,
  working_hours: JSON.stringify({
    mon: [["10:00", "20:00"]],
    tue: [["10:00", "20:00"]],
    wed: [["10:00", "20:00"]],
    thu: [["10:00", "20:00"]],
    fri: [["10:00", "20:00"]],
    sat: [["10:00", "20:00"]],
    sun: [["11:00", "18:00"]],
  }),
  slot_step_min: 30,
  buffer_min: 0,
  booking_horizon_days: 14,
  tg_bot_id: null,
  tg_bot_token: null,
  owner_tg_chat_id: null,
  admin_token_hash: "x",
  crm_config: "{}",
  is_demo: 1,
  created_at: "",
};

const resources: ResourceRow[] = [
  { id: 1, business_id: 1, name: "Айгерим", role: "парикмахер-колорист" },
  { id: 2, business_id: 1, name: "Инна", role: "ногтевой сервис" },
  { id: 3, business_id: 1, name: "Жанна", role: "брови, ресницы, депиляция" },
];

const S = (id: number, resource_id: number, name: string, duration_min: number, price_kzt: number | null, price_from = 0): ServiceRow => ({
  id,
  business_id: 1,
  resource_id,
  name,
  duration_min,
  price_kzt,
  price_from,
  is_active: 1,
});
const services: ServiceRow[] = [
  S(1, 1, "Женская стрижка", 60, 6000),
  S(2, 1, "Мужская стрижка", 30, 4000),
  S(3, 1, "Укладка", 30, 5000),
  S(4, 1, "Окрашивание в один тон", 150, 20000, 1),
  S(5, 1, "Сложное окрашивание", 180, 30000, 1),
  S(6, 2, "Маникюр с гель-лаком", 90, 8000),
  S(7, 2, "Педикюр", 90, 10000),
  S(8, 3, "Наращивание ресниц", 120, 10000),
  S(9, 3, "Коррекция и окрашивание бровей", 30, 5000),
  S(10, 3, "Депиляция голеней", 30, 4000),
];

interface FnCall {
  name: string;
  args?: Record<string, unknown>;
}
interface Part {
  text?: string;
  functionCall?: FnCall;
  functionResponse?: { name: string; response: Record<string, unknown> };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gemini(body: unknown, attempt = 0): Promise<Part[]> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 429 && attempt < 3) {
    await sleep(30_000); // respect the per-minute quota, then retry
    return gemini(body, attempt + 1);
  }
  if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Part[] } }> };
  return data.candidates?.[0]?.content?.parts ?? [];
}

function dispatch(name: string, args: Record<string, unknown>): Record<string, unknown> {
  if (name === "checkFreeSlots") {
    const svc = services.find((s) => s.id === Number(args.service_id));
    if (!svc) return { error: "unknown_service" };
    const from = String(args.from_date ?? "");
    const to = String(args.to_date ?? from);
    const partRaw = String(args.part_of_day ?? "any");
    const part = (["any", "morning", "afternoon", "evening"].includes(partRaw) ? partRaw : "any") as PartOfDay;
    let slots = generateCandidates(business, svc, from, to, part, NOW);
    let note: string | undefined;
    if (part !== "any" && slots.length === 0) {
      slots = generateCandidates(business, svc, from, to, "any", NOW);
      note = "requested_part_busy";
    }
    const capped = slots.slice(0, 12);
    const r: Record<string, unknown> = {
      service: svc.name,
      price_line: "—",
      slots: capped.map((s) => ({ start: s.startLocal, label: s.label })),
      more_count: Math.max(0, slots.length - 12),
    };
    const lastDate = addDays(todayInTz(TZ, NOW), business.booking_horizon_days - 1);
    if (from > lastDate) {
      r.note = "beyond_horizon";
      r.horizon_end = lastDate;
    } else if (note) {
      r.note = note;
    }
    return r;
  }
  if (name === "bookSlot") return { ok: true, confirmation: { service: "", label: "", client_name: args.client_name ?? "" } };
  if (name === "cancelBooking") return args.confirm ? { ok: false, reason: "not_found" } : { active_booking: null };
  return { ok: true };
}

async function runPhrase(
  sys: string,
  phrase: string,
  needReply: boolean,
): Promise<{ args?: Record<string, unknown>; reply: string }> {
  const contents: Array<{ role: string; parts: Part[] }> = [{ role: "user", parts: [{ text: phrase }] }];
  const base = {
    system_instruction: { parts: [{ text: sys }] },
    tools: [{ function_declarations: toolDeclarations }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
  };
  let firstArgs: Record<string, unknown> | undefined;
  for (let hop = 0; hop < 3; hop++) {
    const parts = await gemini({ ...base, contents });
    const calls = parts.filter((p) => p.functionCall).map((p) => p.functionCall as FnCall);
    if (calls.length === 0) return { args: firstArgs, reply: parts.map((p) => p.text ?? "").join("").trim() };
    contents.push({ role: "model", parts });
    const respParts: Part[] = [];
    for (const c of calls) {
      const cargs = c.args ?? {};
      if (c.name === "checkFreeSlots" && !firstArgs) firstArgs = cargs;
      respParts.push({ functionResponse: { name: c.name, response: dispatch(c.name, cargs) } });
    }
    // Arg-only cases (all but A10) stop as soon as checkFreeSlots is seen — one call each.
    if (!needReply && firstArgs) return { args: firstArgs, reply: "" };
    contents.push({ role: "user", parts: respParts });
  }
  return { args: firstArgs, reply: "" };
}

type Check = (a: Record<string, unknown> | undefined, reply: string) => boolean;
const from = (a?: Record<string, unknown>) => (a ? String(a.from_date ?? "") : "");
const part = (a?: Record<string, unknown>) => (a ? String(a.part_of_day ?? "any") : "");

// Each phrase names the service (маникюр = id 6) so the eval isolates DATE parsing —
// the date expectations match Appendix A; a service-less phrase legitimately makes
// the assistant ask "which service?" first.
const CASES: Array<{ id: string; phrase: string; check: Check }> = [
  { id: "A1", phrase: "запишите на маникюр завтра к трём", check: (a) => from(a) === "2026-07-19" },
  { id: "A2", phrase: "маникюр послезавтра утром", check: (a) => from(a) === "2026-07-20" && part(a) === "morning" },
  { id: "A3", phrase: "маникюр в пятницу вечером", check: (a) => from(a) === "2026-07-24" && part(a) === "evening" },
  { id: "A4", phrase: "маникюр сегодня после обеда", check: (a) => from(a) === "2026-07-18" && part(a) === "afternoon" },
  { id: "A5", phrase: "маникюр на этой неделе", check: (a) => from(a) === "2026-07-18" },
  { id: "A6", phrase: "маникюр на выходных", check: (a) => from(a) === "2026-07-18" },
  { id: "A7", phrase: "маникюр через час", check: (a) => from(a) === "2026-07-18" },
  { id: "A8", phrase: "маникюр в среду к 10", check: (a) => from(a) === "2026-07-22" },
  { id: "A9", phrase: "маникюр сегодня попозже, часов в шесть", check: (a) => from(a) === "2026-07-18" },
  { id: "A10", phrase: "маникюр первого августа с утра", check: (_a, r) => /31 июля|до 31|14 дн|открыт[аы].*до|позже|за пределами|так далеко/i.test(r) },
  { id: "A11", phrase: "маникюр в следующий вторник", check: (a) => from(a) === "2026-07-21" },
  { id: "A12", phrase: "маникюр к трём", check: (a) => from(a) === "2026-07-18" },
  { id: "A13", phrase: "маникюр утром в понедельник", check: (a) => from(a) === "2026-07-20" && part(a) === "morning" },
  { id: "A14", phrase: "маникюр через недельку", check: (a) => from(a) >= "2026-07-24" && from(a) <= "2026-07-26" },
  { id: "A15", phrase: "маникюр двадцать пятого", check: (a) => from(a) === "2026-07-25" },
];

async function main(): Promise<void> {
  if (!KEY) throw new Error("GEMINI_API_KEY not set");
  const sys = buildSystemPrompt(business, services, resources, buildNowInfo(TZ, NOW));
  let pass = 0;
  const perId: Record<string, boolean> = {};
  for (const c of CASES) {
    let ok = false;
    let detail = "";
    try {
      const { args, reply } = await runPhrase(sys, c.phrase, c.id === "A10");
      ok = c.check(args, reply);
      detail = `from=${from(args)} part=${part(args)}${reply ? ` reply="${reply.slice(0, 70)}"` : ""}`;
    } catch (e) {
      detail = `ERROR ${(e as Error).message}`;
    }
    perId[c.id] = ok;
    if (ok) pass++;
    console.log(`${c.id} ${ok ? "✓" : "✗"} «${c.phrase}» — ${detail}`);
    await sleep(4000); // stay under the per-minute quota
  }
  const gate = pass >= 13 && perId.A10 === true && perId.A11 === true;
  console.log(`\nSCORE ${pass}/15   A10=${perId.A10 ? "✓" : "✗"}  A11=${perId.A11 ? "✓" : "✗"}`);
  console.log(gate ? "PASS ✅ (>=13/15 and A10 & A11 exact)" : "FAIL ❌");
  process.exit(gate ? 0 : 1);
}

void main();
