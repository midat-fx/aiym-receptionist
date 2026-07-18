export interface Env {
  DB: D1Database;
  KV: KVNamespace;
  AI: Ai;
  ASSETS: Fetcher;
  GEMINI_API_KEY: string;
  WEBHOOK_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  ELEVENLABS_API_KEY?: string; // may be absent — the whole text path works without it
  GEMINI_MODEL: string;
  ELEVENLABS_VOICE_ID?: string;
  TURNSTILE_SITE_KEY: string;
  BITRIX_ENABLED: string;
}
