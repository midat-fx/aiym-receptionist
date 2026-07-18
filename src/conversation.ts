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

function parseJsonArray<T>(raw: string): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

export function getHistory(convo: ConversationRow): HistoryMsg[] {
  return parseJsonArray<HistoryMsg>(convo.history);
}

export function getOffered(convo: ConversationRow): OfferedSlot[] {
  return parseJsonArray<OfferedSlot>(convo.last_offered);
}

/** Trim history to the last HISTORY_LIMIT messages (no tool-turns are stored). */
export function trimHistory(history: HistoryMsg[]): HistoryMsg[] {
  return history.length > HISTORY_LIMIT ? history.slice(history.length - HISTORY_LIMIT) : history;
}

export async function getConversation(
  db: D1Database,
  bizId: number,
  channel: "tg" | "web",
  externalId: string,
): Promise<ConversationRow | null> {
  return db
    .prepare("SELECT * FROM conversations WHERE business_id = ? AND channel = ? AND external_id = ?")
    .bind(bizId, channel, externalId)
    .first<ConversationRow>();
}

/** Get or create the conversation row (used for TG; web rows are created only after Turnstile). */
export async function ensureConversation(
  db: D1Database,
  bizId: number,
  channel: "tg" | "web",
  externalId: string,
): Promise<ConversationRow> {
  await db
    .prepare(
      "INSERT OR IGNORE INTO conversations (business_id, channel, external_id, history, last_offered) VALUES (?, ?, ?, '[]', '[]')",
    )
    .bind(bizId, channel, externalId)
    .run();
  const row = await getConversation(db, bizId, channel, externalId);
  if (!row) throw new Error("conversation vanished after insert");
  return row;
}

export interface ConversationPatch {
  history?: HistoryMsg[];
  lastOffered?: OfferedSlot[];
  clientName?: string | null;
  clientPhone?: string | null;
  mutedUntil?: string | null;
}

/** Persist a turn's outcome onto the conversation row. */
export async function saveConversation(db: D1Database, convo: ConversationRow, patch: ConversationPatch): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.history !== undefined) {
    sets.push("history = ?");
    binds.push(JSON.stringify(trimHistory(patch.history)));
  }
  if (patch.lastOffered !== undefined) {
    sets.push("last_offered = ?");
    binds.push(JSON.stringify(patch.lastOffered));
  }
  if (patch.clientName !== undefined) {
    sets.push("client_name = ?");
    binds.push(patch.clientName);
  }
  if (patch.clientPhone !== undefined) {
    sets.push("client_phone = ?");
    binds.push(patch.clientPhone);
  }
  if (patch.mutedUntil !== undefined) {
    sets.push("muted_until = ?");
    binds.push(patch.mutedUntil);
  }
  sets.push("updated_at = datetime('now')");
  binds.push(convo.id);
  await db
    .prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
}
