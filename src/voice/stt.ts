import type { Env } from "../env";
import type { Telegram } from "../telegram";

export type SttResult = { ok: true; text: string } | { ok: false };

/**
 * voice note -> getFile -> fetch -> base64 (chunked, no Buffer) -> Whisper
 * (@cf/openai/whisper-large-v3-turbo, vad_filter:true, no language). Rejects
 * clips > 60s before download. Implemented in stage 5.
 */
export async function transcribeVoice(
  _env: Env,
  _tg: Telegram,
  _fileId: string,
  _durationSec: number,
): Promise<SttResult> {
  throw new Error("not implemented — stage 5");
}
