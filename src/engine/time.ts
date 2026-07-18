// Asia/Almaty via Intl (no hardcoded +5). All moments are unix seconds UTC;
// only these helpers cross the local<->UTC boundary. Implemented in stage 1.

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

const NOT_IMPL = "not implemented — stage 1";

/** Local calendar date (YYYY-MM-DD) for `now` in the given tz. */
export function todayInTz(_tz: string, _now: Date): string {
  throw new Error(NOT_IMPL);
}

/** Add n calendar days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(_dateIso: string, _n: number): string {
  throw new Error(NOT_IMPL);
}

/** Weekday key (mon..sun) of a local YYYY-MM-DD date. */
export function weekdayOf(_dateIso: string): WeekdayKey {
  throw new Error(NOT_IMPL);
}

/**
 * Local wall-clock (YYYY-MM-DDTHH:mm) in tz -> unix seconds UTC.
 * No `new Date(local + "+05:00")` — offset is derived by reading a guess back
 * through Intl.DateTimeFormat.formatToParts and correcting once.
 */
export function localToTs(_local: string, _tz: string): number {
  throw new Error(NOT_IMPL);
}

/** Human slot label «сб, 19 июля, 15:00» from a start ts (two Intl formatters joined by ", "). */
export function formatSlotLabel(_startTs: number, _tz: string): string {
  throw new Error(NOT_IMPL);
}
