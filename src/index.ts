import { handleAdmin } from "./admin";
import type { Env } from "./env";

const NOT_IMPL = (stage: string) =>
  new Response(`Not implemented yet (${stage})`, { status: 501, headers: { "content-type": "text/plain; charset=utf-8" } });

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // Root -> landing page.
    if (method === "GET" && pathname === "/") {
      return Response.redirect(new URL("/landing", url).toString(), 302);
    }

    // Telegram webhook, one path per tenant bot: POST /tg/<bot_id>.
    if (method === "POST" && pathname.startsWith("/tg/")) {
      return NOT_IMPL("stage 3");
    }
    // Web chat widget turn.
    if (method === "POST" && pathname === "/chat") {
      return NOT_IMPL("stage 4");
    }
    // Public availability grid for the demo.
    if (method === "GET" && pathname === "/api/slots") {
      return NOT_IMPL("stage 4");
    }
    // «What the owner sees» panel (demo tenant only).
    if (method === "GET" && pathname === "/api/demo/owner-feed") {
      return NOT_IMPL("stage 4");
    }
    // One-visit webhook registration.
    if (method === "GET" && pathname === "/api/tg/setup") {
      return NOT_IMPL("stage 3");
    }
    // Admin API (Bearer token).
    if (pathname.startsWith("/admin/api/")) {
      return handleAdmin(request, env);
    }

    // Static assets: /landing, /demo, /admin pages and assets/* (binding ASSETS).
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Nightly demo reset (cron 0 22 * * * UTC = 03:00 Almaty). Wired in stage 4.
    console.log("scheduled tick: resetDemo not wired yet (stage 4)");
  },
} satisfies ExportedHandler<Env>;
