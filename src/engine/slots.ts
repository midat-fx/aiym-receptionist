import { parseWorkingHours } from "../config";
import type { BusinessRow, ServiceRow } from "../db";
import { addDays, formatSlotLabel, hhmmToMin, localToTs, minToHhmm, todayInTz, weekdayOf } from "./time";

export interface Slot {
  startTs: number;
  endTs: number;
  startLocal: string; // YYYY-MM-DDTHH:mm
  label: string; // «сб, 19 июля, 15:00»
}

export type PartOfDay = "any" | "morning" | "afternoon" | "evening"; // <12:00 | 12:00-16:59 | >=17:00

export const MIN_LEAD_MIN = 60;

function inPart(startMin: number, part: PartOfDay): boolean {
  if (part === "any") return true;
  const hour = Math.floor(startMin / 60);
  if (part === "morning") return hour < 12;
  if (part === "afternoon") return hour >= 12 && hour < 17;
  return hour >= 17; // evening
}

/**
 * Pure candidate generation from working_hours: a slot every slot_step from the
 * window start while start+duration+buffer <= window end; drop startTs < now+60min;
 * clamp the requested range to [today, today+horizon-1]. Does NOT subtract
 * occupancy — that's checkAvailability (stage 2).
 */
export function generateCandidates(
  b: BusinessRow,
  svc: ServiceRow,
  fromDate: string,
  toDate: string,
  part: PartOfDay,
  now: Date,
): Slot[] {
  const wh = parseWorkingHours(b.working_hours);
  const today = todayInTz(b.tz, now);
  const horizonEnd = addDays(today, b.booking_horizon_days - 1);

  const from = fromDate < today ? today : fromDate;
  const to = toDate > horizonEnd ? horizonEnd : toDate;
  if (from > to) return [];

  const nowTs = Math.floor(now.getTime() / 1000);
  const minStartTs = nowTs + MIN_LEAD_MIN * 60;
  const span = svc.duration_min + b.buffer_min; // cells occupied = [start, start + span)
  const step = b.slot_step_min;

  const slots: Slot[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const intervals = wh[weekdayOf(date)];
    for (const [open, close] of intervals) {
      const closeMin = hhmmToMin(close);
      for (let startMin = hhmmToMin(open); startMin + span <= closeMin; startMin += step) {
        if (!inPart(startMin, part)) continue;
        const startLocal = `${date}T${minToHhmm(startMin)}`;
        const startTs = localToTs(startLocal, b.tz);
        if (startTs < minStartTs) continue;
        slots.push({
          startTs,
          endTs: startTs + svc.duration_min * 60,
          startLocal,
          label: formatSlotLabel(startTs, b.tz),
        });
      }
    }
  }
  return slots;
}

/** generateCandidates minus booking_cells occupancy for the service's master. Implemented in stage 2. */
export async function checkAvailability(
  _db: D1Database,
  _bizId: number,
  _serviceId: number,
  _fromDate: string,
  _toDate: string,
  _part?: PartOfDay,
  _now?: Date,
): Promise<Slot[]> {
  throw new Error("not implemented — stage 2");
}
