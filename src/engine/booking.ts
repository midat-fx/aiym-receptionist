import type { BookingRow, Channel } from "../db";
import type { Slot } from "./slots";

export type BookResult =
  | { ok: true; booking: BookingRow; already?: true }
  | { ok: false; reason: "conflict" | "invalid_slot"; alternatives: Slot[] };

export type CancelResult = { ok: true; booking: BookingRow } | { ok: false; reason: "not_found" };

export interface BookClient {
  name: string;
  phone?: string;
  tgChatId?: number;
  webSessionId?: string;
  channel: Channel;
}

export interface BookArgs {
  bizId: number;
  serviceId: number;
  startTs: number;
  client: BookClient;
}

export interface CancelBy {
  bizId: number;
  bookingId?: string;
  tgChatId?: number;
  webSessionId?: string;
  phone?: string;
}

/**
 * Fixed order (§6.1): (1) idempotency check; (2) validate startTs against the
 * pure grid (no occupancy); (3) one db.batch INSERT bookings + N booking_cells.
 * Only a booking_cells PK violation means "busy" -> conflict + alternatives;
 * any other exception is rethrown. Implemented in stage 2.
 */
export async function book(_db: D1Database, _args: BookArgs, _now?: Date): Promise<BookResult> {
  throw new Error("not implemented — stage 2");
}

/** Free the cells (DELETE booking_cells), keep the bookings row for history. Implemented in stage 2. */
export async function cancel(_db: D1Database, _by: CancelBy, _now?: Date): Promise<CancelResult> {
  throw new Error("not implemented — stage 2");
}
