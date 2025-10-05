import { jest } from "@jest/globals";
import crypto from "crypto";
import type { RptPayload } from "../../../../src/crypto/ed25519";

const DEV_SECRET_B64 = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const DEV_PUBLIC_B64 = "A6EHv/POEL4dcN0Y50vAmWfk1jCbpQ1fHdyGZBJVMbg=";

let mockQuery: jest.Mock;

function setupPgMock() {
  mockQuery = jest.fn();
  jest.unstable_mockModule("pg", () => ({
    Pool: class {
      query(sql: string, params?: any[]) {
        return mockQuery(sql, params);
      }
    }
  }));
}

function resetEnv() {
  process.env.RPT_ED25519_SECRET_BASE64 = DEV_SECRET_B64;
  process.env.RPT_PUBLIC_BASE64 = DEV_PUBLIC_B64;
  process.env.KMS_BACKEND = "local";
  delete process.env.RPT_KMS_BACKEND;
  delete process.env.PAYMENTS_KMS_BACKEND;
}

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  resetEnv();
  setupPgMock();
});

function base64ToBuffer(value: string): Buffer {
  const pad = value.length % 4;
  return Buffer.from(value + (pad ? "=".repeat(4 - pad) : ""), "base64");
}

test("issueRPT stores canonical payload and signature", async () => {
  const periodRow = {
    id: 1,
    state: "CLOSING",
    anomaly_vector: { variance_ratio: 0.01, dup_rate: 0.001, gap_minutes: 5, delta_vs_baseline: 0.05 },
    thresholds: {},
    final_liability_cents: 12345,
    credited_to_owa_cents: 12345,
    merkle_root: "abc123",
    running_balance_hash: "def456",
  };
  const inserts: any[] = [];

  mockQuery.mockImplementation(async (sql: string, params?: any[]) => {
    if (sql.includes("FROM periods")) {
      return { rows: [periodRow] };
    }
    if (sql.includes("INSERT INTO rpt_tokens")) {
      inserts.push({ sql, params });
      return { rowCount: 1 };
    }
    if (sql.includes("UPDATE periods SET state='READY_RPT'")) {
      return { rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { issueRPT } = await import("../../../../src/rpt/issuer.ts");
  const result = await issueRPT("12345678901", "GST", "2025-09", { epsilon_cents: 1 });

  expect(inserts).toHaveLength(1);
  const insertParams = inserts[0].params;
  expect(insertParams[5]).toBe(result.payload_c14n);
  expect(insertParams[6]).toBe(result.payload_sha256);
  expect(result.signature).toMatch(/^[A-Za-z0-9_-]+$/);
  expect(result.signature.includes("=")).toBe(false);
  expect(result.payload_sha256).toBe(crypto.createHash("sha256").update(result.payload_c14n).digest("hex"));
});

test("rptGate verifies Ed25519 signatures and hashes", async () => {
  const { canonicalJson, signRpt } = await import("../../../../src/crypto/ed25519.ts");
  const secretKey = new Uint8Array(base64ToBuffer(DEV_SECRET_B64));
  const payload: RptPayload = {
    entity_id: "12345678901",
    period_id: "2025-09",
    tax_type: "GST",
    amount_cents: 12345,
    merkle_root: "abc123",
    running_balance_hash: "def456",
    anomaly_vector: { variance_ratio: 0.01, dup_rate: 0.001, gap_minutes: 5, delta_vs_baseline: 0.05 },
    thresholds: { variance_ratio: 1 },
    rail_id: "EFT",
    reference: "PRN123",
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: "nonce-123",
  };
  const payloadC14n = canonicalJson(payload);
  const payloadSha256 = crypto.createHash("sha256").update(payloadC14n).digest("hex");
  const signature = signRpt(payload, secretKey);

  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM rpt_tokens")) {
      return {
        rows: [
          {
            rpt_id: 42,
            payload_c14n: payloadC14n,
            payload_sha256: payloadSha256,
            signature,
            expires_at: new Date(Date.now() + 60 * 1000).toISOString(),
            status: "active",
            nonce: payload.nonce,
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const { rptGate } = await import("../src/middleware/rptGate.ts");
  const req: any = { body: { abn: payload.entity_id, taxType: payload.tax_type, periodId: payload.period_id } };
  const res: any = {
    statusCode: 200,
    body: null,
    status(code: number) { this.statusCode = code; return this; },
    json(obj: any) { this.body = obj; return this; }
  };
  const next = jest.fn();

  await rptGate(req, res, next);

  expect(next).toHaveBeenCalledTimes(1);
  expect(res.body).toBeNull();
  expect(req.rpt.payload_sha256).toBe(payloadSha256);
});
