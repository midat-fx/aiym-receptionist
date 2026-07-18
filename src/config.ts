import { hhmmToMin, isHhmm, type WeekdayKey } from "./engine/time";

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

const WEEKDAYS: WeekdayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Parse & validate businesses.working_hours JSON into a full 7-day map (missing days = closed). */
export function parseWorkingHours(json: string): WorkingHours {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new ConfigError("working_hours is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError("working_hours must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  const result = {} as WorkingHours;
  for (const day of WEEKDAYS) {
    const val = obj[day];
    if (val === undefined || val === null) {
      result[day] = [];
      continue;
    }
    if (!Array.isArray(val)) throw new ConfigError(`working_hours.${day} must be an array of intervals`);
    const intervals: Array<[string, string]> = [];
    let prevClose = -1;
    for (const iv of val) {
      if (!Array.isArray(iv) || iv.length !== 2 || typeof iv[0] !== "string" || typeof iv[1] !== "string") {
        throw new ConfigError(`working_hours.${day}: each interval must be [open, close]`);
      }
      const open = iv[0];
      const close = iv[1];
      if (!isHhmm(open) || !isHhmm(close)) throw new ConfigError(`working_hours.${day}: invalid HH:mm`);
      const openMin = hhmmToMin(open);
      const closeMin = hhmmToMin(close);
      if (openMin >= closeMin) throw new ConfigError(`working_hours.${day}: open must be before close`);
      if (openMin < prevClose) throw new ConfigError(`working_hours.${day}: intervals must be sorted and non-overlapping`);
      prevClose = closeMin;
      intervals.push([open, close]);
    }
    result[day] = intervals;
  }
  return result;
}

/** Service duration must be a positive multiple of the business slot step (§4). */
export function assertServiceDuration(durationMin: number, slotStepMin: number): void {
  if (!Number.isInteger(durationMin) || durationMin <= 0 || durationMin % slotStepMin !== 0) {
    throw new ConfigError(`duration ${durationMin} must be a positive multiple of ${slotStepMin}`);
  }
}

/** Parse businesses.crm_config JSON into a typed adapter config. */
export function parseCrmConfig(json: string): CrmConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(json || "{}");
  } catch {
    throw new ConfigError("crm_config is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError("crm_config must be a JSON object");
  }
  return raw as CrmConfig;
}
