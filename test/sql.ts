import { env } from "cloudflare:test";
import schema from "../schema.sql?raw";
import seed from "../seed.sql?raw";

/**
 * Split a .sql file into executable statements. schema.sql can't go through
 * db.exec() (it breaks on multi-line statements, §10) — strip full-line comments,
 * split on ';', run one by one with prepare().run().
 */
function splitSql(sql: string): string[] {
  return sql
    .split("\n")
    // Strip `--` comments to end of line (incl. inline) so a ';' inside a comment
    // can't split a statement. No `--` occurs inside our string literals.
    .map((line) => {
      const i = line.indexOf("--");
      return i >= 0 ? line.slice(0, i) : line;
    })
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Apply schema + demo seed to the test D1 (call in beforeAll). */
export async function applySchemaAndSeed(): Promise<void> {
  for (const stmt of splitSql(schema)) await env.DB.prepare(stmt).run();
  for (const stmt of splitSql(seed)) await env.DB.prepare(stmt).run();
}
