import assert from "node:assert/strict";
import test from "node:test";
import {
  SQL_SELECT_LEDGER_FOR_BUNDLE,
  SQL_SELECT_PERIOD_FOR_BUNDLE,
  SQL_SELECT_RPT_FOR_BUNDLE,
} from "../../src/evidence/bundle";

test("evidence bundle queries filter by positional arguments", () => {
  assert.match(SQL_SELECT_PERIOD_FOR_BUNDLE, /WHERE abn=\$1 AND tax_type=\$2 AND period_id=\$3/);
  assert.match(SQL_SELECT_RPT_FOR_BUNDLE, /WHERE abn=\$1 AND tax_type=\$2 AND period_id=\$3/);
  assert.match(SQL_SELECT_LEDGER_FOR_BUNDLE, /WHERE abn=\$1 AND tax_type=\$2 AND period_id=\$3/);
});
