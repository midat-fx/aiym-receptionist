import { env } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CrmConfig } from "../src/config";
import { dispatchCrm, type CrmEvent } from "../src/crm/adapter";
import { sheetsAdapter } from "../src/crm/sheets";
import type { Env } from "../src/env";
import { applySchemaAndSeed } from "./sql";

const HOOK_URL = "https://script.google.example/macros/s/AKfycb/exec";

const EVENT: CrmEvent = {
  type: "booking_created",
  business_id: 1,
  summary: "Аружан: Маникюр с гель-лаком, сб 19 июля 15:00",
  service: "Маникюр с гель-лаком",
  label: "сб, 19 июля, 15:00",
  master: "Инна",
  client_name: "Аружан",
  client_phone: "+77011234542",
};

function crmEnv(): Env {
  return {
    DB: env.DB,
    KV: env.KV,
    AI: env.AI,
    ASSETS: env.ASSETS,
    GEMINI_API_KEY: "x",
    WEBHOOK_SECRET: "x",
    TURNSTILE_SECRET_KEY: "x",
    GEMINI_MODEL: "x",
    TURNSTILE_SITE_KEY: "x",
    BITRIX_ENABLED: "false",
  };
}

beforeAll(async () => {
  await applySchemaAndSeed();
});

afterEach(() => vi.restoreAllMocks());

describe("sheets adapter", () => {
  it("POSTs the full event JSON to the configured Web App URL", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await sheetsAdapter.push(EVENT, { sheets: { url: HOOK_URL } }, crmEnv());
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(HOOK_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(EVENT);
  });
});

describe("dispatchCrm resilience", () => {
  it("swallows an adapter failure — the client reply is never affected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));
    const scheduled: Promise<unknown>[] = [];
    const fakeCtx = {
      waitUntil: (p: Promise<unknown>) => scheduled.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    const cfg: CrmConfig = { sheets: { url: HOOK_URL } };

    expect(() => dispatchCrm(EVENT, cfg, crmEnv(), fakeCtx)).not.toThrow();
    await expect(Promise.all(scheduled)).resolves.toBeDefined();
  });
});
