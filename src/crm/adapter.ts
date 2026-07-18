import type { CrmConfig } from "../config";
import type { Env } from "../env";
import { amocrmAdapter } from "./amocrm";
import { bitrix24Adapter } from "./bitrix24";
import { builtinAdapter } from "./builtin";
import { sheetsAdapter } from "./sheets";

export interface CrmEvent {
  type: "booking_created" | "booking_cancelled" | "lead_created";
  business_id: number;
  summary: string;
  service?: string;
  label?: string; // «сб, 19 июля, 15:00»
  master?: string;
  client_name?: string;
  client_phone?: string;
  booking_id?: string;
}

export interface CrmAdapter {
  name: string;
  enabled(cfg: CrmConfig, env: Env): boolean;
  push(event: CrmEvent, cfg: CrmConfig, env: Env): Promise<void>;
}

const ADAPTERS: CrmAdapter[] = [builtinAdapter, sheetsAdapter, bitrix24Adapter, amocrmAdapter];

/**
 * Fan out an event to every enabled adapter. Each push runs in its own
 * try/catch via ctx.waitUntil — a CRM failure never breaks the client reply (§6.4).
 */
export function dispatchCrm(event: CrmEvent, cfg: CrmConfig, env: Env, ctx: ExecutionContext): void {
  for (const adapter of ADAPTERS) {
    if (!adapter.enabled(cfg, env)) continue;
    ctx.waitUntil(
      adapter.push(event, cfg, env).catch((e: unknown) => console.error(`crm ${adapter.name} failed:`, (e as Error).message)),
    );
  }
}
