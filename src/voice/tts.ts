import type { Env } from "../env";
import { checkAndIncrement } from "../limits";

const MAX_CHARS = 160;
const DAILY_UNCACHED_CAP = 5;
const MONTHLY_CREDIT_CAP = 10_000; // ElevenLabs free = 10k credits/MONTH
const CREDITS_PER_CHAR = 0.5;
const CACHE_TTL_SEC = 60 * 60 * 24 * 30; // 30 days
const TTS_TIMEOUT_MS = 8_000;

/**
 * Make a reply speakable: drop markdown markers and emoji, collapse whitespace and
 * cut at the last sentence boundary within MAX_CHARS (falling back to a word boundary)
 * so the voice never trails off mid-word. Exported — the caption reuses it.
 */
export function speakable(text: string, max = MAX_CHARS): string {
  const clean = text
    .replace(/[*_`#>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}\u{FE0F}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= max) return clean;
  const head = clean.slice(0, max);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf("! "), head.lastIndexOf("? "));
  if (sentence > max * 0.5) return head.slice(0, sentence + 1).trim();
  const word = head.lastIndexOf(" ");
  return (word > 0 ? head.slice(0, word) : head).trim();
}

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const utcDay = (): string => new Date().toISOString().slice(0, 10);
const utcMonth = (): string => new Date().toISOString().slice(0, 7);

/**
 * ElevenLabs eleven_flash_v2_5 with a KV cache (tts:<sha256(text+voice_id)>, TTL 30d),
 * a daily cap of 5 uncached generations and a monthly credit counter. Returns null
 * when disabled (no key/voice), capped, or on error — the caller degrades to text.
 * Cache hits cost nothing and do not touch the caps.
 */
export async function synthesizeVoice(
  env: Env,
  text: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<ArrayBuffer | null> {
  if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) return null; // module disabled
  const clean = speakable(text);
  const cacheKey = `tts:${await sha256hex(`${clean}:${env.ELEVENLABS_VOICE_ID}`)}`;

  const cached = await env.KV.get(cacheKey, "arrayBuffer");
  if (cached) return cached;

  // Daily uncached cap, then monthly credit budget.
  const uncached = await checkAndIncrement(env.DB, "tts_uncached", "global", utcDay(), DAILY_UNCACHED_CAP);
  if (!uncached.ok) return null;
  const credits = Math.ceil(clean.length * CREDITS_PER_CHAR);
  const budget = await checkAndIncrement(env.DB, "tts_credits", "global", utcMonth(), MONTHLY_CREDIT_CAP, credits);
  if (!budget.ok) return null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);
    let audio: ArrayBuffer;
    try {
      const res = await fetchFn(
        `https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID}?output_format=mp3_44100_64`,
        {
          method: "POST",
          headers: { "xi-api-key": env.ELEVENLABS_API_KEY, "content-type": "application/json" },
          body: JSON.stringify({ text: clean, model_id: "eleven_flash_v2_5" }),
          signal: controller.signal,
        },
      );
      if (!res.ok) {
        // Silence here is how an exhausted/revoked key hides for weeks.
        console.error("tts http", res.status, (await res.text()).slice(0, 200));
        return null;
      }
      audio = await res.arrayBuffer();
    } finally {
      clearTimeout(timer);
    }
    await env.KV.put(cacheKey, audio, { expirationTtl: CACHE_TTL_SEC });
    return audio;
  } catch (e) {
    console.error("tts failed:", (e as Error).message);
    return null;
  }
}
