import type { CrmConfig } from "../config";
import type { Env } from "../env";
import type { CrmAdapter, CrmEvent } from "./adapter";

/**
 * POST {url}crm.lead.add.json to an inbound Bitrix24 webhook. Active only during
 * the trial window (§8 stage 8): cfg.bitrix24.webhookUrl && BITRIX_ENABLED==="true".
 * Implemented in stage 6 (on mocks) / stage 8 (live trial).
 */
export const bitrix24Adapter: CrmAdapter = {
  name: "bitrix24",
  enabled(cfg: CrmConfig, env: Env): boolean {
    return Boolean(cfg.bitrix24?.webhookUrl) && env.BITRIX_ENABLED === "true";
  },
  async push(_event: CrmEvent, _cfg: CrmConfig, _env: Env): Promise<void> {
    throw new Error("not implemented — stage 6");
  },
};
