import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd (miniflare) so the booking engine exercises a real
// D1 SQLite — the sacred principle (PK on booking_cells) is verified, not mocked.
// API note: @cloudflare/vitest-pool-workers@0.18.x (peer vitest ^4.1) exposes a
// Vite plugin `cloudflareTest(...)` — the older `defineWorkersConfig` entry (§3)
// was dropped. See the execution journal for this deviation.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
});
