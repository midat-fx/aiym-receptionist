/**
 * Rebuild the demo tenant's occupancy relative to «tomorrow» so the chips in
 * demo.html always land on the intended free/busy slots (§5.3). One batch wipes
 * is_demo data + old rate_limits, then book() recreates ~35% occupancy.
 * Called by cron (0 22 * * * UTC) and POST /admin/api/reset-demo. Implemented in stage 4.
 */
export async function resetDemo(_db: D1Database, _now?: Date): Promise<void> {
  throw new Error("not implemented — stage 4");
}
