import assert from "node:assert/strict";
import test from "node:test";
import {
  SQL_SELECT_LATEST_RPT,
  SQL_UPDATE_PERIOD_RELEASED,
} from "../../src/routes/reconcile";

test("reconciliation routes query RPT and periods with placeholders", () => {
  assert.match(SQL_SELECT_LATEST_RPT, /WHERE abn=\$1 AND tax_type=\$2 AND period_id=\$3/);
  assert.match(SQL_UPDATE_PERIOD_RELEASED, /WHERE abn=\$1 AND tax_type=\$2 AND period_id=\$3/);
});
