import type { Env } from "./env";

/**
 * Admin API, authenticated by Bearer token matched against businesses.admin_token_hash
 * (SHA-256). Exposes bookings/leads/status changes and reset-demo. Implemented in stage 6.
 */
export async function handleAdmin(_request: Request, _env: Env): Promise<Response> {
  return new Response("Not implemented", { status: 501 });
}
