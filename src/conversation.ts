import type { ConversationRow } from "./db";

export interface HistoryMsg {
  role: "user" | "model";
  text: string;
}

/** One entry of conversations.last_offered (§6.1). */
export interface OfferedSlot {
  service_id: number;
  start: string; // startLocal, YYYY-MM-DDTHH:mm
  ts: number;
  label: string;
}

export const HISTORY_LIMIT = 16;

/** Load (or lazily create) the conversation row for a channel/external id. Implemented in stage 3. */
export async function loadConversation(
  _db: D1Database,
  _bizId: number,
  _channel: "tg" | "web",
  _externalId: string,
): Promise<ConversationRow> {
  throw new Error("not implemented — stage 3");
}

/** Persist trimmed history + last_offered + client fields after a turn. Implemented in stage 3. */
export async function saveConversation(
  _db: D1Database,
  _convo: ConversationRow,
  _patch: { history?: HistoryMsg[]; lastOffered?: OfferedSlot[]; clientName?: string; clientPhone?: string },
): Promise<void> {
  throw new Error("not implemented — stage 3");
}
