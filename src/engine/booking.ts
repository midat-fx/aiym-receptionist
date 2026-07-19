import {
  getBookingById,
  getBusinessById,
  getServiceById,
  type BookingRow,
  type Channel,
} from "../db";
import { cellsFor, checkAvailability, generateCandidates, type Slot } from "./slots";
import { todayInTz } from "./time";

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

// booking_cells PK violation is the ONLY signal that a slot is taken; anything
// else (network, disk) is a real failure and must propagate, not read as "busy".
const CELL_CONFLICT = /UNIQUE constraint failed:.*booking_cells/;

async function findClientBookingAt(
  db: D1Database,
  bizId: number,
  serviceId: number,
  startTs: number,
  client: BookClient,
): Promise<BookingRow | null> {
  if (client.tgChatId != null) {
    return db
      .prepare(
        "SELECT * FROM bookings WHERE business_id = ? AND service_id = ? AND start_ts = ? AND status = 'confirmed' AND tg_chat_id = ?",
      )
      .bind(bizId, serviceId, startTs, client.tgChatId)
      .first<BookingRow>();
  }
  if (client.webSessionId) {
    return db
      .prepare(
        "SELECT * FROM bookings WHERE business_id = ? AND service_id = ? AND start_ts = ? AND status = 'confirmed' AND web_session_id = ?",
      )
      .bind(bizId, serviceId, startTs, client.webSessionId)
      .first<BookingRow>();
  }
  return null;
}

/**
 * Fixed order (§6.1): (1) idempotency; (2) validate startTs against the pure
 * grid (NO occupancy) so an LLM-invented time can never be booked; (3) one
 * db.batch: INSERT bookings + N booking_cells. Only a booking_cells PK
 * violation means "busy" -> conflict + alternatives; any other error rethrows.
 */
export async function book(db: D1Database, args: BookArgs, now: Date = new Date()): Promise<BookResult> {
  const b = await getBusinessById(db, args.bizId);
  const svc = await getServiceById(db, args.bizId, args.serviceId);
  if (!b || !svc) return { ok: false, reason: "invalid_slot", alternatives: [] };

  const { startTs } = args;
  const localDate = todayInTz(b.tz, new Date(startTs * 1000));

  // (1) idempotency — re-confirming the same slot returns the existing booking.
  const existing = await findClientBookingAt(db, args.bizId, args.serviceId, startTs, args.client);
  if (existing) return { ok: true, booking: existing, already: true };

  // (2) validate against the pure grid.
  const onGrid = generateCandidates(b, svc, localDate, localDate, "any", now).some((c) => c.startTs === startTs);
  if (!onGrid) {
    return {
      ok: false,
      reason: "invalid_slot",
      alternatives: await checkAvailability(db, args.bizId, args.serviceId, localDate, localDate, "any", now),
    };
  }

  // (3) atomic insert; a cell PK clash rolls back the whole batch (incl. bookings).
  const span = svc.duration_min + b.buffer_min;
  const cells = cellsFor(startTs, span, b.slot_step_min);
  const endTs = startTs + svc.duration_min * 60;
  const id = crypto.randomUUID();
  const statements = [
    db
      .prepare(
        "INSERT INTO bookings (id, business_id, service_id, resource_id, start_ts, end_ts, status, client_name, client_phone, channel, tg_chat_id, web_session_id) VALUES (?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        args.bizId,
        args.serviceId,
        svc.resource_id,
        startTs,
        endTs,
        args.client.name,
        args.client.phone ?? null,
        args.client.channel,
        args.client.tgChatId ?? null,
        args.client.webSessionId ?? null,
      ),
    ...cells.map((ts) =>
      db
        .prepare("INSERT INTO booking_cells (business_id, resource_id, cell_ts, booking_id) VALUES (?, ?, ?, ?)")
        .bind(args.bizId, svc.resource_id, ts, id),
    ),
  ];

  try {
    await db.batch(statements);
  } catch (e) {
    if (CELL_CONFLICT.test((e as Error).message ?? "")) {
      return {
        ok: false,
        reason: "conflict",
        alternatives: await checkAvailability(db, args.bizId, args.serviceId, localDate, localDate, "any", now),
      };
    }
    throw e;
  }

  const booking = await getBookingById(db, id);
  if (!booking) throw new Error(`booking ${id} vanished after insert`);
  return { ok: true, booking };
}

async function findActiveBooking(db: D1Database, by: CancelBy, now: Date): Promise<BookingRow | null> {
  if (by.bookingId) {
    // The owner names a specific row in the admin panel — reachable even once it has passed.
    return db
      .prepare("SELECT * FROM bookings WHERE id = ? AND business_id = ? AND status = 'confirmed'")
      .bind(by.bookingId, by.bizId)
      .first<BookingRow>();
  }
  const conds: string[] = [];
  // Nothing ever retires a past booking out of 'confirmed', so identity lookups must
  // exclude finished visits — otherwise «перенесите мою запись» resolves to yesterday.
  // Bound on end_ts, not start_ts: an in-progress appointment stays cancellable.
  const binds: unknown[] = [by.bizId, Math.floor(now.getTime() / 1000)];
  if (by.tgChatId != null) {
    conds.push("tg_chat_id = ?");
    binds.push(by.tgChatId);
  }
  if (by.webSessionId) {
    conds.push("web_session_id = ?");
    binds.push(by.webSessionId);
  }
  if (by.phone) {
    conds.push("client_phone = ?");
    binds.push(by.phone);
  }
  if (conds.length === 0) return null;
  // >1 active booking -> cancel the soonest by start_ts.
  const sql = `SELECT * FROM bookings WHERE business_id = ? AND status = 'confirmed' AND end_ts > ? AND (${conds.join(" OR ")}) ORDER BY start_ts ASC LIMIT 1`;
  return db
    .prepare(sql)
    .bind(...binds)
    .first<BookingRow>();
}

/** The client's soonest upcoming booking, or null — for «what's my booking» and reschedule. */
export async function getActiveBooking(db: D1Database, by: CancelBy, now: Date = new Date()): Promise<BookingRow | null> {
  return findActiveBooking(db, by, now);
}

/** Mark the booking cancelled and free its cells (DELETE); the row stays for history. */
export async function cancel(db: D1Database, by: CancelBy, now: Date = new Date()): Promise<CancelResult> {
  const booking = await findActiveBooking(db, by, now);
  if (!booking) return { ok: false, reason: "not_found" };

  await db.batch([
    db.prepare("UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now') WHERE id = ?").bind(booking.id),
    db.prepare("DELETE FROM booking_cells WHERE booking_id = ?").bind(booking.id),
  ]);

  const updated = await getBookingById(db, booking.id);
  return { ok: true, booking: updated ?? { ...booking, status: "cancelled" } };
}
