import { securityHeaders, signJwt, generateTotp } from "../../../../libs/security/index.js";

describe("release guards", () => {
  const secret = "JBSWY3DPEHPK3PXP"; // base32 for tests

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret";
    process.env.TOTP_SECRET = secret;
    process.env.DUAL_APPROVAL_THRESHOLD_CENTS = "1000";
    process.env.APP_MODE = "test";
    jest.resetModules();
  });

  const createReqRes = (headers: Record<string, string> = {}, body: any = {}) => {
    const resHeaders: Record<string, string> = {};
    const req: any = { headers, body };
    const res: any = {
      statusCode: 200,
      payload: undefined as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: any) {
        this.payload = payload;
        return this;
      },
      setHeader(name: string, value: string) {
        resHeaders[name] = value;
      },
      getHeader(name: string) {
        return resHeaders[name];
      },
    };
    const next = jest.fn();
    return { req, res, resHeaders, next };
  };

  test("authenticate enforces bearer token", async () => {
    const { authenticate } = await import("../src/middleware/auth.js");
    const { req, res, next } = createReqRes();
    authenticate(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(res.payload).toEqual({ error: "AUTH_REQUIRED" });

    const token = signJwt({ sub: "user-1", roles: ["admin"] }, process.env.JWT_SECRET!);
    const ctx = createReqRes({ authorization: `Bearer ${token}` });
    authenticate(ctx.req, ctx.res, ctx.next);
    expect(ctx.next).toHaveBeenCalled();
    expect(ctx.req.auth).toMatchObject({ sub: "user-1", roles: ["admin"] });
  });

  test("role guard blocks insufficient roles", async () => {
    const { authenticate, requireRoles } = await import("../src/middleware/auth.js");
    const token = signJwt({ sub: "acct", roles: ["accountant"] }, process.env.JWT_SECRET!);
    const { req, res, next } = createReqRes({ authorization: `Bearer ${token}` });
    authenticate(req, res, next);
    expect(next).toHaveBeenCalled();

    const guard = requireRoles("admin");
    const fail = createReqRes();
    fail.req.auth = req.auth;
    guard(fail.req, fail.res, fail.next);
    expect(fail.res.statusCode).toBe(403);
    expect(fail.res.payload).toEqual({ error: "INSUFFICIENT_ROLE" });
  });

  test("TOTP required when mode is real", async () => {
    const { ensureRealModeTotp, setAppMode } = await import("../src/middleware/auth.js");
    setAppMode("real");
    const first = createReqRes();
    ensureRealModeTotp(first.req, first.res, first.next);
    expect(first.res.statusCode).toBe(401);
    expect(first.res.payload).toEqual({ error: "MFA_REQUIRED" });

    const pass = createReqRes({ "x-totp": generateTotp(secret) });
    ensureRealModeTotp(pass.req, pass.res, pass.next);
    expect(pass.next).toHaveBeenCalled();
  });

  test("dual approval requires distinct co-signer", async () => {
    const { authenticate, requireDualApproval } = await import("../src/middleware/auth.js");
    const primaryToken = signJwt({ sub: "admin-1", roles: ["admin"] }, process.env.JWT_SECRET!);
    const { req, res, next } = createReqRes({ authorization: `Bearer ${primaryToken}` });
    authenticate(req, res, next);

    expect(() => requireDualApproval(req, 5000)).toThrow("DUAL_APPROVAL_REQUIRED");

    req.body = { coSignerToken: signJwt({ sub: "admin-1", roles: ["admin"] }, process.env.JWT_SECRET!) };
    expect(() => requireDualApproval(req, 5000)).toThrow("DUAL_APPROVAL_DISTINCT");

    req.body = { coSignerToken: signJwt({ sub: "auditor-1", roles: ["auditor"] }, process.env.JWT_SECRET!) };
    expect(() => requireDualApproval(req, 5000)).toThrow("DUAL_APPROVAL_FORBIDDEN");

    req.body = { coSignerToken: signJwt({ sub: "admin-2", roles: ["admin"] }, process.env.JWT_SECRET!) };
    expect(() => requireDualApproval(req, 5000)).not.toThrow();
  });

  test("security headers applied", () => {
    const middleware = securityHeaders();
    const { req, res, resHeaders, next } = createReqRes();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(resHeaders["X-Frame-Options"]).toBe("SAMEORIGIN");
    expect(resHeaders["X-Content-Type-Options"]).toBe("nosniff");
  });
});
