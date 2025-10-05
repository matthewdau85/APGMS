import "dotenv/config";
import { Pool } from "pg";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

async function run() {
  const pool = new Pool();
  const client = await pool.connect();
  try {
    const dir = join(process.cwd(), "migrations");
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      console.log(`[migrate] running ${file}`);
      await client.query(sql);
    }
    console.log("[migrate] done");
  } catch (error) {
    console.error("[migrate] failed", error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
