import fs from "fs/promises";
import path from "path";
import { Pool } from "pg";
import { FEATURES } from "../config/features";

const pool = new Pool();

interface RulesManifest {
  version: string;
  files: { name: string; sha256: string }[];
  manifest_sha256: string;
}

async function loadRulesManifest(): Promise<RulesManifest | null> {
  try {
    const manifestPath = path.resolve(process.cwd(), "dist/rules/manifest.json");
    const raw = await fs.readFile(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.files) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodRow = (
    await pool.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    )
  ).rows[0];
  if (!periodRow) throw new Error("PERIOD_NOT_FOUND");

  const rptRow = (
    await pool.query(
      "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
      [abn, taxType, periodId]
    )
  ).rows[0] || null;

  const deltas = (
    await pool.query(
      "select created_at as ts, amount_cents, hash_after, bank_receipt_hash from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    )
  ).rows;

  const approvals = (
    await pool.query(
      "select approved_by as by, role, approved_at from period_approvals where abn=$1 and tax_type=$2 and period_id=$3 order by approved_at",
      [abn, taxType, periodId]
    )
  ).rows.map((row: any) => ({
    by: row.by,
    role: row.role,
    at: new Date(row.approved_at).toISOString(),
  }));

  const settlementRef = periodRow.settlement_provider_ref;
  const settlementRow = settlementRef
    ? (
        await pool.query(
          "select provider_ref, rail, amount_cents, paid_at, simulated from settlements where provider_ref=$1",
          [settlementRef]
        )
      ).rows[0]
    : null;

  const rulesManifest = await loadRulesManifest();

  const auditRows = (
    await pool.query(
      "select seq, ts, actor, action, terminal_hash from audit_log order by seq",
      []
    )
  ).rows.map((row: any) => ({
    seq: Number(row.seq),
    actor: row.actor,
    action: row.action,
    at: new Date(row.ts).toISOString(),
    terminal_hash: row.terminal_hash,
  }));
  const runningHash = auditRows.length ? auditRows[auditRows.length - 1].terminal_hash : null;

  const rptKid = process.env.RPT_KEY_ID || "SIM-RPT";
  const ratesVersion = rulesManifest?.version || process.env.RATES_VERSION || "dev";
  const lastLedger = deltas[deltas.length - 1];

  const narrativeParts = [
    `Released because gate=${periodRow.settlement_verified ? "RECON_OK" : periodRow.state}`,
    `RPT valid(kid=${rptKid})`,
  ];
  if (settlementRow?.provider_ref) {
    narrativeParts.push(`reconciled to provider_ref=${settlementRow.provider_ref}`);
  }
  const narrative = narrativeParts.join("; ");

  return {
    meta: { generated_at: new Date().toISOString(), abn, taxType, periodId },
    period: {
      state: periodRow.state,
      accrued_cents: Number(periodRow.accrued_cents || 0),
      credited_to_owa_cents: Number(periodRow.credited_to_owa_cents || 0),
      final_liability_cents: Number(periodRow.final_liability_cents || 0),
      merkle_root: periodRow.merkle_root,
      running_balance_hash: periodRow.running_balance_hash,
      anomaly_vector: periodRow.anomaly_vector,
      thresholds: periodRow.thresholds,
      settlement_verified: !!periodRow.settlement_verified,
    },
    rules: rulesManifest
      ? {
          version: rulesManifest.version,
          manifest_sha256: rulesManifest.manifest_sha256,
          files: rulesManifest.files,
        }
      : null,
    settlement: settlementRow
      ? {
          rail: settlementRow.rail,
          provider_ref: settlementRow.provider_ref,
          amount_cents: Number(settlementRow.amount_cents),
          paid_at: new Date(settlementRow.paid_at).toISOString(),
          simulated: Boolean(settlementRow.simulated) || FEATURES.FEATURE_SIM_OUTBOUND,
        }
      : null,
    approvals,
    narrative,
    rpt: {
      kid: rptKid,
      rates_version: ratesVersion,
    },
    rpt_payload: rptRow?.payload ?? null,
    rpt_signature: rptRow?.signature ?? null,
    rpt_status: rptRow?.status ?? null,
    owa_ledger_deltas: deltas,
    bank_receipt_hash: lastLedger?.bank_receipt_hash ?? null,
    anomaly_thresholds: periodRow?.thresholds ?? {},
    discrepancy_log: [],
    audit: {
      running_hash: runningHash,
      entries: auditRows,
    },
  };
}
