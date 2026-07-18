// schema.sql / seed.sql are imported as raw strings in tests (see §7).
declare module "*.sql?raw" {
  const sql: string;
  export default sql;
}
