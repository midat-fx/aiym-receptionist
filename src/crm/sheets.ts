import type { CrmConfig } from "../config";
import type { Env } from "../env";
import type { CrmAdapter, CrmEvent } from "./adapter";

/**
 * POST the event as JSON to a Google Apps Script Web App URL (deployed "Anyone",
 * see scripts/apps-script-sheets.gs). googleapis SDK does not run in Workers, so
 * a plain fetch to a user-owned Web App is the only viable path.
 */
export const sheetsAdapter: CrmAdapter = {
  name: "sheets",
  enabled(cfg: CrmConfig, _env: Env): boolean {
    return Boolean(cfg.sheets?.url);
  },
  async push(event: CrmEvent, cfg: CrmConfig, _env: Env): Promise<void> {
    const url = cfg.sheets?.url;
    if (!url) return;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event),
    });
    if (!res.ok) throw new Error(`sheets webhook ${res.status}`);
  },
};
