import { handleTurn } from "./chat";
import { parseWorkingHours } from "./config";
import { ensureConversation, getConversation } from "./conversation";
import { getBusinessBySlug, getResources } from "./db";
import type { Env } from "./env";
import { formatSlotLabel, hhmmToMin, localToTs, minToHhmm, todayInTz, weekdayOf } from "./engine/time";
import { checkAndIncrement } from "./limits";
import { verifyTurnstile } from "./turnstile";

const SESSION_RE = /^[a-zA-Z0-9-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const utcDay = (): string => new Date().toISOString().slice(0, 10);
const json = (data: unknown, status = 200): Response => Response.json(data, { status });

interface ChatBody {
  biz?: string;
  session_id?: string;
  text?: string;
  turnstile_token?: string;
}

/** POST /chat — web channel turn. First message of a session must pass Turnstile. */
export async function handleChat(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const slug = String(body.biz ?? "");
  const sessionId = String(body.session_id ?? "");
  if (!SESSION_RE.test(sessionId)) return json({ error: "bad session_id" }, 400);

  const business = await getBusinessBySlug(env.DB, slug);
  if (!business) return json({ error: "unknown business" }, 404);

  let convo = await getConversation(env.DB, business.id, "web", sessionId);
  if (!convo) {
    // A session becomes verified the moment its conversations row exists (§2).
    const ip = request.headers.get("cf-connecting-ip") ?? undefined;
    const ok = await verifyTurnstile(env, body.turnstile_token, ip);
    if (!ok) return json({ error: "turnstile_required" }, 403);
    convo = await ensureConversation(env.DB, business.id, "web", sessionId);
  }

  const day = todayInTz(business.tz, new Date());
  const ip = request.headers.get("cf-connecting-ip") ?? undefined;
  // Per-session and per-IP first: a caller being rate-limited must not also drain the
  // shared 300/day tenant budget it is being denied.
  const sessionLimit = await checkAndIncrement(env.DB, "chat", `${business.id}:web:${sessionId}`, day, 20);
  if (!sessionLimit.ok) return json({ reply: "На сегодня достаточно сообщений в демо 🙏 Попробуйте завтра.", events: [] });
  if (ip) {
    const ipLimit = await checkAndIncrement(env.DB, "chat", `${business.id}:ip:${ip}`, day, 60);
    if (!ipLimit.ok) return json({ reply: "Слишком много запросов с вашего адреса — попробуйте позже 🙏", events: [] });
  }
  const globalLimit = await checkAndIncrement(env.DB, "global_msg", String(business.id), utcDay(), 300);
  if (!globalLimit.ok) return json({ reply: "Сегодня необычно много сообщений — загляните чуть позже 🙏", events: [] });

  const text = String(body.text ?? "").slice(0, 1000).trim();
  if (!text) return json({ reply: "Напишите, пожалуйста, сообщение 🙂", events: [] });

  const { reply, events } = await handleTurn(env, business, convo, text, ctx);
  return json({ reply, events });
}

/** GET /api/demo/config?biz= — public config for the demo page (Turnstile sitekey, bot handle). */
export async function handleConfig(_request: Request, env: Env): Promise<Response> {
  return json({ turnstile_sitekey: env.TURNSTILE_SITE_KEY, bot: "aiym_admin_bot" });
}

interface GridCell {
  start: string;
  status: "free" | "busy" | "mine";
}

/** GET /api/slots?biz=&date=&session= — the public availability grid (no client names). */
export async function handleSlots(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get("biz") ?? "";
  const business = await getBusinessBySlug(env.DB, slug);
  if (!business) return json({ error: "unknown business" }, 404);

  const dateParam = url.searchParams.get("date") ?? todayInTz(business.tz, new Date());
  const date = DATE_RE.test(dateParam) ? dateParam : todayInTz(business.tz, new Date());
  const session = url.searchParams.get("session") ?? "";

  const resources = await getResources(env.DB, business.id);
  const wh = parseWorkingHours(business.working_hours);
  const intervals = wh[weekdayOf(date)];

  const grid: Array<{ hhmm: string; ts: number }> = [];
  for (const [open, close] of intervals) {
    for (let m = hhmmToMin(open); m < hhmmToMin(close); m += business.slot_step_min) {
      const hhmm = minToHhmm(m);
      grid.push({ hhmm, ts: localToTs(`${date}T${hhmm}`, business.tz) });
    }
  }

  const occ = new Map<string, string>(); // `${resource_id}:${cell_ts}` -> web_session_id ("" if none)
  if (grid.length > 0) {
    const dayStart = localToTs(`${date}T00:00`, business.tz);
    const dayEnd = localToTs(`${date}T23:59`, business.tz);
    const { results } = await env.DB.prepare(
      "SELECT bc.resource_id AS rid, bc.cell_ts AS ts, b.web_session_id AS wsid FROM booking_cells bc JOIN bookings b ON b.id = bc.booking_id WHERE bc.business_id = ? AND bc.cell_ts >= ? AND bc.cell_ts <= ?",
    )
      .bind(business.id, dayStart, dayEnd)
      .all<{ rid: number; ts: number; wsid: string | null }>();
    for (const r of results ?? []) occ.set(`${r.rid}:${r.ts}`, r.wsid ?? "");
  }

  const out = resources.map((res) => ({
    id: res.id,
    name: res.name,
    role: res.role,
    cells: grid.map<GridCell>((g) => {
      const held = occ.get(`${res.id}:${g.ts}`);
      const status: GridCell["status"] =
        held === undefined ? "free" : session && held === session ? "mine" : "busy";
      return { start: g.hhmm, status };
    }),
  }));
  return json({ date, resources: out });
}

function maskPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "●●●●";
  const area = digits.slice(1, 4);
  const last2 = digits.slice(-2);
  return `+7 ${area} ●●● ●● ${last2}`;
}

/** GET /api/demo/owner-feed?biz= — last 5 bookings for the «what the owner sees» panel (demo tenant only). */
export async function handleOwnerFeed(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const slug = url.searchParams.get("biz") ?? "";
  const business = await getBusinessBySlug(env.DB, slug);
  if (!business || !business.is_demo) return json({ error: "not a demo tenant" }, 404);

  const { results } = await env.DB.prepare(
    `SELECT b.start_ts AS start_ts, b.client_name AS client_name, b.client_phone AS client_phone,
            s.name AS service, r.name AS master
     FROM bookings b JOIN services s ON s.id = b.service_id JOIN resources r ON r.id = b.resource_id
     WHERE b.business_id = ? AND b.status = 'confirmed'
     ORDER BY b.created_at DESC, b.id DESC LIMIT 5`,
  )
    .bind(business.id)
    .all<{ start_ts: number; client_name: string | null; client_phone: string | null; service: string; master: string }>();

  const bookings = (results ?? []).map((b) => ({
    service: b.service,
    master: b.master,
    label: formatSlotLabel(b.start_ts, business.tz),
    client_name: b.client_name ?? "Клиент",
    phone_masked: maskPhone(b.client_phone),
  }));
  return json({ bookings });
}
