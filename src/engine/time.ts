// Asia/Almaty via Intl (no hardcoded +5). All moments are unix seconds UTC;
// only these helpers cross the local<->UTC boundary.

export type WeekdayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

// Index by Date.getUTCDay(): 0 = Sunday.
const WEEKDAY_KEYS: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** "HH:mm" -> minutes since midnight. */
export function hhmmToMin(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return h * 60 + m;
}

/** minutes since midnight -> "HH:mm". */
export function minToHhmm(min: number): string {
  return `${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
}

/** Strict "HH:mm" (00:00..23:59) check. */
export function isHhmm(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const found = parts.find((p) => p.type === type);
  if (!found) throw new Error(`missing ${type} in formatted date`);
  return found.value;
}

/** Local calendar date (YYYY-MM-DD) for `now` in the given tz. */
export function todayInTz(tz: string, now: Date): string {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return `${part(p, "year")}-${part(p, "month")}-${part(p, "day")}`;
}

/** Add n calendar days to a YYYY-MM-DD date, returning YYYY-MM-DD. */
export function addDays(dateIso: string, n: number): string {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** Weekday key (mon..sun) of a local YYYY-MM-DD date. */
export function weekdayOf(dateIso: string): WeekdayKey {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const idx = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAY_KEYS[idx] as WeekdayKey;
}

// Interpret an instant in tz and return its wall-clock components as if they were UTC.
function wallClockAsUtcMs(instantMs: number, tz: string): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(instantMs));
  let hour = Number(part(p, "hour"));
  if (hour === 24) hour = 0; // some engines report midnight as "24" with hour12:false
  return Date.UTC(
    Number(part(p, "year")),
    Number(part(p, "month")) - 1,
    Number(part(p, "day")),
    hour,
    Number(part(p, "minute")),
    Number(part(p, "second")),
  );
}

/**
 * Local wall-clock (YYYY-MM-DDTHH:mm) in tz -> unix seconds UTC.
 * No `new Date(local + "+05:00")` — the offset is derived by reading a guess
 * back through Intl and correcting; a second pass covers DST boundaries
 * (Almaty has none, but the code stays universal).
 */
export function localToTs(local: string, tz: string): number {
  const [datePart, timePart] = local.split("T") as [string, string];
  const [y, mo, d] = datePart.split("-").map(Number) as [number, number, number];
  const [h, mi] = timePart.split(":").map(Number) as [number, number];
  const targetAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = targetAsUtc;
  for (let i = 0; i < 2; i++) {
    const readback = wallClockAsUtcMs(guess, tz);
    guess += targetAsUtc - readback;
  }
  return Math.floor(guess / 1000);
}

/** Unix seconds -> local machine datetime "YYYY-MM-DDTHH:mm" in tz. */
export function tsToLocal(ts: number, tz: string): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts * 1000));
  const hour = part(p, "hour") === "24" ? "00" : part(p, "hour");
  return `${part(p, "year")}-${part(p, "month")}-${part(p, "day")}T${hour}:${part(p, "minute")}`;
}

/**
 * Human slot label «сб, 19 июля, 15:00» from a start ts. Two ru-RU formatters
 * joined by ", " — a single Intl call yields «сб, 19 июля в 15:00» (unwanted preposition).
 */
export function formatSlotLabel(startTs: number, tz: string): string {
  const d = new Date(startTs * 1000);
  const dayFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, weekday: "short", day: "numeric", month: "long" });
  const timeFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
  return `${dayFmt.format(d)}, ${timeFmt.format(d)}`;
}
