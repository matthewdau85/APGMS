import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  ingest,
  getPeriods,
  getDlq,
  replayDlq,
  resetStore,
  getFeedStatuses,
} from "../../src/recon/store";

describe("recon flow", () => {
  beforeEach(() => {
    resetStore();
  });

  test("happy path transitions to READY_RPT when within tolerance", () => {
    const payroll = ingest("payroll", {
      abn: "123456789",
      taxType: "PAYGW",
      periodId: "2025-Q1",
      amountCents: 10000,
      toleranceCents: 500,
    });
    assert.equal(payroll.ok, true);

    const bank = ingest("bank", {
      abn: "123456789",
      taxType: "PAYGW",
      periodId: "2025-Q1",
      amountCents: 10000,
    });
    assert.equal(bank.ok, true);
    assert.equal(bank.recon?.event, "PASS");

    const period = getPeriods().find((p) => p.periodId === "2025-Q1");
    assert.ok(period);
    assert.equal(period?.state, "READY_RPT");
    assert.equal(period?.deltaCents, 0);

    const payrollStatus = getFeedStatuses().find((s) => s.feed === "payroll");
    assert.equal(payrollStatus?.success, 1);
  });

  test("fail path blocks the period when delta exceeds tolerance", () => {
    ingest("payroll", {
      abn: "123456789",
      taxType: "PAYGW",
      periodId: "2025-Q2",
      amountCents: 10000,
      toleranceCents: 400,
    });

    const bank = ingest("bank", {
      abn: "123456789",
      taxType: "PAYGW",
      periodId: "2025-Q2",
      amountCents: 9000,
    });
    assert.equal(bank.ok, true);
    assert.equal(bank.recon?.event, "FAIL_DISCREPANCY");

    const period = getPeriods().find((p) => p.periodId === "2025-Q2");
    assert.ok(period);
    assert.equal(period?.state, "BLOCKED_DISCREPANCY");
    assert.equal(period?.deltaCents, 1000);
  });

  test("dlq replay reprocesses out-of-order bank events", () => {
    const firstBank = ingest("bank", {
      abn: "555555555",
      taxType: "PAYGW",
      periodId: "2025-Q3",
      amountCents: 8500,
    });
    assert.equal(firstBank.ok, false);
    assert.equal(getDlq().length, 1);

    ingest("payroll", {
      abn: "555555555",
      taxType: "PAYGW",
      periodId: "2025-Q3",
      amountCents: 8500,
    });

    const summary = replayDlq();
    assert.equal(summary.attempted, 1);
    assert.equal(summary.succeeded, 1);
    assert.equal(getDlq().length, 0);

    const period = getPeriods().find((p) => p.periodId === "2025-Q3");
    assert.ok(period);
    assert.equal(period?.state, "READY_RPT");
    assert.equal(period?.deltaCents, 0);
  });
});
