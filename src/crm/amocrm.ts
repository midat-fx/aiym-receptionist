import type { CrmConfig } from "../config";
import type { Env } from "../env";
import type { CrmAdapter, CrmEvent } from "./adapter";

/** Stub: amoCRM needs OAuth, deferred to v2 (Roadmap). Always disabled; push fails honestly. */
export const amocrmAdapter: CrmAdapter = {
  name: "amocrm",
  enabled(_cfg: CrmConfig, _env: Env): boolean {
    return false;
  },
  async push(_event: CrmEvent, _cfg: CrmConfig, _env: Env): Promise<void> {
    throw new Error("amoCRM adapter is not available in v1 (OAuth planned for v2)");
  },
};
