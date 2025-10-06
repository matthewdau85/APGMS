process.env.NODE_ENV = "test";
process.env.SKIP_LISTEN = "true";
process.env.AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET || "test-secret";

import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

type AuthClaims = import("../../src/http/auth").AuthClaims;
type ExpressApp = import("express").Express;

let app: ExpressApp;
let signJwtFn: (claims: AuthClaims, expiresIn?: string | number) => string;
let adminMfaToken: string;

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

let server: Server;
let baseUrl: string;

test.before(async () => {
  ({ app } = await import("../../src/index"));
  ({ signJwt: signJwtFn } = await import("../../src/http/auth"));

  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;

  adminMfaToken = signJwtFn({ sub: "admin-step", role: "admin", mfa: true } as AuthClaims, "5m");
  await httpRequest("POST", "/admin/mode", { mode: "sandbox" }, {
    Authorization: `Bearer ${adminMfaToken}`,
  });
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test.beforeEach(async () => {
  await httpRequest("POST", "/admin/mode", { mode: "sandbox" }, {
    Authorization: `Bearer ${adminMfaToken}`,
  });
});

async function httpRequest(method: HttpMethod, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = {
    method,
    headers: { ...headers },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "content-type": "application/json", ...headers };
  }
  const res = await fetch(`${baseUrl}${path}`, init);
  const text = await res.text();
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  const headerObj: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headerObj[key.toLowerCase()] = value;
  });
  return { status: res.status, body: json, headers: headerObj };
}

test("helmet and logger headers are applied", async () => {
  const res = await httpRequest("GET", "/health");
  assert.equal(res.status, 200);
  assert.ok(res.headers["x-dns-prefetch-control"], "helmet header missing");
  assert.ok(res.headers["x-request-id"], "request id header missing");
});

test("release rejects missing authentication", async () => {
  const res = await httpRequest("POST", "/api/release", {});
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "UNAUTHENTICATED");
});

test("release blocks unauthorized roles", async () => {
  const token = signJwtFn({ sub: "auditor-1", role: "auditor" } as AuthClaims, "5m");
  const res = await httpRequest("POST", "/api/release", {}, {
    Authorization: `Bearer ${token}`,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "FORBIDDEN");
});

test("release requires MFA in real mode", async () => {
  await httpRequest("POST", "/admin/mode", { mode: "real" }, {
    Authorization: `Bearer ${adminMfaToken}`,
  });
  const token = signJwtFn({ sub: "acct-1", role: "accountant" } as AuthClaims, "5m");
  const res = await httpRequest("POST", "/api/release", {}, {
    Authorization: `Bearer ${token}`,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "MFA_REQUIRED");
});

test("release allows step-up token in real mode", async () => {
  await httpRequest("POST", "/admin/mode", { mode: "real" }, {
    Authorization: `Bearer ${adminMfaToken}`,
  });
  const token = signJwtFn({ sub: "acct-2", role: "accountant", mfa: true } as AuthClaims, "5m");
  const res = await httpRequest("POST", "/api/release", {}, {
    Authorization: `Bearer ${token}`,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "Missing fields");
});

test("admin mode transition to real requires MFA", async () => {
  const token = signJwtFn({ sub: "admin-1", role: "admin" } as AuthClaims, "5m");
  const res = await httpRequest("POST", "/admin/mode", { mode: "real" }, {
    Authorization: `Bearer ${token}`,
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "MFA_REQUIRED");
});

test("admin can view mode", async () => {
  const token = signJwtFn({ sub: "admin-2", role: "admin", mfa: true } as AuthClaims, "5m");
  const res = await httpRequest("GET", "/admin/mode", undefined, {
    Authorization: `Bearer ${token}`,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.mode, "sandbox");
});
