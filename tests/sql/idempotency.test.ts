import assert from "node:assert/strict";
import test from "node:test";
import {
  SQL_INSERT_IDEMPOTENCY_KEY,
  SQL_SELECT_IDEMPOTENCY_KEY,
} from "../../src/middleware/idempotency";

test("idempotency middleware uses positional parameters", () => {
  assert.match(SQL_INSERT_IDEMPOTENCY_KEY, /VALUES \(\$1,\$2\)/);
  assert.match(SQL_SELECT_IDEMPOTENCY_KEY, /WHERE key=\$1/);
});
