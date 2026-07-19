// Row types mirror schema.sql (§4) and shared query helpers.

export interface BusinessRow {
  id: number;
  slug: string;
  name: string;
  assistant_name: string;
  address: string;
  tz: string;
  working_hours: string; // JSON, parsed by config.ts
  slot_step_min: number;
  buffer_min: number;
  booking_horizon_days: number;
  tg_bot_id: number | null;
  tg_bot_token: string | null;
  owner_tg_chat_id: number | null;
  admin_token_hash: string;
  crm_config: string; // JSON, parsed by config.ts
  is_demo: number;
  created_at: string;
}

export interface ResourceRow {
  id: number;
  business_id: number;
  name: string;
  role: string;
}

export interface ServiceRow {
  id: number;
  business_id: number;
  resource_id: number;
  name: string;
  duration_min: number;
  price_kzt: number | null;
  price_from: number;
  is_active: number;
}

export type BookingStatus = "pending" | "confirmed" | "cancelled";
export type Channel = "tg" | "web" | "admin";

export interface BookingRow {
  id: string;
  business_id: number;
  service_id: number;
  resource_id: number;
  start_ts: number;
  end_ts: number;
  status: BookingStatus;
  client_name: string | null;
  client_phone: string | null;
  channel: Channel;
  tg_chat_id: number | null;
  web_session_id: string | null;
  note: string | null;
  created_at: string;
  cancelled_at: string | null;
}

export type LeadStatus = "new" | "contacted" | "converted" | "rejected";

export interface LeadRow {
  id: number;
  business_id: number;
  name: string | null;
  phone: string | null;
  service: string | null;
  budget: string | null;
  urgency: string | null;
  summary: string;
  status: LeadStatus;
  channel: string;
  tg_chat_id: number | null;
  booking_id: string | null;
  created_at: string;
}

export interface ConversationRow {
  id: number;
  business_id: number;
  channel: "tg" | "web";
  external_id: string;
  history: string; // JSON
  last_offered: string; // JSON
  client_name: string | null;
  client_phone: string | null;
  muted_until: string | null;
  updated_at: string;
}

export async function getBusinessBySlug(db: D1Database, slug: string): Promise<BusinessRow | null> {
  return db.prepare("SELECT * FROM businesses WHERE slug = ?").bind(slug).first<BusinessRow>();
}

export async function getBusinessByBotId(db: D1Database, botId: number): Promise<BusinessRow | null> {
  return db.prepare("SELECT * FROM businesses WHERE tg_bot_id = ?").bind(botId).first<BusinessRow>();
}

export async function getBusinessById(db: D1Database, id: number): Promise<BusinessRow | null> {
  return db.prepare("SELECT * FROM businesses WHERE id = ?").bind(id).first<BusinessRow>();
}

export async function getBusinessByAdminHash(db: D1Database, hash: string): Promise<BusinessRow | null> {
  return db.prepare("SELECT * FROM businesses WHERE admin_token_hash = ?").bind(hash).first<BusinessRow>();
}

export async function getBookingById(db: D1Database, id: string): Promise<BookingRow | null> {
  return db.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first<BookingRow>();
}

export async function getActiveServices(db: D1Database, bizId: number): Promise<ServiceRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM services WHERE business_id = ? AND is_active = 1 ORDER BY id")
    .bind(bizId)
    .all<ServiceRow>();
  return results ?? [];
}

export async function getServiceById(db: D1Database, bizId: number, serviceId: number): Promise<ServiceRow | null> {
  return db
    .prepare("SELECT * FROM services WHERE business_id = ? AND id = ?")
    .bind(bizId, serviceId)
    .first<ServiceRow>();
}

export async function getResources(db: D1Database, bizId: number): Promise<ResourceRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM resources WHERE business_id = ? ORDER BY id")
    .bind(bizId)
    .all<ResourceRow>();
  return results ?? [];
}

/**
 * Count a client's UPCOMING (confirmed, not yet finished) bookings — for the
 * 2-per-client limit. Past visits must not count: nothing retires them out of
 * 'confirmed', so without the bound a returning client is locked out forever.
 */
export async function countActiveBookings(
  db: D1Database,
  bizId: number,
  by: { tgChatId?: number; webSessionId?: string },
  now: Date = new Date(),
): Promise<number> {
  const nowTs = Math.floor(now.getTime() / 1000);
  if (by.tgChatId != null) {
    const row = await db
      .prepare(
        "SELECT count(*) AS n FROM bookings WHERE business_id = ? AND status = 'confirmed' AND end_ts > ? AND tg_chat_id = ?",
      )
      .bind(bizId, nowTs, by.tgChatId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
  if (by.webSessionId) {
    const row = await db
      .prepare(
        "SELECT count(*) AS n FROM bookings WHERE business_id = ? AND status = 'confirmed' AND end_ts > ? AND web_session_id = ?",
      )
      .bind(bizId, nowTs, by.webSessionId)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }
  return 0;
}

export interface LeadInput {
  businessId: number;
  name?: string | null;
  phone?: string | null;
  service?: string | null;
  budget?: string | null;
  urgency?: string | null;
  summary: string;
  channel: string;
  tgChatId?: number | null;
  bookingId?: string | null;
}

export async function insertLead(db: D1Database, lead: LeadInput): Promise<void> {
  await db
    .prepare(
      "INSERT INTO leads (business_id, name, phone, service, budget, urgency, summary, channel, tg_chat_id, booking_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      lead.businessId,
      lead.name ?? null,
      lead.phone ?? null,
      lead.service ?? null,
      lead.budget ?? null,
      lead.urgency ?? null,
      lead.summary,
      lead.channel,
      lead.tgChatId ?? null,
      lead.bookingId ?? null,
    )
    .run();
}
