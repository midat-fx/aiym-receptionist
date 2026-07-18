// All counters live in D1 rate_limits (KV is forbidden for counters, §2/§9.4).

export type LimitScope = "chat" | "voice" | "global_msg" | "tts_uncached" | "whisper" | "tts_credits";

export interface LimitResult {
  ok: boolean;
  count: number;
}

/**
 * Atomically bump rate_limits[scope,key,day] and report whether it stayed within max.
 * `day` is 'YYYY-MM-DD' for daily scopes, 'YYYY-MM' for monthly (tts_credits).
 * Implemented in stage 3.
 */
export async function checkAndIncrement(
  _db: D1Database,
  _scope: LimitScope,
  _key: string,
  _day: string,
  _max: number,
  _by = 1,
): Promise<LimitResult> {
  throw new Error("not implemented — stage 3");
}
