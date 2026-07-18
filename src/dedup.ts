/**
 * Best-effort dedup of Telegram retries via the per-colo Cache API.
 * update_id is unique only within a single bot, so the key is namespaced by
 * botId — without it, another tenant's messages could be dropped as duplicates.
 */
export async function seenBefore(botId: number, updateId: number): Promise<boolean> {
  try {
    const cache = caches.default;
    const key = new Request(`https://dedup.aiym.internal/${botId}/${updateId}`);
    if (await cache.match(key)) return true;
    await cache.put(key, new Response("1", { headers: { "cache-control": "max-age=600" } }));
  } catch {
    // Cache API unavailable (e.g. local dev) — process anyway.
  }
  return false;
}
