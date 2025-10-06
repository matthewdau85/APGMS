import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { idempotency, IdempotencyStore, ReserveResult } from "../src/middleware/idempotency";

function createReq(body: any = {}) {
  return {
    header: (name: string) => (name === "Idempotency-Key" ? "key-1" : undefined),
    method: "POST",
    originalUrl: "/test",
    body,
  } as any;
}

function createRes() {
  const emitter = new EventEmitter();
  const res: any = emitter;
  res.statusCode = 200;
  res.headers = new Map<string, string>();
  res.setHeader = (name: string, value: string) => {
    res.headers.set(name, value);
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload: any) => {
    res.payload = payload;
    emitter.emit("finish");
    return res;
  };
  res.send = (payload: any) => {
    res.payload = payload;
    emitter.emit("finish");
    return res;
  };
  return res;
}

test("idempotency middleware stores response on first request", async () => {
  let saved: any = null;
  const store: IdempotencyStore = {
    reserve: async () => ({ state: "new" }),
    save: async (_key, status, body, outcome) => {
      saved = { status, body, outcome };
    },
  };
  const middleware = idempotency(store);
  const req = createReq({ hello: "world" });
  const res = createRes();
  let nextCalled = false;
  await middleware(req, res, () => {
    nextCalled = true;
    res.json({ ok: true });
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nextCalled, true);
  assert.deepEqual(saved, { status: 200, body: { ok: true }, outcome: "SUCCESS" });
});

test("idempotency middleware replays stored response", async () => {
  const record = {
    key: "key-1",
    request_hash: "hash",
    response_status: 201,
    response_body: { ok: true },
    outcome: "SUCCESS",
    updated_at: new Date(),
  };
  const store: IdempotencyStore = {
    reserve: async () => ({ state: "replay", record } as ReserveResult),
    save: async () => {
      throw new Error("should not save");
    },
  };
  const middleware = idempotency(store);
  const req = createReq();
  const res = createRes();
  const response = await middleware(req, res, () => {
    throw new Error("next should not be called");
  });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.payload, { ok: true });
  assert.equal(res.headers.get("Idempotent-Replay"), "true");
  assert.equal(response, res);
});

test("idempotency middleware rejects conflicting key", async () => {
  const store: IdempotencyStore = {
    reserve: async () => ({ state: "conflict" }),
    save: async () => {
      throw new Error("should not save");
    },
  };
  const middleware = idempotency(store);
  const req = createReq();
  const res = createRes();
  await middleware(req, res, () => {
    throw new Error("next should not be called");
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.payload, { error: "IDEMPOTENCY_KEY_MISMATCH" });
});

test("idempotency middleware returns pending for in-flight requests", async () => {
  const store: IdempotencyStore = {
    reserve: async () => ({ state: "pending" }),
    save: async () => {
      throw new Error("should not save");
    },
  };
  const middleware = idempotency(store);
  const req = createReq();
  const res = createRes();
  await middleware(req, res, () => {
    throw new Error("next should not be called");
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.payload, { error: "IDEMPOTENCY_KEY_PENDING" });
});
