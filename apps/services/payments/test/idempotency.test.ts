import { createHash } from "crypto";
test("idempotency key stable", () => {
  const key = "payato:111:PAYGW:2025-09";
  const h = createHash("sha256").update(key).digest("hex");
  expect(h).toHaveLength(64);
});