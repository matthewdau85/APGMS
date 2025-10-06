import express from "express";
import request from "supertest";
import { describe, beforeEach, it, expect } from "vitest";

import { applySecurityHeaders } from "../../src/ops/headers";

function buildApp() {
  const app = express();
  applySecurityHeaders(app);
  app.get("/test", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("security headers", () => {
  beforeEach(() => {
    process.env.CORS_ALLOW_LIST = "https://client.test";
    process.env.RATE_LIMIT_PER_MINUTE = "2";
  });

  it("sets expected headers", async () => {
    const app = buildApp();
    const res = await request(app).get("/test").set("Origin", "https://client.test");
    expect(res.headers["content-security-policy"]).toBeDefined();
    expect(res.headers["strict-transport-security"]).toContain("max-age");
    expect(res.headers["access-control-allow-origin"]).toBe("https://client.test");
  });

  it("enforces rate limit", async () => {
    const app = buildApp();
    await request(app).get("/test").set("Origin", "https://client.test");
    await request(app).get("/test").set("Origin", "https://client.test");
    const limited = await request(app).get("/test").set("Origin", "https://client.test");
    expect(limited.status).toBe(429);
  });
});
