import type { CrmConfig } from "../config";
import type { Env } from "../env";
import type { CrmAdapter, CrmEvent } from "./adapter";

/** POST JSON to a Google Apps Script Web App URL (scripts/apps-script-sheets.gs). Implemented in stage 6. */
export const sheetsAdapter: CrmAdapter = {
  name: "sheets",
  enabled(cfg: CrmConfig, _env: Env): boolean {
    return Boolean(cfg.sheets?.url);
  },
  async push(_event: CrmEvent, _cfg: CrmConfig, _env: Env): Promise<void> {
    throw new Error("not implemented — stage 6");
  },
};
