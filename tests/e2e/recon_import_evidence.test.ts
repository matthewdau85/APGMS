import test from "node:test";
import assert from "node:assert/strict";
import { releaseSimPayment } from "../../src/sim/rail/provider";
import { applySettlementImport, toSettlementRecords } from "../../src/settlement/import";
import { buildEvidenceBundle } from "../../src/evidence/bundle";

type Row = Record<string, any>;

class MemoryDb {
  private simByKey = new Map<string, Row>();
  private simByRef = new Map<string, Row>();
  private settlements = new Map<string, Row>();
  private settlementImports: Row[] = [];
  private periods = new Map<string, Row>();
  private rptTokens = new Map<string, Row[]>();
  private auditLog: Row[] = [];

  constructor() {
    this.auditLog.push({ seq: 1, ts: new Date(), actor: "system", action: "release", payload_hash: "abc", terminal_hash: "hash1" });
  }

  seedPeriod(row: Row) {
    const key = this.periodKey(row.abn, row.tax_type, row.period_id);
    this.periods.set(key, { ...row });
  }

  seedRptToken(row: Row) {
    const key = this.periodKey(row.abn, row.tax_type, row.period_id);
    const list = this.rptTokens.get(key) ?? [];
    list.push(row);
    this.rptTokens.set(key, list);
  }

  async query(sql: string, params: any[] = []) {
    const normalized = sql.trim().toLowerCase();
    if (normalized.startsWith("select provider_ref, paid_at from sim_settlements where idem_key")) {
      const existing = this.simByKey.get(params[0]);
      return { rows: existing ? [existing] : [], rowCount: existing ? 1 : 0 };
    }
    if (normalized.startsWith("insert into sim_settlements")) {
      const row = {
        provider_ref: params[0],
        rail: params[1],
        amount_cents: params[2],
        abn: params[3],
        period_id: params[4],
        idem_key: params[5],
        paid_at: params[6] instanceof Date ? params[6] : new Date(params[6]),
      };
      this.simByKey.set(row.idem_key, row);
      this.simByRef.set(row.provider_ref, row);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("insert into settlements(")) {
      const row = {
        provider_ref: params[0],
        abn: params[1],
        tax_type: params[2],
        period_id: params[3],
        rail: params[4],
        amount_cents: params[5],
        paid_at: params[6] instanceof Date ? params[6] : new Date(params[6]),
        simulated: params[7],
        idem_key: params[8],
        verified: false,
      };
      this.settlements.set(row.provider_ref, row);
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("insert into settlement_imports")) {
      this.settlementImports.push({ raw_payload: params[0], imported_at: new Date() });
      return { rows: [], rowCount: 1 };
    }
    if (normalized.startsWith("update settlements set rail=$2")) {
      const providerRef = params[0];
      const row = this.settlements.get(providerRef);
      if (!row) {
        return { rows: [], rowCount: 0 };
      }
      row.rail = params[1];
      row.amount_cents = params[2];
      row.paid_at = params[3] instanceof Date ? params[3] : new Date(params[3]);
      row.verified = true;
      row.verified_at = new Date();
      return { rows: [row], rowCount: 1 };
    }
    if (normalized.startsWith("select count(*)::int as pending from settlements")) {
      const [abn, taxType, periodId] = params;
      const pending = Array.from(this.settlements.values()).filter(
        (row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId && !row.verified,
      ).length;
      return { rows: [{ pending }], rowCount: 1 };
    }
    if (normalized.startsWith("update periods set settlement_verified=true")) {
      const key = this.periodKey(params[0], params[1], params[2]);
      const row = this.periods.get(key);
      if (row) row.settlement_verified = true;
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (normalized.startsWith("select * from periods where")) {
      const key = this.periodKey(params[0], params[1], params[2]);
      const row = this.periods.get(key);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (normalized.startsWith("select * from rpt_tokens where")) {
      const key = this.periodKey(params[0], params[1], params[2]);
      const rows = this.rptTokens.get(key) ?? [];
      const sorted = [...rows].sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      return { rows: sorted.slice(0, 1), rowCount: Math.min(sorted.length, 1) };
    }
    if (normalized.startsWith("select * from settlements where")) {
      const [abn, taxType, periodId] = params;
      const rows = Array.from(this.settlements.values()).filter(
        (row) => row.abn === abn && row.tax_type === taxType && row.period_id === periodId,
      );
      rows.sort((a, b) => new Date(b.paid_at).getTime() - new Date(a.paid_at).getTime());
      return { rows: rows.slice(0, 1), rowCount: rows.length ? 1 : 0 };
    }
    if (normalized.startsWith("select seq, ts, actor, action, payload_hash, terminal_hash from audit_log")) {
      return { rows: [...this.auditLog], rowCount: this.auditLog.length };
    }
    throw new Error(`Unsupported query: ${sql}`);
  }

  private periodKey(abn: string, taxType: string, periodId: string) {
    return `${abn}|${taxType}|${periodId}`;
  }

  exportCsv(): string {
    const rows = Array.from(this.simByRef.values());
    const header = "provider_ref,rail,amount_cents,paid_at,abn,period_id";
    const lines = rows.map((row) => [
      row.provider_ref,
      row.rail,
      row.amount_cents,
      (row.paid_at as Date).toISOString(),
      row.abn,
      row.period_id,
    ].join(","));
    return [header, ...lines].join("\n");
  }
}

test("recon import enriches evidence", async () => {
  const db = new MemoryDb();
  const abn = "12345678901";
  const taxType = "GST";
  const periodId = "2025-09";
  db.seedPeriod({
    abn,
    tax_type: taxType,
    period_id: periodId,
    state: "READY_RPT",
    thresholds: { epsilon_cents: 100 },
    settlement_verified: false,
  });
  db.seedRptToken({
    id: 1,
    abn,
    tax_type: taxType,
    period_id: periodId,
    payload: { nonce: "kid-1", expiry_ts: new Date().toISOString(), amount_cents: 12500 },
  });

  const release = await releaseSimPayment({
    rail: "eft",
    amount_cents: 12500,
    abn,
    period_id: periodId,
    idemKey: "idem-recon",
  }, db as any);

  await db.query(
    `insert into settlements(provider_ref, abn, tax_type, period_id, rail, amount_cents, paid_at, simulated, idem_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [release.provider_ref, abn, taxType, periodId, "EFT", 12500, new Date(release.paid_at), true, "idem-recon"],
  );

  const csv = db.exportCsv();
  const records = toSettlementRecords(csv);
  await applySettlementImport(db as any, records, csv);

  const evidence = await buildEvidenceBundle(abn, taxType, periodId, db as any);
  assert.ok(evidence.rules.hasOwnProperty("manifest_sha256"));
  assert.equal(evidence.settlement?.provider_ref, release.provider_ref);
  assert.ok(Array.isArray(evidence.approvals));
  assert.match(evidence.narrative, /provider_ref/);
});
