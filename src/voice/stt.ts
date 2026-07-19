import type { Env } from "../env";
import type { Telegram } from "../telegram";

export type SttResult = { ok: true; text: string } | { ok: false };

const MAX_DURATION_SEC = 60;
const FETCH_TIMEOUT_MS = 10_000;

/** ArrayBuffer -> base64 string in chunks (no Buffer; avoids call-stack blowups). */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Telegram voice note -> getFile -> download -> base64 -> Whisper
 * (@cf/openai/whisper-large-v3-turbo, vad_filter:true, language auto-detected).
 * Returns {ok:false} on any failure so the caller degrades to «напишите текстом».
 */
export async function transcribeVoice(
  env: Env,
  tg: Telegram,
  fileId: string,
  durationSec: number,
): Promise<SttResult> {
  if (durationSec > MAX_DURATION_SEC) return { ok: false };
  try {
    const file = await tg.getFile(fileId);
    if (!file.file_path) return { ok: false };

    // ONE shared deadline for download + inference. Two separate 10s timers would allow a
    // 20s STT leg which, with LLM 10s + TTS 8s, blows the 30s waitUntil budget (§9 rule 6).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(tg.fileUrl(file.file_path), { signal: controller.signal });
      if (!res.ok) return { ok: false };
      const audioBuf = await res.arrayBuffer();

      // Input is a base64 STRING (not Uint8Array — that was the old @cf/openai/whisper). vad_filter
      // is required or Whisper hallucinates on silence. Language stays auto-detected (ru + kk).
      const out = (await env.AI.run(
        "@cf/openai/whisper-large-v3-turbo" as never,
        { audio: toBase64(audioBuf), vad_filter: true } as never,
        { signal: controller.signal } as never,
      )) as { text?: string };
      const text = (out?.text ?? "").trim();
      return text ? { ok: true, text } : { ok: false };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    console.error("stt failed:", (e as Error).message);
    return { ok: false };
  }
}
