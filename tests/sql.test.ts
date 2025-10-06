import { test } from "node:test";
import assert from "node:assert/strict";
import { sql } from "../src/db/sql";

test("sql builder increments positional parameters", () => {
  const query = sql`SELECT * FROM periods WHERE abn=${"123"} AND tax_type=${"GST"}`;
  assert.equal(query.text, "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2");
  assert.deepEqual(query.params, ["123", "GST"]);
});

test("sql builder works with inserts", () => {
  const query = sql`
    INSERT INTO rpt_tokens(abn,tax_type,period_id,payload)
    VALUES (${"123"},${"GST"},${"2025-09"},${{ ok: true }})
  `;
  assert.equal(
    query.text,
    "INSERT INTO rpt_tokens(abn,tax_type,period_id,payload) VALUES ($1,$2,$3,$4)",
  );
  assert.equal(query.params.length, 4);
});

test("sql builder trims whitespace", () => {
  const query = sql`
    SELECT *
      FROM owa_ledger
     WHERE abn=${"123"}
  `;
  assert.equal(query.text, "SELECT * FROM owa_ledger WHERE abn=$1");
});

test("sql builder embeds repeated fields", () => {
  const abn = "123";
  const query = sql`SELECT ${abn} AS abn, ${abn} AS again`;
  assert.equal(query.text, "SELECT $1 AS abn, $2 AS again");
  assert.deepEqual(query.params, ["123", "123"]);
});

test("sql builder handles zero values", () => {
  const query = sql`UPDATE periods SET final_liability_cents=${0} WHERE id=${42}`;
  assert.equal(query.text, "UPDATE periods SET final_liability_cents=$1 WHERE id=$2");
  assert.deepEqual(query.params, [0, 42]);
});
