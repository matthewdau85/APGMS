import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { describe, beforeAll, beforeEach, it, expect, vi } from "vitest";
import { authenticator } from "otplib";

import { paymentsApi } from "../../src/api/payments";
import { Payments } from "../../libs/paymentsClient";
import { resetApprovals } from "../../src/approvals/dual";
import { beginSetup, resetMfa, verifyToken } from "../../src/security/mfa";
import { setAppMode } from "../../src/security/state";

const SECRET = "test-shared";

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", paymentsApi);
  return app;
}

describe("release guards", () => {
  beforeAll(() => {
    process.env.APP_JWT_SECRET = SECRET;
    process.env.RELEASE_DUAL_APPROVAL_THRESHOLD_CENTS = "100000";
  });

  beforeEach(() => {
    setAppMode("demo");
    resetApprovals();
    resetMfa();
    vi.restoreAllMocks();
    vi.spyOn(Payments, "payAto").mockResolvedValue({ ok: true });
  });

  function token(userId: string, role: "admin" | "accountant" | "auditor") {
    return jwt.sign({ sub: userId, role }, SECRET, { algorithm: "HS256" });
  }

  it("rejects release without JWT", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/release").send({
      abn: "123", taxType: "PAYGW", periodId: "2024-09", amountCents: -200000,
    });
    expect(res.status).toBe(401);
  });

  it("requires MFA when mode is real", async () => {
    const app = buildApp();
    setAppMode("real");
    const res = await request(app)
      .post("/api/release")
      .set("Authorization", `Bearer ${token("user1", "admin")}`)
      .send({ abn: "123", taxType: "PAYGW", periodId: "2024-09", amountCents: -200000 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("MFA_REQUIRED");
  });

  it("requires dual approval over threshold", async () => {
    const app = buildApp();
    setAppMode("real");

    const setup1 = beginSetup("user1");
    const setup2 = beginSetup("user2");
    verifyToken("user1", authenticator.generate(setup1.secret));
    verifyToken("user2", authenticator.generate(setup2.secret));

    const payload = { abn: "123", taxType: "PAYGW", periodId: "2024-09", amountCents: -200000 };

    const first = await request(app)
      .post("/api/release")
      .set("Authorization", `Bearer ${token("user1", "admin")}`)
      .send(payload);
    expect(first.status).toBe(403);
    expect(first.body.error).toBe("SECOND_APPROVER_REQUIRED");

    const second = await request(app)
      .post("/api/release")
      .set("Authorization", `Bearer ${token("user1", "admin")}`)
      .send(payload);
    expect(second.status).toBe(403);
    expect(second.body.error).toBe("SECOND_APPROVER_REQUIRED");

    const approved = await request(app)
      .post("/api/release")
      .set("Authorization", `Bearer ${token("user2", "accountant")}`)
      .send(payload);
    expect(approved.status).toBe(200);
    expect(Payments.payAto).toHaveBeenCalledTimes(1);
  });
});
