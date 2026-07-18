import type { Env } from "../env";

/**
 * ElevenLabs eleven_flash_v2_5 with a KV cache (tts:<sha256(text+voice_id)>,
 * TTL 30d), a daily cap of 5 uncached generations and a monthly credit counter.
 * Returns null when disabled (no key), capped, or on error — the caller then
 * degrades silently to text. Implemented in stage 5.
 */
export async function synthesizeVoice(_env: Env, _text: string): Promise<ArrayBuffer | null> {
  throw new Error("not implemented — stage 5");
}
