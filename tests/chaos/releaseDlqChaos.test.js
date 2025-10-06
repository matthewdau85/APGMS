import { test } from "node:test";
import assert from "node:assert";
import { RetryQueue, DeadLetterError } from "../../src/queues/retryQueue";

test("DB failover shunts release jobs into DLQ after retries", async () => {
  const dlq = [];
  const queue = new RetryQueue({
    concurrency: 1,
    maxSize: 10,
    maxAttempts: 3,
    baseBackoffMs: 1,
    maxBackoffMs: 2,
    async processor() {
      throw Object.assign(new Error("database unavailable"), { code: "ECONNRESET" });
    },
    async onPermanentFailure(payload) {
      dlq.push(payload);
    },
  });

  await assert.rejects(queue.enqueue({ id: "fail-db" }), DeadLetterError);
  assert.strictEqual(dlq.length, 1);
  assert.strictEqual(dlq[0].id, "fail-db");
});

test("repeated banking timeouts trigger DLQ population", async () => {
  const dlq = [];
  let attempts = 0;
  const queue = new RetryQueue({
    concurrency: 1,
    maxSize: 2,
    maxAttempts: 2,
    baseBackoffMs: 1,
    maxBackoffMs: 2,
    async processor() {
      attempts += 1;
      throw Object.assign(new Error("bank timeout"), { code: "ETIMEDOUT" });
    },
    async onPermanentFailure(payload) {
      dlq.push(payload);
    },
  });

  await assert.rejects(queue.enqueue({ id: "timeout" }), DeadLetterError);
  assert.strictEqual(attempts, 2);
  assert.strictEqual(dlq.length, 1);
  assert.strictEqual(dlq[0].id, "timeout");
});
