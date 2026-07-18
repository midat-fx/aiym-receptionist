import type { BusinessRow, ResourceRow, ServiceRow } from "../db";

export interface NowInfo {
  nowHuman: string; // «сб, 19 июля 2026, 14:00»
  todayIso: string; // YYYY-MM-DD
  dateMap: string; // «сб=18.07, вс=19.07, пн=20.07, …» (7 days)
  tz: string;
}

/**
 * Build the full system prompt (Appendix B verbatim) with placeholders filled
 * from the business config. Implemented in stage 3.
 */
export function buildSystemPrompt(
  _business: BusinessRow,
  _services: ServiceRow[],
  _resources: ResourceRow[],
  _now: NowInfo,
): string {
  throw new Error("not implemented — stage 3");
}
