import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { synthesizeVoice } from "../src/voice/tts";
import { applySchemaAndSeed } from "./sql";

// A test env with ElevenLabs "configured", reusing the real test DB/KV bindings.
function ttsEnv(overrides: Partial<Env> = {}): Env {
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
    ELEVENLABS_API_KEY: "test-key",
    ELEVENLABS_VOICE_ID: "voiceA",
    ...overrides,
  };
}

function mp3Response(): Response {
  return new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]).buffer, { status: 200 });
}

async function uncachedCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT count FROM rate_limits WHERE scope = 'tts_uncached'").first<{ count: number }>();
  return row?.count ?? 0;
}

beforeAll(async () => {
  await applySchemaAndSeed();
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM rate_limits").run();
});

describe("synthesizeVoice", () => {
  it("caches by text+voice: the second call hits KV — no API call, no cap increment", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      return mp3Response();
    }) as unknown as typeof fetch;
    const text = "Аружан, записала вас: маникюр, сб 19 июля 15:00. Ждём вас!";

    const first = await synthesizeVoice(ttsEnv(), text, fetchFn);
    const second = await synthesizeVoice(ttsEnv(), text, fetchFn);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(calls).toBe(1); // second served from cache
    expect(await uncachedCount()).toBe(1); // only the first generation counted
  });

  it("is disabled (returns null) when no ElevenLabs key is set", async () => {
    const fetchFn = (async () => mp3Response()) as unknown as typeof fetch;
    const out = await synthesizeVoice(ttsEnv({ ELEVENLABS_API_KEY: undefined }), "любой текст", fetchFn);
    expect(out).toBeNull();
  });

  it("stops generating once the daily uncached cap is exhausted", async () => {
    const fetchFn = (async () => mp3Response()) as unknown as typeof fetch;
    // 5 distinct texts -> 5 uncached generations allowed; the 6th is refused.
    for (let i = 0; i < 5; i++) expect(await synthesizeVoice(ttsEnv(), `реплика номер ${i}`, fetchFn)).not.toBeNull();
    expect(await synthesizeVoice(ttsEnv(), "шестая реплика", fetchFn)).toBeNull();
  });
});
