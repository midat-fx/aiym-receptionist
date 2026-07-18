import type { Env } from "./env";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Turnstile token via siteverify (form-data secret+response). With the
 * Cloudflare test keys this always passes (or always fails for the fail sitekey).
 */
export async function verifyTurnstile(env: Env, token: string | undefined, ip?: string): Promise<boolean> {
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET_KEY);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch(SITEVERIFY, { method: "POST", body: form });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
