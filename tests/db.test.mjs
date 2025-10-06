import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";

function buildConfig() {
  const url = process.env.DATABASE_URL;
  if (url) return { connectionString: url };
  const { PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD } = process.env;
  if (!PGHOST || !PGDATABASE || !PGUSER) {
    throw new Error("DATABASE_URL or PG* variables must be set for tests");
  }
  return {
    host: PGHOST,
    port: PGPORT ? parseInt(PGPORT, 10) : 5432,
    database: PGDATABASE,
    user: PGUSER,
    password: PGPASSWORD
  };
}

test("periods table exists", async () => {
  const client = new Client(buildConfig());
  await client.connect();
  try {
    const res = await client.query(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_name='periods'"
    );
    assert.equal(res.rows[0].count, 1, "periods table should exist after migrations");
  } finally {
    await client.end();
  }
});
