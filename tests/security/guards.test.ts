import test from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";

import { createApp } from "../../src/index";
import { signJwt } from "../../src/http/auth";
import { setAppMode } from "../../src/config/appMode";
import * as paymentsClient from "../../libs/paymentsClient";
import * as approvals from "../../src/approvals/dual";

process.env.NODE_ENV = "test";
process.env.AUTH_JWT_SECRET = "test-secret";
process.env.RATES_VERSION = "2024-25";
process.env.RELEASE_APPROVAL_THRESHOLD_CENTS = "1000";

const originalPayAto = paymentsClient.Payments.payAto;

async function requestRelease(token: string) {
  const app = createApp();
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}/api/release`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ abn: "123", taxType: "PAYGW", periodId: "2025-09", amountCents: -5000 })
  });
  const body = await response.json().catch(() => ({}));
  server.close();
  return { response, body };
}

test("rejects release without MFA in real mode", async () => {
  setAppMode("real");
  paymentsClient.Payments.payAto = async () => ({ ok: true } as any);
  const bearer = signJwt({ id: "u1", email: "u1@example.com", role: "admin", mfa: false });
  const { response, body } = await requestRelease(bearer);
  assert.ok(response.status >= 400 && response.status < 500);
  assert.equal(body.error, "MFA_REQUIRED");
  paymentsClient.Payments.payAto = originalPayAto;
});

test("requires two distinct approvals over threshold", async () => {
  setAppMode("real");
  paymentsClient.Payments.payAto = async () => ({ ok: true } as any);
  class MockPool {
    private requests = new Map<string, { id: number; approved_at: string | null }>();
    private approvals = new Map<number, Set<string>>();
    private seq = 1;
    async query(sql: string, params: any[]) {
      const text = sql.toLowerCase();
      if (text.startsWith("create table")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("insert into release_approval_requests")) {
        const key = params[0];
        let record = this.requests.get(key);
        if (!record) {
          record = { id: this.seq++, approved_at: null };
          this.requests.set(key, record);
        }
        return { rows: [{ id: record.id, approved_at: record.approved_at }], rowCount: 1 };
      }
      if (text.includes("insert into release_approvals")) {
        const requestId = params[0];
        const userId = params[1];
        let set = this.approvals.get(requestId);
        if (!set) {
          set = new Set();
          this.approvals.set(requestId, set);
        }
        set.add(userId);
        return { rows: [], rowCount: 1 };
      }
      if (text.includes("select count(distinct user_id)")) {
        const requestId = params[0];
        const count = this.approvals.get(requestId)?.size ?? 0;
        return { rows: [{ approvals: count }], rowCount: 1 };
      }
      if (text.startsWith("update release_approval_requests")) {
        const requestId = params[0];
        for (const record of this.requests.values()) {
          if (record.id === requestId) {
            record.approved_at = new Date().toISOString();
          }
        }
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
  }
  const mockPool = new MockPool();
  approvals.setApprovalPool(mockPool as any);

  const admin1 = signJwt({ id: "admin-1", email: "a1@example.com", role: "admin", mfa: true });
  const first = await requestRelease(admin1);
  assert.equal(first.response.status, 403);
  assert.equal(first.body.error, "AWAITING_SECOND_APPROVAL");

  const admin2 = signJwt({ id: "admin-2", email: "a2@example.com", role: "admin", mfa: true });
  const second = await requestRelease(admin2);
  assert.equal(second.response.status, 200);

  const approvalsCount = await mockPool.query(
    "select count(distinct user_id) as approvals from release_approvals where request_id=$1",
    [1]
  );
  assert.equal(Number(approvalsCount.rows[0]?.approvals ?? 0), 2);

  paymentsClient.Payments.payAto = originalPayAto;
  approvals.resetApprovalPool();
});
