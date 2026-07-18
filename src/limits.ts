// All counters live in D1 rate_limits (KV is forbidden for counters, §2/§9.4).

export type LimitScope = "chat" | "voice" | "global_msg" | "tts_uncached" | "whisper" | "tts_credits";

export interface LimitResult {
  ok: boolean;
  count: number;
}

/**
 * Atomically bump rate_limits[scope,key,day] by `by` and report whether the new
 * count stays within max. `day` is 'YYYY-MM-DD' for daily scopes, 'YYYY-MM' for
 * monthly (tts_credits). Increment-then-check: the over-limit turn is still counted.
 */
export async function checkAndIncrement(
  db: D1Database,
  scope: LimitScope,
  key: string,
  day: string,
  max: number,
  by = 1,
): Promise<LimitResult> {
  await db
    .prepare(
      "INSERT INTO rate_limits (scope, key, day, count) VALUES (?, ?, ?, ?) ON CONFLICT(scope, key, day) DO UPDATE SET count = count + ?",
    )
    .bind(scope, key, day, by, by)
    .run();
  const row = await db
    .prepare("SELECT count FROM rate_limits WHERE scope = ? AND key = ? AND day = ?")
    .bind(scope, key, day)
    .first<{ count: number }>();
  const count = row?.count ?? by;
  return { ok: count <= max, count };
}

/** Read a counter without incrementing (e.g. to show remaining quota). */
export async function currentCount(db: D1Database, scope: LimitScope, key: string, day: string): Promise<number> {
  const row = await db
    .prepare("SELECT count FROM rate_limits WHERE scope = ? AND key = ? AND day = ?")
    .bind(scope, key, day)
    .first<{ count: number }>();
  return row?.count ?? 0;
}
