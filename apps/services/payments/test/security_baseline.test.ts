import { payAtoRelease } from "../src/routes/payAto";
import { appendAudit, resetAuditMemory, getAuditMemory } from "../src/audit/log";
import { resetApprovals } from "../src/services/approvals";
import { resetAll as resetMfa } from "../src/auth/mfa";
import { pool } from "../src/index";

type MockResponse = {
  statusCode: number;
  payload: any;
  status: jest.MockedFunction<(code: number) => MockResponse>;
  json: jest.MockedFunction<(body: any) => MockResponse>;
  end: jest.MockedFunction<() => MockResponse>;
};

function createResponse(): MockResponse {
  const res: any = {
    statusCode: 200,
    payload: undefined,
  };
  res.status = jest.fn().mockImplementation((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn().mockImplementation((body: any) => {
    res.payload = body;
    return res;
  });
  res.end = jest.fn().mockReturnValue(res);
  return res;
}

beforeEach(() => {
  resetAuditMemory();
  resetApprovals();
  resetMfa();
  jest.restoreAllMocks();
  delete process.env.DATABASE_URL;
});

test("release requires MFA step-up", async () => {
  const req: any = {
    body: { abn: "123", taxType: "GST", periodId: "2025-09", amountCents: -100 },
    auth: { userId: "op-1", role: "operator", mfa: false },
  };
  const res = createResponse();
  await payAtoRelease(req, res as any);
  expect(res.status).toHaveBeenCalledWith(403);
  expect(res.payload).toMatchObject({ error: "MFA_REQUIRED" });
});

test("high value release requires dual approval", async () => {
  process.env.RELEASE_LIMIT_CENTS = "1000";
  const mockClient = {
    query: jest.fn().mockImplementation(async (sql: string) => {
      if (sql === "BEGIN") return { rows: [] };
      if (sql.includes("ORDER BY id DESC")) return { rows: [{ balance_after_cents: 0 }] };
      if (sql === "COMMIT") return { rows: [] };
      if (sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("INSERT INTO owa_ledger")) {
        return { rows: [{ id: 1, transfer_uuid: "tx-1", balance_after_cents: -2000 }] };
      }
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  jest.spyOn(pool, "connect").mockResolvedValue(mockClient as any);

  const firstReq: any = {
    body: { abn: "123", taxType: "GST", periodId: "2025-09", amountCents: -2000, rail: "EFT" },
    auth: { userId: "op-1", role: "operator", mfa: true },
    rpt: { rpt_id: "rpt-1", kid: "kid", payload_sha256: "sha" },
  };
  const firstRes = createResponse();
  await payAtoRelease(firstReq, firstRes as any);
  expect(firstRes.statusCode).toBe(202);
  expect(firstRes.payload.pending).toBe(true);
  const token = firstRes.payload.approvalToken;
  expect(token).toBeTruthy();

  const secondReq: any = {
    body: { abn: "123", taxType: "GST", periodId: "2025-09", amountCents: -2000, rail: "EFT", approvalToken: token },
    auth: { userId: "ap-1", role: "approver", mfa: true },
    rpt: { rpt_id: "rpt-1", kid: "kid", payload_sha256: "sha" },
  };
  const secondRes = createResponse();
  await payAtoRelease(secondReq, secondRes as any);
  expect(secondRes.statusCode).toBe(200);
  expect(secondRes.payload.ok).toBe(true);
  expect(mockClient.query).toHaveBeenCalled();
});

test("audit log chain remains continuous", async () => {
  await appendAudit({ actor: "alice", action: "deposit", target: "123:GST:2025-09", payload: { amount: 100 } });
  await appendAudit({ actor: "bob", action: "approve", target: "123:GST:2025-09", payload: { token: "abc" } });
  await appendAudit({ actor: "carol", action: "release", target: "123:GST:2025-09", payload: { transfer_uuid: "tx" } });
  const rows = getAuditMemory();
  expect(rows).toHaveLength(3);
  expect(rows[1].prev_hash).toBe(rows[0].hash);
  expect(rows[2].prev_hash).toBe(rows[1].hash);
});
