// schema.sql / seed.sql are imported as raw strings in tests (see §7).
declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}

// Bindings available to tests via `import { env } from "cloudflare:test"`.
// `env` is typed as `Cloudflare.Env`; merge our bindings into that namespace
// (we don't run `wrangler types`, so it is otherwise empty).
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    KV: KVNamespace;
    AI: Ai;
    ASSETS: Fetcher;
  }
}
