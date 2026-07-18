import type { CrmConfig } from "../config";
import type { Env } from "../env";
import type { CrmAdapter, CrmEvent } from "./adapter";

/**
 * POST to an inbound Bitrix24 webhook ({url}crm.lead.add.json). Active only during
 * the trial window (§8 stage 8): cfg.bitrix24.webhookUrl && BITRIX_ENABLED==="true".
 */
export const bitrix24Adapter: CrmAdapter = {
  name: "bitrix24",
  enabled(cfg: CrmConfig, env: Env): boolean {
    return Boolean(cfg.bitrix24?.webhookUrl) && env.BITRIX_ENABLED === "true";
  },
  async push(event: CrmEvent, cfg: CrmConfig, _env: Env): Promise<void> {
    const base = cfg.bitrix24?.webhookUrl;
    if (!base) return;
    const title =
      event.type === "booking_created"
        ? `Запись: ${event.service ?? ""} — ${event.label ?? ""}`
        : `Заявка: ${event.summary}`;
    const fields: Record<string, unknown> = { TITLE: title, NAME: event.client_name ?? "", COMMENTS: event.summary };
    if (event.client_phone) fields.PHONE = [{ VALUE: event.client_phone, VALUE_TYPE: "WORK" }];
    const res = await fetch(`${base.replace(/\/?$/, "/")}crm.lead.add.json`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields }),
    });
    if (!res.ok) throw new Error(`bitrix24 ${res.status}`);
  },
};
