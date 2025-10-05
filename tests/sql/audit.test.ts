import assert from "node:assert/strict";
import test from "node:test";
import {
  SQL_INSERT_AUDIT_ENTRY,
  SQL_SELECT_AUDIT_TAIL,
} from "../../src/audit/appendOnly";

test("audit logging queries are parameterized", () => {
  assert.match(SQL_SELECT_AUDIT_TAIL, /ORDER BY seq DESC LIMIT 1$/);
  assert.match(SQL_INSERT_AUDIT_ENTRY, /VALUES \(\$1,\$2,\$3,\$4,\$5\)/);
});
