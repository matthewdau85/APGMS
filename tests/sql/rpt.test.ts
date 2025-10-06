import assert from "node:assert/strict";
import test from "node:test";
import {
  SQL_INSERT_RPT_TOKEN,
  SQL_MARK_BLOCKED_ANOMALY,
  SQL_MARK_BLOCKED_DISCREPANCY,
  SQL_MARK_READY_RPT,
  SQL_SELECT_PERIOD,
} from "../../src/rpt/issuer";

test("RPT issuer SQL strings are parameterized", () => {
  assert.match(SQL_SELECT_PERIOD, /WHERE abn=\$1 AND tax_type=\$2 AND period_id=\$3/);
  assert.match(SQL_MARK_BLOCKED_ANOMALY, /WHERE id=\$1/);
  assert.match(SQL_MARK_BLOCKED_DISCREPANCY, /WHERE id=\$1/);
  assert.match(SQL_INSERT_RPT_TOKEN, /VALUES \(\$1,\$2,\$3,\$4,\$5\)/);
  assert.match(SQL_MARK_READY_RPT, /WHERE id=\$1/);
});
