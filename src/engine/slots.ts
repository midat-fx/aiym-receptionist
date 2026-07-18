import type { BusinessRow, ServiceRow } from "../db";

export interface Slot {
  startTs: number;
  endTs: number;
  startLocal: string; // YYYY-MM-DDTHH:mm
  label: string; // «сб, 19 июля, 15:00»
}

export type PartOfDay = "any" | "morning" | "afternoon" | "evening"; // <12:00 | 12:00-16:59 | >=17:00

export const MIN_LEAD_MIN = 60;

/**
 * Pure candidate generation from working_hours: a slot every slot_step from the
 * window start while start+duration+buffer <= window end; drop startTs < now+60min.
 * Does NOT subtract occupancy (that's checkAvailability). Implemented in stage 1.
 */
export function generateCandidates(
  _b: BusinessRow,
  _svc: ServiceRow,
  _fromDate: string,
  _toDate: string,
  _part: PartOfDay,
  _now: Date,
): Slot[] {
  throw new Error("not implemented — stage 1");
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
