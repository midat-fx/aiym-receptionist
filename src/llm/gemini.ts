// Raw fetch to v1beta :generateContent (NOT the new Interactions API) with a
// function-calling loop of <=4 hops and a deterministic fallback phrase.
// Implemented in stage 3.

import type { Env } from "../env";

export interface GeminiMessage {
  role: "user" | "model";
  text: string;
}

export interface GeminiResult {
  reply: string;
  events: Array<{ type: "booking_created" | "booking_cancelled" }>;
}

export async function runConversation(
  _env: Env,
  _systemPrompt: string,
  _history: GeminiMessage[],
  _dispatch: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<GeminiResult> {
  throw new Error("not implemented — stage 3");
}
