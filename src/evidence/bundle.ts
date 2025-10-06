import { Pool } from "pg";
import crypto from "crypto";
import { loadRulesManifest, rulesManifestSha, RuleManifestEntry } from "../rules/manifest";
import { buildNarrative } from "./narrative";

const pool = new Pool();

export interface LedgerEntry {
  id: number;
  ts: string;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  hash_after: string | null;
}

export interface ApprovalRecord {
  approver_id: string;
  approver_role: string;
  mfa_verified: boolean;
  approved_at: string;
}

export interface SettlementInfo {
  id: string;
  provider_ref: string;
  rail: string;
  amount_cents: number | null;
  currency: string | null;
  paid_at: string | null;
  receipt_filename?: string | null;
  receipt_mime?: string | null;
  receipt_base64?: string | null;
}

export interface EvidenceBundle {
  meta: { generated_at: string; abn: string; taxType: string; periodId: string };
  period: any;
  ledger: { entries: LedgerEntry[]; running_balance_hash: string | null; tail_hash: string | null };
  recon: {
    credited_to_owa_cents: number;
    final_liability_cents: number;
    epsilon_cents: number;
    status: "OK" | "MISMATCH";
    deltas: number[];
  };
  rules: { manifest: RuleManifestEntry[]; manifest_sha256: string };
  rpt: {
    payload: any;
    payload_c14n: string;
    payload_sha256: string;
    signature: string;
  };
  approvals: ApprovalRecord[];
  settlement: SettlementInfo | null;
  narrative: string;
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string): Promise<EvidenceBundle> {
  const client = await pool.connect();
  try {
    const periodRes = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
    const period = periodRes.rows[0];

    const rptRes = await client.query(
      "select id, payload, payload_c14n, payload_sha256, signature from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by created_at desc limit 1",
      [abn, taxType, periodId]
    );
    if (rptRes.rowCount === 0) throw new Error("RPT_NOT_FOUND");
    const rpt = rptRes.rows[0];

    const ledgerRes = await client.query(
      "select id, created_at, amount_cents, balance_after_cents, bank_receipt_hash, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id asc",
      [abn, taxType, periodId]
    );
    const ledgerEntries: LedgerEntry[] = ledgerRes.rows.map((row: any) => ({
      id: Number(row.id),
      ts: new Date(row.created_at).toISOString(),
      amount_cents: Number(row.amount_cents),
      balance_after_cents: Number(row.balance_after_cents),
      bank_receipt_hash: row.bank_receipt_hash ?? null,
      hash_after: row.hash_after ?? null,
    }));

    const approvalsRes = await client.query(
      "select approver_id, approver_role, mfa_verified, approved_at from release_approvals where abn=$1 and tax_type=$2 and period_id=$3 order by approved_at asc",
      [abn, taxType, periodId]
    );
    const approvals: ApprovalRecord[] = approvalsRes.rows.map((row: any) => ({
      approver_id: row.approver_id,
      approver_role: row.approver_role,
      mfa_verified: !!row.mfa_verified,
      approved_at: new Date(row.approved_at).toISOString(),
    }));

    const settlementRes = await client.query(
      "select * from settlements where abn=$1 and tax_type=$2 and period_id=$3 order by coalesce(paid_at, created_at) desc limit 1",
      [abn, taxType, periodId]
    );
    const settlement: SettlementInfo | null = settlementRes.rowCount
      ? {
          id: settlementRes.rows[0].id,
          provider_ref: settlementRes.rows[0].provider_ref,
          rail: settlementRes.rows[0].rail,
          amount_cents: settlementRes.rows[0].amount_cents ? Number(settlementRes.rows[0].amount_cents) : null,
          currency: settlementRes.rows[0].currency,
          paid_at: settlementRes.rows[0].paid_at ? new Date(settlementRes.rows[0].paid_at).toISOString() : null,
          receipt_filename: settlementRes.rows[0].receipt_filename,
          receipt_mime: settlementRes.rows[0].receipt_mime,
          receipt_base64: settlementRes.rows[0].receipt_base64,
        }
      : null;

    const manifest = await loadRulesManifest();
    const manifestSha = await rulesManifestSha();

    const credited = Number(period.credited_to_owa_cents || 0);
    const finalLiability = Number(period.final_liability_cents || 0);
    const epsilon = finalLiability - credited;
    const reconStatus = Math.abs(epsilon) <= (period.thresholds?.epsilon_cents ?? 0) ? "OK" : "MISMATCH";

    const narrative = buildNarrative({
      gateState: period.state,
      recon: { status: reconStatus, deltas: ledgerEntries.map((l) => l.amount_cents), epsilon },
      rpt: {
        keyId: rpt.payload?.key_id,
        amountCents: rpt.payload?.amount_cents ?? finalLiability,
        rulesManifestSha: manifestSha,
      },
      allowListOk: true,
      settlement: settlement
        ? { providerRef: settlement.provider_ref, paidAt: settlement.paid_at }
        : null,
    });

    const payloadSha =
      rpt.payload_sha256 ||
      crypto.createHash("sha256").update(rpt.payload_c14n || JSON.stringify(rpt.payload)).digest("hex");

    const bundle: EvidenceBundle = {
      meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
      period: {
        state: period.state,
        accrued_cents: Number(period.accrued_cents || 0),
        credited_to_owa_cents: credited,
        final_liability_cents: finalLiability,
        merkle_root: period.merkle_root,
        running_balance_hash: period.running_balance_hash,
        anomaly_vector: period.anomaly_vector,
        thresholds: period.thresholds,
      },
      ledger: {
        entries: ledgerEntries,
        running_balance_hash: period.running_balance_hash,
        tail_hash: ledgerEntries.length ? ledgerEntries[ledgerEntries.length - 1].hash_after : null,
      },
      recon: {
        credited_to_owa_cents: credited,
        final_liability_cents: finalLiability,
        epsilon_cents: epsilon,
        status: reconStatus,
        deltas: ledgerEntries.map((l) => l.amount_cents),
      },
      rules: { manifest, manifest_sha256: manifestSha },
      rpt: {
        payload: rpt.payload,
        payload_c14n: rpt.payload_c14n,
        payload_sha256: payloadSha,
        signature: rpt.signature,
      },
      approvals,
      settlement,
      narrative,
    };

    const owaAfter = ledgerEntries.length ? ledgerEntries[ledgerEntries.length - 1].balance_after_cents : 0;
    const owaBefore = ledgerEntries.length
      ? owaAfter - ledgerEntries[ledgerEntries.length - 1].amount_cents
      : owaAfter;

    await client.query(
      `insert into evidence_bundles (
         abn, tax_type, period_id, payload_sha256, rpt_id, rpt_payload, rpt_signature,
         thresholds_json, anomaly_vector, normalization_hashes,
         owa_balance_before, owa_balance_after,
         bank_receipts, ato_receipts, operator_overrides,
         rules_manifest, approvals, narrative, settlement_id
       ) values (
         $1,$2,$3,$4,$5,$6,$7,
         $8::jsonb,$9::jsonb,$10::jsonb,
         $11,$12,
         $13::jsonb,$14::jsonb,$15::jsonb,
         $16::jsonb,$17::jsonb,$18,$19
       )
       on conflict (abn, tax_type, period_id) do update set
         payload_sha256 = excluded.payload_sha256,
         rpt_id = excluded.rpt_id,
         rpt_payload = excluded.rpt_payload,
         rpt_signature = excluded.rpt_signature,
         thresholds_json = excluded.thresholds_json,
         anomaly_vector = excluded.anomaly_vector,
         owa_balance_before = excluded.owa_balance_before,
         owa_balance_after = excluded.owa_balance_after,
         bank_receipts = excluded.bank_receipts,
         ato_receipts = excluded.ato_receipts,
         operator_overrides = excluded.operator_overrides,
         rules_manifest = excluded.rules_manifest,
         approvals = excluded.approvals,
         narrative = excluded.narrative,
         settlement_id = excluded.settlement_id
      `,
      [
        abn,
        taxType,
        periodId,
        payloadSha,
        rpt.id,
        rpt.payload,
        rpt.signature,
        JSON.stringify(period.thresholds || {}),
        JSON.stringify(period.anomaly_vector || {}),
        JSON.stringify({}),
        owaBefore,
        owaAfter,
        JSON.stringify(ledgerEntries.filter((l) => l.bank_receipt_hash).map((l) => ({
          bank_receipt_hash: l.bank_receipt_hash,
          ledger_id: l.id,
        }))),
        JSON.stringify(
          settlement
            ? [
                {
                  provider_ref: settlement.provider_ref,
                  paid_at: settlement.paid_at,
                  amount_cents: settlement.amount_cents,
                },
              ]
            : []
        ),
        JSON.stringify([]),
        JSON.stringify(manifest),
        JSON.stringify(approvals),
        narrative,
        settlement ? settlement.id : null,
      ]
    );

    return bundle;
  } finally {
    client.release();
  }
}
