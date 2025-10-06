import { test } from "node:test";
import assert from "node:assert/strict";
import { idempotency, IdempotencyStore } from "../src/middleware/idempotency";

test("idempotent POST returns cached response on replay", async () => {
  const storeData = new Map<string, any>();
  const store: IdempotencyStore = {
    async load(hash) {
      return storeData.get(hash) ?? null;
    },
    async reserve(hash) {
      if (storeData.has(hash)) return false;
      storeData.set(hash, null);
      return true;
    },
    async save(hash, record) {
      storeData.set(hash, record);
    },
  };

  const middleware = idempotency(store);

  const req: any = {
    method: "POST",
    originalUrl: "/api/release",
    body: { abn: "123" },
    header(name: string) {
      return name === "Idempotency-Key" ? "abc" : undefined;
    },
  };

  const res: any = {
    statusCode: 200,
    headers: new Map(),
    setHeader(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    jsonPayload: undefined as any,
    json(body: any) {
      this.jsonPayload = body;
      return body;
    },
    send(body: any) {
      this.jsonPayload = body;
      return body;
    },
  };

  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
    res.statusCode = 201;
    res.json({ ok: true, receipt: "r1" });
  });
  assert.ok(nextCalled, "first call should hit handler");
  assert.deepEqual(storeData.size, 1);

  const replayRes: any = {
    statusCode: 200,
    headers: new Map(),
    setHeader(name: string, value: string) {
      this.headers.set(name.toLowerCase(), value);
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    jsonPayload: undefined as any,
    json(body: any) {
      this.jsonPayload = body;
      return body;
    },
    send(body: any) {
      this.jsonPayload = body;
      return body;
    },
  };

  let replayNext = false;
  await middleware(req, replayRes, () => {
    replayNext = true;
  });
  assert.equal(replayNext, false, "replay should short-circuit");
  assert.equal(replayRes.statusCode, 201);
  assert.deepEqual(replayRes.jsonPayload, { ok: true, receipt: "r1" });
  assert.equal(replayRes.headers.get("idempotent-replay"), "true");
});
