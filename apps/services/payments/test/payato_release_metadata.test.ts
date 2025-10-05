import type { Request, Response } from "express";

const mockQuery = jest.fn();
const mockRelease = jest.fn();
const mockClient = { query: mockQuery, release: mockRelease };
const mockConnect = jest.fn().mockResolvedValue(mockClient);

jest.mock("../src/index.js", () => ({
  pool: { connect: mockConnect },
}));

import { payAtoRelease } from "../src/routes/payAto.js";

describe("payAtoRelease", () => {
  beforeEach(() => {
    mockConnect.mockClear();
    mockQuery.mockReset();
    mockRelease.mockClear();
  });

  test("includes verified RPT metadata in release response", async () => {
    mockQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42, transfer_uuid: "uuid-x", balance_after_cents: "-100" }] })
      .mockResolvedValueOnce({});

    const req = {
      body: { abn: "12345678901", taxType: "GST", periodId: "2025-09", amountCents: -100 },
      rpt: {
        rpt_id: 7,
        key_id: "ato-key-1",
        nonce: "nonce-123",
        payload_sha256: "a".repeat(64),
      },
    } as unknown as Request & { rpt: any };

    const json = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      json,
    } as unknown as Response;

    await payAtoRelease(req, res);

    expect(json).toHaveBeenCalledTimes(1);
    const payload = json.mock.calls[0][0];
    expect(payload.ok).toBe(true);
    expect(payload.rpt_ref).toEqual({
      rpt_id: 7,
      key_id: "ato-key-1",
      nonce: "nonce-123",
      payload_sha256: "a".repeat(64),
    });
  });
});
