import type { BusinessRow, ServiceRow } from "../src/db";

const KEREMET_HOURS = JSON.stringify({
  mon: [["10:00", "20:00"]],
  tue: [["10:00", "20:00"]],
  wed: [["10:00", "20:00"]],
  thu: [["10:00", "20:00"]],
  fri: [["10:00", "20:00"]],
  sat: [["10:00", "20:00"]],
  sun: [["11:00", "18:00"]],
});

export function makeBusiness(overrides: Partial<BusinessRow> = {}): BusinessRow {
  return {
    id: 1,
    slug: "demo-salon",
    name: "Керемет",
    assistant_name: "Айым",
    address: "ул. Розыбакиева 125, Алматы",
    tz: "Asia/Almaty",
    working_hours: KEREMET_HOURS,
    slot_step_min: 30,
    buffer_min: 0,
    booking_horizon_days: 14,
    tg_bot_id: null,
    tg_bot_token: null,
    owner_tg_chat_id: null,
    admin_token_hash: "x",
    crm_config: "{}",
    is_demo: 1,
    created_at: "2026-07-18 00:00:00",
    ...overrides,
  };
}

export function makeService(overrides: Partial<ServiceRow> = {}): ServiceRow {
  return {
    id: 6,
    business_id: 1,
    resource_id: 2,
    name: "Маникюр с гель-лаком",
    duration_min: 90,
    price_kzt: 8000,
    price_from: 0,
    is_active: 1,
    ...overrides,
  };
}
