import type { BusinessRow, ConversationRow } from "./db";
import type { Env } from "./env";

export interface TurnEvent {
  type: "booking_created" | "booking_cancelled";
}

export interface TurnResult {
  reply: string;
  events: TurnEvent[];
}

/**
 * The single entry point for TG text, TG voice (already transcribed) and web chat.
 * Runs the Gemini function-calling loop against the deterministic engine and
 * returns the reply plus any booking events. Implemented in stage 3.
 */
export async function handleTurn(
  _env: Env,
  _business: BusinessRow,
  _convo: ConversationRow,
  _userText: string,
  _ctx: ExecutionContext,
): Promise<TurnResult> {
  throw new Error("not implemented — stage 3");
}
