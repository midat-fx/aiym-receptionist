// Gemini functionDeclarations — Appendix C, applied verbatim, plus the dispatcher
// (validation + last_offered lock + engine calls).

import { parseLimits } from "../config";
import type { CrmEvent } from "../crm/adapter";
import type { BusinessRow, Channel, ResourceRow, ServiceRow } from "../db";
import { countActiveBookings, insertLead } from "../db";
import { book, cancel, getActiveBooking } from "../engine/booking";
import { checkAvailability, type PartOfDay } from "../engine/slots";
import { formatSlotLabel, tsToLocal } from "../engine/time";
import type { OfferedSlot } from "../conversation";
import { horizonEnd, priceLine } from "./prompt";

export const toolDeclarations = [
  {
    name: "checkFreeSlots",
    description:
      "Получить список СВОБОДНЫХ окон для услуги. Вызывай перед любым предложением времени. Предлагать клиенту можно только слоты из ответа.",
    parameters: {
      type: "object",
      properties: {
        service_id: { type: "integer", description: "ID услуги из списка в системном промпте" },
        from_date: { type: "string", description: "Начало диапазона, YYYY-MM-DD, локальная дата бизнеса" },
        to_date: {
          type: "string",
          description: "Конец диапазона включительно, YYYY-MM-DD. Для одного дня равен from_date",
        },
        part_of_day: {
          type: "string",
          enum: ["any", "morning", "afternoon", "evening"],
          description: "morning — до 12:00, afternoon — 12:00–16:59, evening — с 17:00",
        },
      },
      required: ["service_id", "from_date", "to_date"],
    },
  },
  {
    name: "bookSlot",
    description:
      "Забронировать слот. slot_start бери ТОЛЬКО из поля start последнего ответа checkFreeSlots. Перед вызовом обязательно узнай имя клиента.",
    parameters: {
      type: "object",
      properties: {
        service_id: { type: "integer" },
        slot_start: { type: "string", description: "Значение поля start выбранного слота, формат YYYY-MM-DDTHH:mm" },
        client_name: { type: "string" },
        client_phone: { type: "string", description: "Если клиент назвал. Казахстанский формат +7XXXXXXXXXX" },
      },
      required: ["service_id", "slot_start", "client_name"],
    },
  },
  {
    name: "cancelBooking",
    description:
      "confirm=false — узнать ближайшую активную запись клиента (ничего не отменяет, используй для вопросов о записи и для переноса). confirm=true — отменить её; вызывай так только после явного «да, отмените».",
    parameters: {
      type: "object",
      properties: {
        confirm: { type: "boolean" },
      },
      required: ["confirm"],
    },
  },
  {
    name: "qualifyLead",
    description:
      "Сохранить заявку для владельца, когда запись сейчас не происходит: нет подходящих слотов, клиент думает, нестандартная услуга, или просто оставил контакты. Заполняй только из слов клиента.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        service: { type: "string", description: "Что нужно клиенту, его же словами" },
        budget: { type: "string" },
        urgency: { type: "string", enum: ["today", "tomorrow", "this_week", "flexible"] },
        summary: { type: "string", description: "1–2 предложения для владельца: кто, что хочет, когда" },
      },
      required: ["service", "summary"],
    },
  },
  {
    name: "handoffToOwner",
    description:
      "Позвать живого администратора: жалоба, конфликт, нестандартный вопрос, прямая просьба позвать человека, или ты дважды не смог помочь.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Кратко: почему нужен человек" },
      },
      required: ["reason"],
    },
  },
];

export interface TurnEvent {
  type: "booking_created" | "booking_cancelled";
}

/** Mutable per-turn context threaded through the dispatcher; chat.ts persists the accumulators. */
export interface DispatchContext {
  db: D1Database;
  business: BusinessRow;
  services: ServiceRow[];
  resources: ResourceRow[];
  now: Date;
  channel: Channel;
  tgChatId?: number;
  webSessionId?: string;
  // accumulators mutated by the dispatcher
  lastOffered: OfferedSlot[];
  events: TurnEvent[];
  crmEvents: CrmEvent[];
  clientName?: string;
  clientPhone?: string;
  handoffReason?: string;
  /** The engine confirmed a booking this turn (including an idempotent repeat). */
  bookingConfirmed?: boolean;
  /** Details of that confirmation, so a reply can be composed without the LLM. */
  lastConfirmation?: { service: string; label: string };
}

const asString = (v: unknown): string | undefined => (v == null ? undefined : String(v));

/** Kazakhstan phone normalization: `^\+?[78]\d{10}$` -> `+7…`; otherwise keep as given. */
export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (/^\+?[78]\d{10}$/.test(cleaned)) {
    return "+7" + cleaned.replace(/^\+?[78]/, "");
  }
  return raw.trim();
}

function offeredToLast(serviceId: number, slots: Array<{ startTs: number; startLocal: string; label: string }>): OfferedSlot[] {
  return slots.map((s) => ({ service_id: serviceId, start: s.startLocal, ts: s.startTs, label: s.label }));
}

/**
 * Execute one tool call and return the functionResponse body. Enforces the two
 * anti-hallucination locks: (1) bookSlot only accepts a slot_start present in
 * ctx.lastOffered; (2) the engine independently re-validates the slot.
 */
export async function dispatchTool(
  ctx: DispatchContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tz = ctx.business.tz;

  if (name === "checkFreeSlots") {
    const serviceId = Number(args.service_id);
    const svc = ctx.services.find((s) => s.id === serviceId);
    if (!svc) return { error: "unknown_service" };
    const from = asString(args.from_date) ?? "";
    const to = asString(args.to_date) ?? from;
    const partRaw = asString(args.part_of_day) ?? "any";
    const part = (["any", "morning", "afternoon", "evening"].includes(partRaw) ? partRaw : "any") as PartOfDay;

    let slots = await checkAvailability(ctx.db, ctx.business.id, serviceId, from, to, part, ctx.now);
    let note: string | undefined;
    if (part !== "any" && slots.length === 0) {
      // Requested part busy -> widen to the whole day rather than answer «nothing».
      slots = await checkAvailability(ctx.db, ctx.business.id, serviceId, from, to, "any", ctx.now);
      note = "requested_part_busy";
    }
    const capped = slots.slice(0, 12);
    ctx.lastOffered = offeredToLast(serviceId, capped);
    const resp: Record<string, unknown> = {
      service: svc.name,
      price_line: priceLine(svc),
      slots: capped.map((s) => ({ start: s.startLocal, label: s.label })),
      more_count: Math.max(0, slots.length - 12),
    };
    // Distinguish "beyond the booking window" from "fully booked" so Aiym explains the limit.
    const lastDate = horizonEnd(ctx.business, ctx.now);
    if (from > lastDate) {
      resp.note = "beyond_horizon";
      resp.horizon_end = lastDate;
    } else if (note) {
      resp.note = note;
    }
    return resp;
  }

  if (name === "bookSlot") {
    const serviceId = Number(args.service_id);
    const slotStart = asString(args.slot_start) ?? "";
    const clientName = (asString(args.client_name) ?? "").trim();
    const svc = ctx.services.find((s) => s.id === serviceId);
    if (!svc) return { error: "unknown_service" };

    // Lock 1: the start must come from the last checkFreeSlots response.
    const offered = ctx.lastOffered.find((o) => o.service_id === serviceId && o.start === slotStart);
    if (!offered) return { error: "call checkFreeSlots first and copy slot_start from its response" };

    const active = await countActiveBookings(
      ctx.db,
      ctx.business.id,
      { tgChatId: ctx.tgChatId, webSessionId: ctx.webSessionId },
      ctx.now,
    );
    // Per-tenant: a public demo caps at 2, a paying salon lets regulars book ahead.
    const maxActive = parseLimits(ctx.business.limits, ctx.business.is_demo === 1).activeBookings;
    if (active >= maxActive) return { error: "booking_limit", max_active: maxActive };

    const phone = args.client_phone != null ? normalizePhone(String(args.client_phone)) : undefined;
    const result = await book(
      ctx.db,
      {
        bizId: ctx.business.id,
        serviceId,
        startTs: offered.ts,
        client: {
          name: clientName || "Клиент",
          phone,
          channel: ctx.channel,
          tgChatId: ctx.tgChatId,
          webSessionId: ctx.webSessionId,
        },
      },
      ctx.now,
    );
    if (result.ok) {
      // Client fields update even on a repeat turn (it may carry a phone the first one lacked).
      if (clientName) ctx.clientName = clientName;
      if (phone) ctx.clientPhone = phone;
      // True for both a fresh booking and an idempotent repeat — the slot IS held.
      ctx.bookingConfirmed = true;
      ctx.lastConfirmation = { service: svc.name, label: offered.label };
      // An idempotent repeat changed nothing — don't re-notify the owner or re-pulse the grid.
      if (!result.already) {
        ctx.events.push({ type: "booking_created" });
        const master = ctx.resources.find((r) => r.id === svc.resource_id)?.name;
        ctx.crmEvents.push({
          type: "booking_created",
          business_id: ctx.business.id,
          summary: `${clientName || "Клиент"}: ${svc.name}, ${offered.label}`,
          service: svc.name,
          label: offered.label,
          master,
          client_name: clientName || undefined,
          client_phone: phone,
          booking_id: result.booking.id,
        });
      }
      // Shape stays byte-identical on the `already` path so the TTS cache hits (§8 stage 5).
      return { ok: true, confirmation: { service: svc.name, label: offered.label, client_name: clientName } };
    }
    ctx.lastOffered = offeredToLast(serviceId, result.alternatives);
    return {
      ok: false,
      reason: result.reason,
      alternatives: result.alternatives.map((s) => ({ start: s.startLocal, label: s.label })),
    };
  }

  if (name === "cancelBooking") {
    const confirm = args.confirm === true;
    const by = { bizId: ctx.business.id, tgChatId: ctx.tgChatId, webSessionId: ctx.webSessionId };
    if (!confirm) {
      const booking = await getActiveBooking(ctx.db, by, ctx.now);
      if (!booking) return { active_booking: null };
      const svc = ctx.services.find((s) => s.id === booking.service_id);
      return {
        active_booking: {
          service: svc?.name ?? "",
          start: tsToLocal(booking.start_ts, tz),
          label: formatSlotLabel(booking.start_ts, tz),
        },
      };
    }
    const res = await cancel(ctx.db, by, ctx.now);
    if (res.ok) {
      ctx.events.push({ type: "booking_cancelled" });
      const svc = ctx.services.find((s) => s.id === res.booking.service_id);
      ctx.crmEvents.push({
        type: "booking_cancelled",
        business_id: ctx.business.id,
        summary: `Отмена: ${svc?.name ?? "запись"}, ${formatSlotLabel(res.booking.start_ts, tz)}`,
      });
      return { ok: true };
    }
    return { ok: false, reason: "not_found" };
  }

  if (name === "qualifyLead") {
    const phone = args.phone != null ? normalizePhone(String(args.phone)) : null;
    const summary = asString(args.summary) ?? "Заявка";
    const service = asString(args.service) ?? null;
    await insertLead(ctx.db, {
      businessId: ctx.business.id,
      name: asString(args.name) ?? null,
      phone,
      service,
      budget: asString(args.budget) ?? null,
      urgency: asString(args.urgency) ?? null,
      summary,
      channel: ctx.channel,
      tgChatId: ctx.tgChatId ?? null,
    });
    ctx.crmEvents.push({
      type: "lead_created",
      business_id: ctx.business.id,
      summary,
      service: service ?? undefined,
      client_name: asString(args.name),
      client_phone: phone ?? undefined,
    });
    return { ok: true };
  }

  if (name === "handoffToOwner") {
    ctx.handoffReason = asString(args.reason) ?? "нужен человек";
    return { ok: true };
  }

  return { error: "unknown_tool" };
}
