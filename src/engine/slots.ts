import { parseWorkingHours } from "../config";
import { getBusinessById, getServiceById, type BusinessRow, type ServiceRow } from "../db";
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

/**
 * Grid cells occupied by a booking that starts at startTs and spans spanMin
 * (duration + buffer), at stepMin granularity. A cell_ts marks the start of a
 * step-sized cell; the booking touches every cell it overlaps.
 */
export function cellsFor(startTs: number, spanMin: number, stepMin: number): number[] {
  const count = Math.ceil(spanMin / stepMin);
  const cells: number[] = [];
  for (let k = 0; k < count; k++) cells.push(startTs + k * stepMin * 60);
  return cells;
}

/** generateCandidates minus booking_cells occupancy for the service's master. */
export async function checkAvailability(
  db: D1Database,
  bizId: number,
  serviceId: number,
  fromDate: string,
  toDate: string,
  part: PartOfDay = "any",
  now: Date = new Date(),
): Promise<Slot[]> {
  const b = await getBusinessById(db, bizId);
  const svc = await getServiceById(db, bizId, serviceId);
  if (!b || !svc) return [];

  const candidates = generateCandidates(b, svc, fromDate, toDate, part, now);
  if (candidates.length === 0) return [];

  const span = svc.duration_min + b.buffer_min;
  const step = b.slot_step_min;
  const startsTs = candidates.map((c) => c.startTs);
  const minTs = Math.min(...startsTs);
  const maxEnd = Math.max(...startsTs) + span * 60;

  const { results } = await db
    .prepare("SELECT cell_ts FROM booking_cells WHERE business_id = ? AND resource_id = ? AND cell_ts >= ? AND cell_ts < ?")
    .bind(bizId, svc.resource_id, minTs, maxEnd)
    .all<{ cell_ts: number }>();
  const occupied = new Set((results ?? []).map((r) => r.cell_ts));

  return candidates.filter((c) => cellsFor(c.startTs, span, step).every((ts) => !occupied.has(ts)));
}
