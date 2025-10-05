import pg from "pg";
const { PoolClient } = pg;
import { canonicalJson, sha256Hex } from "../utils/crypto";
import { getAdapterTrail } from "../bank/simulatorState.js";

type BuildParams = {
  abn: string;
  taxType: string;
  periodId: string;
  bankReceipts?: Array<{ provider: string; receipt_id: string; signature?: string; ledger_id?: number | null; mode?: string }>;
  atoReceipts?: Array<{ submission_id: string; receipt_id: string; ledger_id?: number | null; mode?: string }>;
  operatorOverrides?: Array<{ who: string; why: string; ts: string }>;
  owaAfterHash?: string;
};

export async function buildEvidenceBundle(client: PoolClient, p: BuildParams) {
  const periodQ = await client.query(
    `SELECT accrued_cents, credited_to_owa_cents, final_liability_cents,
            thresholds_json, anomaly_vector
       FROM periods
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
    [p.abn, p.taxType, p.periodId]
  );
  if (!periodQ.rows.length) throw new Error("Missing period for bundle");
  const period = periodQ.rows[0];

  const rpt = await client.query(
    "SELECT rpt_id, payload_c14n, payload_sha256, signature FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND status='ISSUED' ORDER BY created_at DESC LIMIT 1",
    [p.abn, p.taxType, p.periodId]
  );
  if (!rpt.rows.length) throw new Error("Missing RPT for bundle");
  const r = rpt.rows[0];

  const thresholds = {
    variance_pct: Number(period.thresholds_json?.variance_pct ?? 0.05),
    dup_rate: Number(period.thresholds_json?.dup_rate ?? 0.05),
    gap_minutes: Number(period.thresholds_json?.gap_minutes ?? 60),
  };

  const beforeQ = await client.query(
    "SELECT COALESCE(SUM(amount_cents),0) bal FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND entry_id < (SELECT max(entry_id) FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3)",
    [p.abn, p.taxType, p.periodId]
  );
  const afterQ = await client.query(
    "SELECT COALESCE(SUM(amount_cents),0) bal FROM owa_ledger WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
    [p.abn, p.taxType, p.periodId]
  );
  const balBefore = Number(beforeQ.rows[0]?.bal || 0);
  const balAfter = Number(afterQ.rows[0]?.bal || 0);

  const payload_sha256 = sha256Hex(r.payload_c14n);

  const deltas = await client.query(
    `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id`,
    [p.abn, p.taxType, p.periodId]
  );

  const adapterTrail = getAdapterTrail({ abn: p.abn, taxType: p.taxType, periodId: p.periodId });

  const ledgerRows = deltas.rows.map((row) => ({
    id: Number(row.id),
    amount_cents: Number(row.amount_cents),
    balance_after_cents: Number(row.balance_after_cents),
    bank_receipt_hash: row.bank_receipt_hash,
    prev_hash: row.prev_hash,
    hash_after: row.hash_after,
    created_at: row.created_at,
  }));

  const inbound = ledgerRows.filter((row) => row.amount_cents > 0);
  const outbound = ledgerRows.filter((row) => row.amount_cents < 0);
  const inboundSum = inbound.reduce((acc, row) => acc + row.amount_cents, 0);
  const outboundSum = outbound.reduce((acc, row) => acc + row.amount_cents, 0);
  const creditedToOwa = Number(period.credited_to_owa_cents ?? 0);
  const finalLiability = Number(period.final_liability_cents ?? 0);

  const variancePct = inboundSum === 0 ? 0 : Math.abs(inboundSum - creditedToOwa) / Math.max(Math.abs(inboundSum), 1);

  const amountCounts = new Map<number, number>();
  ledgerRows.forEach((row) => {
    const count = amountCounts.get(row.amount_cents) ?? 0;
    amountCounts.set(row.amount_cents, count + 1);
  });
  const duplicateEntries = Array.from(amountCounts.values()).filter((v) => v > 1).reduce((acc, v) => acc + v - 1, 0);
  const dupRate = ledgerRows.length ? duplicateEntries / ledgerRows.length : 0;

  const orderedDates = ledgerRows.map((row) => new Date(row.created_at).getTime()).sort((a, b) => a - b);
  let gapMinutes = 0;
  for (let i = 1; i < orderedDates.length; i++) {
    const gapMs = orderedDates[i] - orderedDates[i - 1];
    gapMinutes = Math.max(gapMinutes, gapMs / 60000);
  }

  const anomalies = {
    variance_pct: Number(variancePct.toFixed(6)),
    dup_rate: Number(dupRate.toFixed(6)),
    gap_minutes: Number(gapMinutes.toFixed(2)),
  };

  const basTotals: Record<string, number> = {};
  adapterTrail.forEach((log) => {
    log.ledger?.sources?.forEach((src) => {
      if (!src?.basLabel) return;
      const amt = Number(src.amount_cents);
      if (!Number.isFinite(amt)) return;
      basTotals[src.basLabel] = (basTotals[src.basLabel] ?? 0) + amt;
    });
  });

  const bas_labels = {
    W1: basTotals["W1"] ?? null,
    W2: basTotals["W2"] ?? null,
    "1A": basTotals["1A"] ?? null,
    "1B": basTotals["1B"] ?? null,
  };

  const discrepancy_log: Array<{ ts: string; type: string; detail: string; delta_cents: number }> = [];
  if (Math.round(inboundSum) !== Math.round(creditedToOwa)) {
    discrepancy_log.push({
      ts: new Date().toISOString(),
      type: "INBOUND_VS_CREDITED",
      detail: `Inbound ledger ${inboundSum} vs credited ${creditedToOwa}`,
      delta_cents: inboundSum - creditedToOwa,
    });
  }
  const outboundAbs = Math.abs(outboundSum);
  if (Math.round(outboundAbs) !== Math.round(finalLiability)) {
    discrepancy_log.push({
      ts: new Date().toISOString(),
      type: "RELEASE_VS_LIABILITY",
      detail: `Released ${outboundAbs} vs liability ${finalLiability}`,
      delta_cents: outboundAbs - finalLiability,
    });
  }

  adapterTrail.forEach((log) => {
    const response = log.response as any;
    if (log.error) {
      discrepancy_log.push({
        ts: log.ts,
        type: `${log.adapter.toUpperCase()}_ERROR`,
        detail: log.error,
        delta_cents: Number(log.ledger?.amount_cents ?? 0),
      });
    } else if (response?.status && response.status !== "OK") {
      discrepancy_log.push({
        ts: log.ts,
        type: `${log.adapter.toUpperCase()}_${response.status}`,
        detail: response.reason || "Adapter returned non-OK status",
        delta_cents: Number(log.ledger?.amount_cents ?? 0),
      });
    }
  });

  const normalization = { payroll_hash: "NA", pos_hash: "NA" };

  const bankReceipts = adapterTrail
    .filter((log) => log.adapter === "bank" && (log.response as any)?.status === "OK")
    .map((log) => {
      const response = log.response as any;
      return {
        provider: "EFT/BPAY",
        receipt_id: response?.provider_receipt_id ?? null,
        signature: response?.receipt_signature ?? null,
        bank_receipt_hash: response?.bank_receipt_hash ?? null,
        ledger_id: log.ledger?.ledger_id ?? null,
        mode: log.mode,
      };
    });

  const atoReceipts = adapterTrail
    .filter((log) => log.adapter === "payto" && (log.response as any)?.status === "OK")
    .map((log) => {
      const response = log.response as any;
      return {
        submission_id: response?.bank_ref ?? log.id,
        receipt_id: response?.receipt_signature ?? null,
        ledger_id: log.ledger?.ledger_id ?? null,
        mode: log.mode,
      };
    });

  const operatorOverrides = p.operatorOverrides ?? [];

  const ins = `
    INSERT INTO evidence_bundles (
      abn, tax_type, period_id, payload_sha256, rpt_id, rpt_payload, rpt_signature,
      thresholds_json, anomaly_vector, normalization_hashes,
      owa_balance_before, owa_balance_after,
      bank_receipts, ato_receipts, operator_overrides,
      bas_labels, discrepancy_log
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17::jsonb)
    ON CONFLICT (abn, tax_type, period_id) DO UPDATE SET
      bank_receipts = EXCLUDED.bank_receipts,
      ato_receipts = EXCLUDED.ato_receipts,
      owa_balance_before = EXCLUDED.owa_balance_before,
      owa_balance_after = EXCLUDED.owa_balance_after,
      bas_labels = EXCLUDED.bas_labels,
      discrepancy_log = EXCLUDED.discrepancy_log
    RETURNING bundle_id
  `;
  const vals = [
    p.abn, p.taxType, p.periodId, payload_sha256, r.rpt_id, r.payload_c14n, r.signature,
    canonicalJson(thresholds), canonicalJson(anomalies), canonicalJson(normalization),
    balBefore, balAfter,
    canonicalJson(bankReceipts), canonicalJson(atoReceipts), canonicalJson(operatorOverrides),
    canonicalJson(bas_labels), canonicalJson(discrepancy_log)
  ];
  const out = await client.query(ins, vals);
  return out.rows[0].bundle_id as number;
}
