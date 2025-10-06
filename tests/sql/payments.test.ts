import assert from "node:assert/strict";
import test from "node:test";
import {
  SQL_INSERT_IDEMPOTENCY_KEY,
  SQL_INSERT_LEDGER_RELEASE,
  SQL_SELECT_DESTINATION,
  SQL_SELECT_LEDGER_TAIL,
  SQL_UPDATE_IDEMPOTENCY_DONE,
} from "../../src/rails/adapter";

test("payments SQL uses positional placeholders", () => {
  assert.match(SQL_SELECT_DESTINATION, /WHERE abn=\$1 AND rail=\$2 AND reference=\$3/);
  assert.match(SQL_INSERT_IDEMPOTENCY_KEY, /VALUES \(\$1,\$2\)/);
  assert.match(SQL_SELECT_LEDGER_TAIL, /WHERE abn=\$1 AND tax_type=\$2 AND period_id=\$3/);
  assert.match(SQL_INSERT_LEDGER_RELEASE, /VALUES \(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9\)/);
  assert.match(SQL_UPDATE_IDEMPOTENCY_DONE, /WHERE key=\$1/);
});
