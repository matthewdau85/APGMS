import { readFileSync, readdirSync } from "fs";
import { createHash } from "crypto";
import { getPool } from "../src/db/pool";

async function main() {
  const db = getPool();
  await db.query(`
    create table if not exists schema_migrations(
      id serial primary key, filename text unique, checksum text, applied_at timestamptz default now()
    )`);
  const files = readdirSync("migrations").filter(f => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = readFileSync(`migrations/${f}`, "utf8");
    const sum = createHash("sha256").update(sql).digest("hex");
    const row = await db.query(`select checksum from schema_migrations where filename=$1`, [f]);
    if (row.rowCount && row.rows[0].checksum !== sum) {
      throw new Error(`Migration checksum mismatch for ${f}`);
    }
    if (row.rowCount === 0) {
      await db.query("BEGIN");
      await db.query(sql);
      await db.query(`insert into schema_migrations (filename, checksum) values ($1,$2)`, [f, sum]);
      await db.query("COMMIT");
      console.log("applied", f);
    }
  }
  await db.end();
}
main().catch(e=>{ console.error(e); process.exit(1); });
