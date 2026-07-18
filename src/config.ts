import type { WeekdayKey } from "./engine/time";

export type WorkingHours = Record<WeekdayKey, Array<[string, string]>>;

export interface CrmConfig {
  sheets?: { url: string };
  bitrix24?: { webhookUrl: string };
  amocrm?: Record<string, unknown>;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** Parse & validate businesses.working_hours JSON. Implemented in stage 1/config tests. */
export function parseWorkingHours(_json: string): WorkingHours {
  throw new Error("not implemented — stage 1");
}

/** Parse businesses.crm_config JSON into a typed adapter config. Implemented in stage 6. */
export function parseCrmConfig(_json: string): CrmConfig {
  throw new Error("not implemented — stage 6");
}
