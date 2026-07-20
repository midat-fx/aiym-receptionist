import { getBusinessBySlug } from "./db";
import type { Env } from "./env";
import { currentCount } from "./limits";
import { Telegram } from "./telegram";

export type HealthLevel = "ok" | "warn" | "fail";

export interface HealthReport {
  status: HealthLevel;
  checks: Array<{ name: string; level: HealthLevel; detail: string }>;
  at: string;
}

const utcDay = (): string => new Date().toISOString().slice(0, 10);
const utcMonth = (): string => new Date().toISOString().slice(0, 7);

const ELEVENLABS_MONTHLY_CAP = 10_000;
const WHISPER_DAILY_CAP = 10_000; // account neurons, shared

/**
 * Cheap self-check: is D1 reachable, are the required secrets present, is the demo
 * seed sane, and is there headroom left on the perishable free-tier budgets?
 * Never returns a secret value — only presence and counts.
 */
export async function healthCheck(env: Env): Promise<HealthReport> {
  const checks: HealthReport["checks"] = [];
  const add = (name: string, level: HealthLevel, detail: string) => checks.push({ name, level, detail });

  // D1 + demo seed in one query.
  try {
    const biz = await getBusinessBySlug(env.DB, "demo-salon");
    if (!biz) add("d1", "fail", "demo-salon row missing");
    else {
      add("d1", "ok", "reachable");
      const svc = await env.DB.prepare("SELECT count(*) AS n FROM services WHERE business_id = ?").bind(biz.id).first<{ n: number }>();
      add("seed", (svc?.n ?? 0) >= 10 ? "ok" : "warn", `${svc?.n ?? 0} services`);
      const cells = await env.DB.prepare("SELECT count(*) AS n FROM booking_cells WHERE business_id = ?").bind(biz.id).first<{ n: number }>();
      // After the nightly reset the demo should carry occupancy; 0 means the seed silently thinned.
      add("demo_occupancy", (cells?.n ?? 0) > 0 ? "ok" : "warn", `${cells?.n ?? 0} booked cells`);
    }
  } catch (e) {
    add("d1", "fail", (e as Error).message.slice(0, 120));
  }

  // Required secrets — presence only.
  const missing = ["GEMINI_API_KEY", "WEBHOOK_SECRET", "TURNSTILE_SECRET_KEY"].filter((k) => !(env as unknown as Record<string, string>)[k]);
  add("secrets", missing.length ? "fail" : "ok", missing.length ? `missing: ${missing.join(", ")}` : "present");

  // Turnstile still on the always-pass test key = no real bot gate.
  add("turnstile", env.TURNSTILE_SITE_KEY.startsWith("1x") ? "warn" : "ok", env.TURNSTILE_SITE_KEY.startsWith("1x") ? "test key (no gate)" : "live key");

  // Perishable budgets. Warn while there is still time to react.
  try {
    const ttsUsed = await currentCount(env.DB, "tts_credits", "global", utcMonth());
    const ttsLeft = ELEVENLABS_MONTHLY_CAP - ttsUsed;
    add("elevenlabs_credits", ttsLeft < 500 ? "warn" : "ok", `${ttsLeft}/${ELEVENLABS_MONTHLY_CAP} left this month`);
    const whisperUsed = await currentCount(env.DB, "whisper", "global", utcDay());
    add("whisper_daily", whisperUsed > WHISPER_DAILY_CAP * 0.8 ? "warn" : "ok", `${whisperUsed} today`);
  } catch (e) {
    add("budgets", "warn", (e as Error).message.slice(0, 120));
  }

  const status: HealthLevel = checks.some((c) => c.level === "fail")
    ? "fail"
    : checks.some((c) => c.level === "warn")
      ? "warn"
      : "ok";
  return { status, checks, at: new Date().toISOString() };
}

/**
 * Run the check and, if anything is wrong, ping the demo tenant's owner in Telegram.
 * Silent when everything is green — an alert channel that cries wolf gets muted.
 */
export async function runHealthAlert(env: Env): Promise<HealthReport> {
  const report = await healthCheck(env);
  if (report.status === "ok") return report;
  try {
    const biz = await getBusinessBySlug(env.DB, "demo-salon");
    if (biz?.tg_bot_token && biz.owner_tg_chat_id != null) {
      const bad = report.checks.filter((c) => c.level !== "ok");
      const icon = report.status === "fail" ? "🔴" : "🟡";
      const text = `${icon} Айым, ночная проверка:\n` + bad.map((c) => `• ${c.name}: ${c.detail}`).join("\n");
      await new Telegram(biz.tg_bot_token).sendMessage(biz.owner_tg_chat_id, text);
    }
  } catch (e) {
    console.error("health alert failed:", (e as Error).message);
  }
  return report;
}
