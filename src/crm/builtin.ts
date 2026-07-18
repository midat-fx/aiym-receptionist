import type { CrmConfig } from "../config";
import type { Env } from "../env";
import type { CrmAdapter, CrmEvent } from "./adapter";

/** Always-on adapter: notifies the business owner in Telegram. Bound via /owner <admin_token>. Implemented in stage 6. */
export const builtinAdapter: CrmAdapter = {
  name: "builtin",
  enabled(_cfg: CrmConfig, _env: Env): boolean {
    return true;
  },
  async push(_event: CrmEvent, _cfg: CrmConfig, _env: Env): Promise<void> {
    throw new Error("not implemented — stage 6");
  },
};
