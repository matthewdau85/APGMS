import { createHash } from "crypto";
import { buildEvidenceBundle } from "../../../../src/evidence/bundle";

type QueryResponse = { rows: any[]; rowCount: number };

type QueryHandler = (text: string, params?: any[]) => QueryResponse | Promise<QueryResponse>;

class FakeClient {
  constructor(private readonly handler: QueryHandler) {}

  async query(text: string, params: any[] = []): Promise<QueryResponse> {
    return await this.handler(text, params);
  }
}

const canonical = (value: unknown): string => {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
};

describe("buildEvidenceBundle", () => {
  const baseData = {
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-10",
  };

  const samplePayload = {
    entity_id: baseData.abn,
    period_id: baseData.periodId,
    tax_type: baseData.taxType,
    amount_cents: 123456,
    anomaly_vector: { variance_ratio: 0.32, dup_rate: 0.01 },
    thresholds: { variance_ratio: 0.25, dup_rate: 0.02 },
    rail_id: "EFT",
    reference: "ABC123",
  };

  const tables = {
    periods: [
      {
        abn: baseData.abn,
        tax_type: baseData.taxType,
        period_id: baseData.periodId,
        anomaly_vector: { variance_ratio: 0.32 },
        thresholds: { variance_ratio: 0.25 },
      },
    ],
    rpt_tokens: [
      {
        abn: baseData.abn,
        tax_type: baseData.taxType,
        period_id: baseData.periodId,
        payload: samplePayload,
        signature: "sig-123",
      },
    ],
    owa_ledger: [
      {
        created_at: new Date("2025-10-01T00:00:00Z"),
        amount_cents: 60000,
        hash_after: "hash-a",
        bank_receipt_hash: "rcpt-a",
      },
      {
        created_at: new Date("2025-10-03T00:00:00Z"),
        amount_cents: 63456,
        hash_after: "hash-b",
        bank_receipt_hash: "rcpt-b",
      },
    ],
    bas_recon_results: [
      { abn: baseData.abn, tax_type: baseData.taxType, period_id: baseData.periodId, label: "W1", value_cents: 175000 },
      { abn: baseData.abn, tax_type: baseData.taxType, period_id: baseData.periodId, label: "W2", value_cents: 56000 },
      { abn: baseData.abn, tax_type: baseData.taxType, period_id: baseData.periodId, label: "1A", value_cents: 16000 },
      { abn: baseData.abn, tax_type: baseData.taxType, period_id: baseData.periodId, label: "1B", value_cents: 4000 },
    ],
    recon_discrepancies: [
      {
        abn: baseData.abn,
        tax_type: baseData.taxType,
        period_id: baseData.periodId,
        metric: "variance_ratio",
        observed_value: 0.32,
        expected_value: 0.25,
        threshold_value: 0.25,
        status: "EXCEEDED",
        notes: "variance exceeds threshold",
      },
    ],
    audit_log: [
      {
        event_time: new Date("2025-10-02T00:00:00Z"),
        category: "bas_gate",
        message: JSON.stringify({ period_id: baseData.periodId, state: "CLOSING" }),
        hash_prev: null,
        hash_this: "hash-close",
      },
      {
        event_time: new Date("2025-10-04T00:00:00Z"),
        category: "bas_gate",
        message: JSON.stringify({ period_id: baseData.periodId, state: "READY_RPT" }),
        hash_prev: "hash-close",
        hash_this: "hash-ready",
      },
    ],
  };

  const handler: QueryHandler = (text, params = []) => {
    const sql = text.toLowerCase();
    if (sql.includes("from periods")) {
      const rows = tables.periods.filter(
        (row) => row.abn === params[0] && row.tax_type === params[1] && row.period_id === params[2]
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from rpt_tokens")) {
      const rows = tables.rpt_tokens.filter(
        (row) => row.abn === params[0] && row.tax_type === params[1] && row.period_id === params[2]
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from owa_ledger")) {
      const rows = tables.owa_ledger.map((row, idx) => ({ ...row, id: idx + 1 }));
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from bas_recon_results")) {
      const rows = tables.bas_recon_results.filter(
        (row) => row.abn === params[0] && row.tax_type === params[1] && row.period_id === params[2]
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from recon_discrepancies")) {
      const rows = tables.recon_discrepancies.filter(
        (row) => row.abn === params[0] && row.tax_type === params[1] && row.period_id === params[2]
      );
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("from audit_log")) {
      const pattern: string = params[0];
      const periodFragment = pattern.replace(/%/g, "").split(":").pop()?.replace(/"/g, "");
      const rows = tables.audit_log.filter((row) =>
        typeof row.message === "string" && row.message.includes(periodFragment ?? "")
      );
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  };

  it("returns an evidence bundle with recon labels and audit hashes", async () => {
    const client = new FakeClient(handler);
    const bundle = await buildEvidenceBundle(baseData.abn, baseData.taxType, baseData.periodId, client as any);

    expect(bundle.bas_labels).toMatchObject({ W1: 175000, W2: 56000, "1A": 16000, "1B": 4000 });
    expect(bundle.owa_ledger_deltas).toHaveLength(2);
    expect(bundle.bank_receipt_hash).toBe("rcpt-b");
    expect(bundle.rpt_signature).toBe("sig-123");
    expect(bundle.rpt_payload).toEqual(samplePayload);
    expect(bundle.discrepancy_log).toEqual([
      expect.objectContaining({
        source: "recon",
        metric: "variance_ratio",
        status: "EXCEEDED",
      }),
    ]);
    expect(bundle.audit_trail).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ hash_this: "hash-close" }),
        expect.objectContaining({ hash_this: "hash-ready", hash_prev: "hash-close" }),
      ])
    );

    const expectedSha = createHash("sha256").update(canonical(samplePayload)).digest("hex");
    expect(bundle.payload_sha256).toBe(expectedSha);
  });

  it("falls back to anomaly vector when recon discrepancies are absent", async () => {
    const noReconHandler: QueryHandler = (text, params = []) => {
      if (text.toLowerCase().includes("from recon_discrepancies")) {
        return { rows: [], rowCount: 0 };
      }
      return handler(text, params);
    };
    const client = new FakeClient(noReconHandler);
    const bundle = await buildEvidenceBundle(baseData.abn, baseData.taxType, baseData.periodId, client as any);
    expect(bundle.discrepancy_log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "anomaly", metric: "variance_ratio", status: "EXCEEDED" }),
      ])
    );
  });
});
