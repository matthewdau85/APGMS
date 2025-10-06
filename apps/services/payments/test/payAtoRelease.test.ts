process.env.RELEASE_ABN_ALLOWLIST = "12345678901";

import type { Request, Response } from "express";
import { payAtoRelease } from "../src/routes/payAto";

function mockRes() {
  const res: Partial<Response> & { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn(),
    json: jest.fn(),
  } as any;

  res.status.mockImplementation(function status(this: Response, code: number) {
    (this as any).statusCode = code;
    return this;
  });

  res.json.mockImplementation(function json(this: Response, payload: unknown) {
    (this as any).body = payload;
    return this;
  });

  return res as Response & { status: jest.Mock; json: jest.Mock; body?: any; statusCode?: number };
}

describe("payAtoRelease", () => {
  it("returns a dry-run receipt", async () => {
    const req = {
      body: {
        abn: "12345678901",
        taxType: "GST",
        periodId: "2025Q2",
        currency: "AUD",
        amountCents: 12500,
        mode: "DRY_RUN" as const,
      },
      rpt: { rpt_id: 1, kid: "kid", payload_sha256: "hash" },
    } as unknown as Request;

    const res = mockRes();
    await payAtoRelease(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledTimes(1);
    const payload = res.body;
    expect(payload?.dry_run).toBe(true);
    expect(payload?.amount_cents).toBe(12500);
    expect(payload?.currency).toBe("AUD");
    expect(payload?.ok).toBe(true);
  });

  it("rejects negative amounts without reversal", async () => {
    const req = {
      body: {
        abn: "12345678901",
        taxType: "GST",
        periodId: "2025Q2",
        currency: "AUD",
        amountCents: -5000,
        mode: "DRY_RUN" as const,
      },
      rpt: { rpt_id: 1, kid: "kid", payload_sha256: "hash" },
    } as unknown as Request;

    const res = mockRes();
    await payAtoRelease(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "Validation failed" }));
  });

  it("rejects non-allowlisted ABNs", async () => {
    const req = {
      body: {
        abn: "00000000000",
        taxType: "GST",
        periodId: "2025Q2",
        currency: "AUD",
        amountCents: 5000,
        mode: "DRY_RUN" as const,
      },
      rpt: { rpt_id: 1, kid: "kid", payload_sha256: "hash" },
    } as unknown as Request;

    const res = mockRes();
    await payAtoRelease(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: "ABN not allowlisted" }));
  });
});
