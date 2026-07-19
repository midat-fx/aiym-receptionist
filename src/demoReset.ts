import { getActiveServices, getBusinessBySlug } from "./db";
import { book } from "./engine/booking";
import { addDays, localToTs, todayInTz, weekdayOf, type WeekdayKey } from "./engine/time";

/** Nearest date on/after startDate whose weekday matches key (searches 14 days). */
function nextWeekday(startDate: string, key: WeekdayKey): string {
  for (let i = 0; i < 14; i++) {
    const date = addDays(startDate, i);
    if (weekdayOf(date) === key) return date;
  }
  return startDate;
}

/**
 * Rebuild the demo tenant's occupancy relative to «tomorrow» so the chips in
 * demo.html land on the intended free/busy slots (§5.3). One batch wipes the
 * is_demo data + stale rate_limits, then book() (channel='admin') recreates
 * ~35% occupancy. Every book() is checked; failures are logged, not silent.
 * Called by cron (0 22 * * * UTC) and POST /admin/api/reset-demo.
 */
export async function resetDemo(db: D1Database, now: Date = new Date()): Promise<void> {
  const biz = await getBusinessBySlug(db, "demo-salon");
  if (!biz || !biz.is_demo) return;

  const services = await getActiveServices(db, biz.id);
  const idOf = (name: string): number | undefined => services.find((s) => s.name === name)?.id;
  const MANI = idOf("Маникюр с гель-лаком");
  const PEDI = idOf("Педикюр");
  const OKRASH = idOf("Окрашивание в один тон");
  const ZHEN = idOf("Женская стрижка");
  const NARASH = idOf("Наращивание ресниц");

  const today = todayInTz(biz.tz, now);
  const cutoff = addDays(today, -7);
  await db.batch([
    db.prepare("DELETE FROM booking_cells WHERE business_id = ?").bind(biz.id),
    db.prepare("DELETE FROM bookings WHERE business_id = ?").bind(biz.id),
    db.prepare("DELETE FROM leads WHERE business_id = ?").bind(biz.id),
    db.prepare("DELETE FROM conversations WHERE business_id = ?").bind(biz.id),
    // Daily rows only. MONTHLY rows use 7-char 'YYYY-MM' keys, which sort BEFORE any
    // same-month 'YYYY-MM-DD' under BINARY collation — an unqualified `day < cutoff`
    // silently wiped the ElevenLabs monthly credit counter every night.
    db.prepare("DELETE FROM rate_limits WHERE length(day) = 10 AND day < ?").bind(cutoff),
    db.prepare("DELETE FROM rate_limits WHERE length(day) = 7 AND day < ?").bind(cutoff.slice(0, 7)),
  ]);

  const tomorrow = addDays(today, 1);
  const nextSat = nextWeekday(tomorrow, "sat"); // upcoming Saturday (=== tomorrow when today is Friday)
  const errors: string[] = [];

  const seed = async (serviceId: number | undefined, localDateTime: string, name: string): Promise<void> => {
    if (serviceId === undefined) {
      errors.push(`unknown service for ${localDateTime}`);
      return;
    }
    const r = await book(
      db,
      { bizId: biz.id, serviceId, startTs: localToTs(localDateTime, biz.tz), client: { name, channel: "admin" } },
      now,
    );
    if (!r.ok) errors.push(`${name} ${localDateTime}: ${r.reason}`);
  };

  // Инна (nail service) tomorrow: 12:00–13:30 and 17:30–19:00 -> free 15:00 (chip 1) and 16:00 (chip 4).
  await seed(MANI, `${tomorrow}T12:00`, "Салтанат");
  await seed(PEDI, `${tomorrow}T17:30`, "Мадина");
  // Айгерим tomorrow: colour 11:00–13:30 — but not if tomorrow is Saturday (collides with the Saturday seed).
  if (weekdayOf(tomorrow) !== "sat") await seed(OKRASH, `${tomorrow}T11:00`, "Динара");
  // Айгерим nearest Saturday: two women's cuts 10:00 & 11:00 (busy morning -> chip 3 gets 12:00/12:30).
  await seed(ZHEN, `${nextSat}T10:00`, "Салтанат");
  await seed(ZHEN, `${nextSat}T11:00`, "Мадина");
  // Scattered, not touching the above. On a Friday run nextSat === tomorrow, where Инна's
  // 12:00 cell is already held by the seed above — skip rather than log a bogus conflict.
  if (nextSat !== tomorrow) await seed(MANI, `${nextSat}T12:00`, "Динара");
  await seed(NARASH, `${tomorrow}T13:00`, "Салтанат");

  if (errors.length) console.error("resetDemo seed issues:", errors.join(" | "));
}
