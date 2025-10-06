import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SQL_SELECT_PERIOD_FOR_RPT,
  SQL_INSERT_RPT_TOKEN
} from "../src/rpt/issuer";
import { SQL_SELECT_RPT_TOKEN_FOR_PAYMENT } from "../src/routes/reconcile";
import { SQL_INSERT_LEDGER_RELEASE } from "../src/rails/adapter";
import { SQL_UPDATE_IDEMPOTENCY_RESULT } from "../src/middleware/idempotency";

function assertPlaceholders(sql: string, expected: string[]) {
  const matches = sql.match(/\$\d+/g) ?? [];
  assert.equal(matches.length, expected.length, `Expected ${expected.length} placeholders, got ${matches.length}`);
  const normalized = matches.map(m => Number(m.slice(1))).sort((a, b) => a - b);
  const expectedNumbers = expected.map(token => Number(token.slice(1))).sort((a, b) => a - b);
  assert.deepStrictEqual(normalized, expectedNumbers, "Placeholder numbers mismatch");
}

describe("SQL placeholder coverage", () => {
  it("period lookup uses $1,$2,$3", () => {
    assertPlaceholders(SQL_SELECT_PERIOD_FOR_RPT, ["$1", "$2", "$3"]);
  });

  it("rpt insert uses 5 ordered placeholders", () => {
    assertPlaceholders(SQL_INSERT_RPT_TOKEN, ["$1", "$2", "$3", "$4", "$5"]);
  });

  it("payment token lookup ordered placeholders", () => {
    assertPlaceholders(SQL_SELECT_RPT_TOKEN_FOR_PAYMENT, ["$1", "$2", "$3"]);
  });

  it("ledger release insert binds all nine values", () => {
    assertPlaceholders(SQL_INSERT_LEDGER_RELEASE, ["$1", "$2", "$3", "$4", "$5", "$6", "$7", "$8", "$9"]);
  });

  it("idempotency result update uses sequential placeholders", () => {
    assertPlaceholders(SQL_UPDATE_IDEMPOTENCY_RESULT, ["$1", "$2", "$3", "$4", "$5", "$6"]);
  });
});
