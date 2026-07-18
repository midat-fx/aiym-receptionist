import { sha256hex } from "./crypto";
import { getBusinessByAdminHash, type BusinessRow, type LeadStatus } from "./db";
import { resetDemo } from "./demoReset";
import { cancel } from "./engine/booking";
import { formatSlotLabel } from "./engine/time";
import type { Env } from "./env";

const json = (data: unknown, status = 200): Response => Response.json(data, { status });
const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "converted", "rejected"];

async function authBusiness(request: Request, env: Env): Promise<BusinessRow | null> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return null;
  return getBusinessByAdminHash(env.DB, await sha256hex(token));
}

/**
 * Admin API, authenticated by a Bearer token matched (SHA-256) against
 * businesses.admin_token_hash. Exposes bookings/leads/status changes and reset-demo.
 */
export async function handleAdmin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  const business = await authBusiness(request, env);
  if (!business) return json({ error: "unauthorized" }, 401);

  if (request.method === "GET" && path === "/admin/api/me") {
    return json({ business: business.name, slug: business.slug, is_demo: business.is_demo });
  }

  if (request.method === "GET" && path === "/admin/api/bookings") {
    const { results } = await env.DB.prepare(
      `SELECT b.id, b.start_ts, b.status, b.client_name, b.client_phone, b.channel,
              s.name AS service, r.name AS master
       FROM bookings b JOIN services s ON s.id = b.service_id JOIN resources r ON r.id = b.resource_id
       WHERE b.business_id = ? ORDER BY b.start_ts DESC LIMIT 100`,
    )
      .bind(business.id)
      .all<{
        id: string;
        start_ts: number;
        status: string;
        client_name: string | null;
        client_phone: string | null;
        channel: string;
        service: string;
        master: string;
      }>();
    const bookings = (results ?? []).map((b) => ({ ...b, label: formatSlotLabel(b.start_ts, business.tz) }));
    return json({ bookings });
  }

  if (request.method === "GET" && path === "/admin/api/leads") {
    const { results } = await env.DB.prepare(
      "SELECT id, name, phone, service, budget, urgency, summary, status, channel, created_at FROM leads WHERE business_id = ? ORDER BY created_at DESC, id DESC LIMIT 100",
    )
      .bind(business.id)
      .all();
    return json({ leads: results ?? [] });
  }

  if (request.method === "POST" && path === "/admin/api/lead-status") {
    const body = (await request.json().catch(() => ({}))) as { lead_id?: number; status?: string };
    if (!body.lead_id || !LEAD_STATUSES.includes(body.status as LeadStatus)) {
      return json({ error: "lead_id and valid status required" }, 400);
    }
    await env.DB.prepare("UPDATE leads SET status = ? WHERE id = ? AND business_id = ?")
      .bind(body.status, body.lead_id, business.id)
      .run();
    return json({ ok: true });
  }

  if (request.method === "POST" && path === "/admin/api/booking-cancel") {
    const body = (await request.json().catch(() => ({}))) as { booking_id?: string };
    if (!body.booking_id) return json({ error: "booking_id required" }, 400);
    const res = await cancel(env.DB, { bizId: business.id, bookingId: body.booking_id });
    return res.ok ? json({ ok: true }) : json({ ok: false, error: res.reason }, 404);
  }

  if (request.method === "POST" && path === "/admin/api/reset-demo") {
    if (!business.is_demo) return json({ error: "not a demo tenant" }, 403);
    await resetDemo(env.DB);
    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}
