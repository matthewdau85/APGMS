import { setPoolForTests } from "../../src/db/pool";
import { sha256Hex } from "../../src/crypto/merkle";

type QueryResult = { rows: any[]; rowCount: number };

class FakePool {
  remittanceDestinations: Array<{ abn: string; rail: string; reference: string; label: string; account_bsb: string; account_number: string }> = [];
  idempotency = new Map<string, { last_status: string; created_at: Date }>();
  ledger: Array<any> = [];
  audit: Array<{ seq: number; terminal_hash: string } & Record<string, any>> = [];
  shadow: Array<any> = [];
  ledgerSeq = 0;
  auditSeq = 0;
  shadowSeq = 0;

  async query(text: string, params: any[] = []): Promise<QueryResult> {
    const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();

    if (normalized.startsWith("select * from remittance_destinations")) {
      const [abn, rail, reference] = params;
      const rows = this.remittanceDestinations.filter(
        (r) => r.abn === abn && r.rail === rail && r.reference === reference
      );
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith("insert into idempotency_keys")) {
      const [key, status] = params;
      if (this.idempotency.has(key)) {
        const err: any = new Error("duplicate");
        err.code = "23505";
        throw err;
      }
      this.idempotency.set(key, { last_status: status, created_at: new Date() });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("update idempotency_keys")) {
      const [status, key] = params;
      const entry = this.idempotency.get(key);
      if (entry) entry.last_status = status;
      return { rows: [], rowCount: entry ? 1 : 0 };
    }

    if (normalized.startsWith("select terminal_hash from audit_log")) {
      const last = this.audit.length ? this.audit[this.audit.length - 1] : undefined;
      return { rows: last ? [{ terminal_hash: last.terminal_hash }] : [], rowCount: last ? 1 : 0 };
    }

    if (normalized.startsWith("insert into audit_log")) {
      const [actor, action, payload_hash, prev_hash, terminal_hash] = params;
      this.audit.push({ seq: ++this.auditSeq, actor, action, payload_hash, prev_hash, terminal_hash, created_at: new Date() });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("select balance_after_cents")) {
      const rows = this.ledger.length ? [this.ledger[this.ledger.length - 1]] : [];
      return {
        rows: rows.map((row) => ({ balance_after_cents: row.balance_after_cents, hash_after: row.hash_after })),
        rowCount: rows.length,
      };
    }

    if (normalized.startsWith("select count(*) from owa_ledger")) {
      return { rows: [{ count: this.ledger.length }], rowCount: 1 };
    }

    if (normalized.startsWith("select count(*) from shadow_observations")) {
      return { rows: [{ count: this.shadow.length }], rowCount: 1 };
    }

    if (normalized.startsWith("select balance_after_cents from owa_ledger")) {
      const last = this.ledger.length ? this.ledger[this.ledger.length - 1] : undefined;
      return { rows: last ? [{ balance_after_cents: last.balance_after_cents }] : [], rowCount: last ? 1 : 0 };
    }

    if (normalized.startsWith("insert into owa_ledger")) {
      const [abn, taxType, periodId, transferUuid, amount, balanceAfter, bankReceiptHash, prevHash, hashAfter] = params;
      this.ledger.push({
        id: ++this.ledgerSeq,
        abn,
        tax_type: taxType,
        period_id: periodId,
        transfer_uuid: transferUuid,
        amount_cents: amount,
        balance_after_cents: balanceAfter,
        bank_receipt_hash: bankReceiptHash,
        prev_hash: prevHash,
        hash_after: hashAfter,
        created_at: new Date(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("insert into shadow_observations")) {
      const [traceId, operation, mockStatus, realStatus, mockBody, realBody, mockLatency, realLatency, latencyDelta, statusMismatch, bodyMismatch] = params;
      this.shadow.push({
        id: ++this.shadowSeq,
        trace_id: traceId,
        operation,
        mock_status: mockStatus,
        real_status: realStatus,
        mock_body: mockBody,
        real_body: realBody,
        mock_latency_ms: mockLatency,
        real_latency_ms: realLatency,
        latency_delta_ms: latencyDelta,
        status_mismatch: statusMismatch,
        body_mismatch: bodyMismatch,
        created_at: new Date(),
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("select status_mismatch")) {
      const rows = this.shadow.map((row) => ({
        status_mismatch: row.status_mismatch,
        body_mismatch: row.body_mismatch,
        latency_delta_ms: row.latency_delta_ms,
      }));
      return { rows, rowCount: rows.length };
    }

    throw new Error(`Unsupported query: ${text}`);
  }
}

async function main() {
  const pool = new FakePool();
  setPoolForTests(pool as any);

  const { releasePayment, __resetShadowChaosCounter } = await import("../../src/rails/adapter");
  const { getShadowReport } = await import("../../src/shadow/report");

  pool.remittanceDestinations.push({
    abn: "111",
    rail: "EFT",
    reference: "REF123",
    label: "Primary",
    account_bsb: "000000",
    account_number: "12345678",
  });

  const initialHash = sha256Hex("seed");
  await pool.query(
    "insert into owa_ledger(abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,prev_hash,hash_after) values (,,,,,,,,)",
    ["111", "GST", "2025-Q1", "seed", 500000, 500000, "seed", "", initialHash]
  );

  process.env.SHADOW_MODE = "true";
  process.env.SHADOW_MOCK_CHAOS_PCT = "0.25";
  process.env.REAL_PROVIDER_LATENCY_MS = "15";
  __resetShadowChaosCounter();

  const totalReleases = 20;
  for (let i = 0; i < totalReleases; i++) {
    await releasePayment("111", "GST", "2025-Q1", 10000, "EFT", "REF123");
  }

  const report = await getShadowReport();
  const shadowCount = pool.shadow.length;
  const ledgerCount = pool.ledger.length;
  const lastBalance = pool.ledger[pool.ledger.length - 1]?.balance_after_cents ?? 0;

  const output = {
    mismatch_rate: report.mismatch_rate,
    mismatch_count: report.mismatch_count,
    total: report.total,
    shadow_records: shadowCount,
    ledger_rows: ledgerCount,
    last_balance: lastBalance,
  };

  console.log(JSON.stringify(output));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
