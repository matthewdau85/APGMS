import test from "node:test";
import assert from "node:assert/strict";
import request from "supertest";

import app from "../../src/server";

test("GET /api/health responds with ok status", async () => {
  const response = await request(app).get("/api/health");

  assert.equal(response.status, 200);
  assert.ok(response.type.startsWith("application/json"));
  assert.deepEqual(response.body, { status: "ok" });
});

test("unknown API route responds with JSON 404", async () => {
  const response = await request(app).get("/api/does-not-exist");

  assert.equal(response.status, 404);
  assert.ok(response.type.startsWith("application/json"));
  assert.deepEqual(response.body, { error: "Not Found" });
});
