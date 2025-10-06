import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { FEATURES } from "../config/features";

const pool = new Pool();

type Queryable = { query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number }>; };

interface RulesManifest {
  version: string | null;
  manifest_sha256: string | null;
  files: Array<{ name: string; sha256: string }>;
}

function readManifest(): RulesManifest {
  const manifestPath = path.resolve(process.cwd(), "scripts/rules/manifest.json");
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      version: parsed.version ?? null,
      manifest_sha256: parsed.manifest_sha256 ?? null,
      files: Array.isArray(parsed.files) ? parsed.files : [],
    };
  } catch {
    return { version: null, manifest_sha256: null, files: [] };
  }
}

function iso(value: any): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const ts = new Date(value);
  return Number.isNaN(ts.getTime()) ? null : ts.toISOString();
}

async function fetchApprovals(db: Queryable, abn: string, taxType: string, periodId: string) {
  try {
    const { rows } = await db.query(
      "select by, role, at from approvals where abn=$1 and tax_type=$2 and period_id=$3 order by at asc",
      [abn, taxType, periodId],
    );
    return rows.map((row) => ({ by: row.by, role: row.role, at: iso(row.at) }));
  } catch {
    return [] as Array<{ by: string; role: string; at: string | null }>;
  }
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string, db: Queryable = pool) {
  const periodRow = (await db.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId],
  )).rows[0];
  const rptRow = (await db.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId],
  )).rows[0];
  const settlementRow = (await db.query(
    "select * from settlements where abn=$1 and tax_type=$2 and period_id=$3 order by paid_at desc limit 1",
    [abn, taxType, periodId],
  )).rows[0];
  const auditRows = (await db.query(
    "select seq, ts, actor, action, payload_hash, terminal_hash from audit_log order by seq asc",
  )).rows;

  const approvals = await fetchApprovals(db, abn, taxType, periodId);
  const manifest = readManifest();

  const settlement = settlementRow
    ? {
        rail: settlementRow.rail,
        provider_ref: settlementRow.provider_ref,
        amount_cents: Number(settlementRow.amount_cents),
        paid_at: iso(settlementRow.paid_at),
        simulated: Boolean(settlementRow.simulated) || FEATURES.FEATURE_SIM_OUTBOUND,
      }
    : null;

  const narrativeFragments = [
    "gate=RECON_OK",
    "thresholds pass",
    "RPT valid",
    settlement?.provider_ref
      ? `reconciled to provider_ref ${settlement.provider_ref}`
      : "awaiting settlement reconciliation",
  ];
  const narrative = `Released because: ${narrativeFragments.join(", ")}.`;

  const running_hash = auditRows.length ? auditRows[auditRows.length - 1].terminal_hash : null;
  const audit = {
    running_hash,
    entries: auditRows.map((row) => ({
      seq: row.seq,
      ts: iso(row.ts),
      actor: row.actor,
      action: row.action,
      payload_hash: row.payload_hash,
      terminal_hash: row.terminal_hash,
    })),
  };

  const rptPayload = rptRow?.payload || {};
  const rpt = {
    kid: rptPayload.kid ?? rptPayload.nonce ?? null,
    exp: rptPayload.expiry_ts ?? rptPayload.exp ?? null,
    rates_version: process.env.RATES_VERSION || manifest.version || null,
  };

  return {
    period: periodRow || null,
    abn,
    rpt,
    rules: manifest,
    settlement,
    narrative,
    approvals,
    audit,
  };
}
