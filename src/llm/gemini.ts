// Raw fetch to v1beta :generateContent (NOT the new Interactions API) with a
// function-calling loop of <=4 hops and a mode:NONE finaliser.

import type { Env } from "../env";
import { toolDeclarations } from "./tools";

export interface GeminiMessage {
  role: "user" | "model";
  text: string;
}

export interface GeminiResult {
  reply: string;
  /** true when the loop ended without any assistant text — caller hands off. */
  handoff?: boolean;
}

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}
interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MAX_HOPS = 4;
const LLM_TIMEOUT_MS = 10_000;
const FALLBACK = "Секунду, уточню у администратора 🙏";
// Role for functionResponse turns in v1beta contents.
const FUNCTION_ROLE = "user";

async function callGemini(env: Env, body: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/${env.GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function partsOf(data: unknown): GeminiPart[] {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> })?.candidates;
  return candidates?.[0]?.content?.parts ?? [];
}

function textOf(parts: GeminiPart[]): string {
  return parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

export async function runConversation(
  env: Env,
  systemPrompt: string,
  history: GeminiMessage[],
  dispatch: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<GeminiResult> {
  const contents: GeminiContent[] = history.map((m) => ({ role: m.role, parts: [{ text: m.text }] }));
  const base = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    tools: [{ function_declarations: toolDeclarations }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
  };

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const parts = partsOf(await callGemini(env, { ...base, contents }));
    const calls = parts.filter((p) => p.functionCall);
    if (calls.length === 0) {
      const text = textOf(parts);
      return text ? { reply: text } : { reply: FALLBACK, handoff: true };
    }
    contents.push({ role: "model", parts });
    const responseParts: GeminiPart[] = [];
    for (const c of calls) {
      const fc = c.functionCall as { name: string; args?: Record<string, unknown> };
      const response = await dispatch(fc.name, fc.args ?? {});
      responseParts.push({ functionResponse: { name: fc.name, response } });
    }
    contents.push({ role: FUNCTION_ROLE, parts: responseParts });
  }

  // Hops exhausted -> force a plain-text answer with function calling disabled.
  // Tools are off here, so the model literally cannot book: say so, or it will
  // happily "confirm" an appointment that was never written.
  const finalParts = partsOf(
    await callGemini(env, {
      ...base,
      system_instruction: {
        parts: [
          { text: systemPrompt },
          {
            text: "ВАЖНО: инструменты сейчас недоступны, записать клиента в этом сообщении ты НЕ можешь. Не утверждай, что запись сделана — предложи время и попроси подтвердить.",
          },
        ],
      },
      contents,
      tool_config: { function_calling_config: { mode: "NONE" } },
    }),
  );
  const text = textOf(finalParts);
  return text ? { reply: text } : { reply: FALLBACK, handoff: true };
}
