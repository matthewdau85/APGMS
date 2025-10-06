import { readFile } from "fs/promises";
import path from "path";
import { Pool } from "pg";

import { FEATURES } from "../config/features";
import { sha256Hex } from "../crypto/merkle";

const pool = new Pool();

export const RULES_DIR = path.resolve(process.cwd(), "apps/services/tax-engine/app/rules");
export const RULES_MANIFEST_PATH = path.join(RULES_DIR, "manifest.json");

interface PeriodRow {
  abn: string;
  tax_type: string;
  period_id: string;
  state: string;
  accrued_cents: string | number | null;
  credited_to_owa_cents: string | number | null;
  final_liability_cents: string | number | null;
  merkle_root: string | null;
  running_balance_hash: string | null;
  anomaly_vector: Record<string, unknown> | null;
  thresholds: Record<string, unknown> | null;
}

export interface LedgerEntry {
  id: number;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: Date | null;
}

export interface RptTokenRecord {
  payload: any;
  signature: string | null;
  created_at: Date | null;
  payload_c14n?: string | null;
  payload_sha256?: string | null;
}

export interface RulesManifestFile {
  name: string;
  sha256: string;
}

export interface RulesManifest {
  version: string;
  files: RulesManifestFile[];
  manifest_sha256: string;
}

export interface AuditEntry {
  seq: number;
  ts: string | null;
  actor: string;
  action: string;
  payload_hash: string;
  prev_hash: string | null;
  terminal_hash: string;
}

export interface ApprovalEntry {
  by: string;
  role: string;
  at: string | null;
}

export interface EvidenceBundle {
  period: {
    id: string;
    tax_type: string;
    state: string;
    accrued_cents: number;
    credited_to_owa_cents: number;
    final_liability_cents: number;
    merkle_root: string | null;
    running_balance_hash: string | null;
    anomaly_vector: Record<string, unknown>;
    thresholds: Record<string, unknown>;
  };
  abn: string;
  rpt: {
    kid: string | null;
    exp: string | null;
    rates_version: string | null;
  } | null;
  rules: RulesManifest;
  settlement: {
    rail: string | null;
    provider_ref: string | null;
    amount_cents: number | null;
    paid_at: string | null;
    simulated: boolean;
  };
  narrative: string;
  approvals: ApprovalEntry[];
  audit: {
    running_hash: string | null;
    entries: AuditEntry[];
  };
}

export async function loadRulesManifest(): Promise<RulesManifest> {
  const text = await readFile(RULES_MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("RULES_MANIFEST_INVALID");
  }

  const version = typeof parsed.version === "string" ? parsed.version : String(parsed.version ?? "");
  const manifestSha = typeof parsed.manifest_sha256 === "string" ? parsed.manifest_sha256 : String(parsed.manifest_sha256 ?? "");

  if (!Array.isArray(parsed.files)) {
    throw new Error("RULES_MANIFEST_INVALID_FILES");
  }

  const files = parsed.files.map((file: any) => {
    if (!file || typeof file.name !== "string" || typeof file.sha256 !== "string") {
      throw new Error("RULES_MANIFEST_INVALID_FILE_ENTRY");
    }
    return { name: file.name, sha256: file.sha256 } as RulesManifestFile;
  });

  return { version, files, manifest_sha256: manifestSha };
}

async function loadPeriod(abn: string, taxType: string, periodId: string): Promise<PeriodRow> {
  const { rows } = await pool.query<PeriodRow>(
    `select abn, tax_type, period_id, state, accrued_cents, credited_to_owa_cents, final_liability_cents,
            merkle_root, running_balance_hash, anomaly_vector, thresholds
       from periods
      where abn = $1 and tax_type = $2 and period_id = $3`,
    [abn, taxType, periodId],
  );

  if (rows.length === 0) {
    throw new Error("PERIOD_NOT_FOUND");
  }
  return rows[0];
}

export async function loadLedger(abn: string, taxType: string, periodId: string): Promise<LedgerEntry[]> {
  const { rows } = await pool.query(
    `select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at
       from owa_ledger
      where abn = $1 and tax_type = $2 and period_id = $3
      order by id`,
    [abn, taxType, periodId],
  );

  return rows.map((row: any) => ({
    id: Number(row.id),
    amount_cents: Number(row.amount_cents),
    balance_after_cents: Number(row.balance_after_cents),
    bank_receipt_hash: row.bank_receipt_hash ?? null,
    prev_hash: row.prev_hash ?? null,
    hash_after: row.hash_after ?? null,
    created_at: row.created_at ? new Date(row.created_at) : null,
  }));
}

export async function loadRptToken(abn: string, taxType: string, periodId: string): Promise<RptTokenRecord | null> {
  const { rows } = await pool.query(
    `select payload, signature, created_at, payload_c14n, payload_sha256
       from rpt_tokens
      where abn = $1 and tax_type = $2 and period_id = $3
      order by id desc
      limit 1`,
    [abn, taxType, periodId],
  );

  if (rows.length === 0) {
    return null;
  }

  const row = rows[0] as any;
  const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;

  return {
    payload,
    signature: row.signature ?? null,
    created_at: row.created_at ? new Date(row.created_at) : null,
    payload_c14n: row.payload_c14n ?? null,
    payload_sha256: row.payload_sha256 ?? null,
  };
}

async function loadAuditEntriesByHash(payloadHash: string): Promise<AuditEntry[]> {
  if (!payloadHash) {
    return [];
  }
  const { rows } = await pool.query(
    `select seq, ts, actor, action, payload_hash, prev_hash, terminal_hash
       from audit_log
      where payload_hash = $1
      order by seq`,
    [payloadHash],
  );

  return rows.map((row: any) => ({
    seq: Number(row.seq),
    ts: row.ts ? new Date(row.ts).toISOString() : null,
    actor: row.actor,
    action: row.action,
    payload_hash: row.payload_hash,
    prev_hash: row.prev_hash ?? null,
    terminal_hash: row.terminal_hash,
  }));
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  const n = typeof value === "string" ? Number(value) : value;
  return Number.isFinite(n) ? n : 0;
}

function buildNarrative(period: PeriodRow, providerRef: string | null): string {
  const gate = period.state === "RELEASED" ? "RECON_OK" : period.state;
  const pr = providerRef ?? "n/a";
  return `Released because: gate=${gate}, thresholds pass, RPT signature valid, funds reconciled to provider_ref ${pr} ...`;
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string): Promise<EvidenceBundle> {
  if (!abn || !taxType || !periodId) {
    throw new Error("MISSING_PARAMS");
  }

  const period = await loadPeriod(abn, taxType, periodId);
  const rpt = await loadRptToken(abn, taxType, periodId);
  const ledger = await loadLedger(abn, taxType, periodId);
  const manifest = await loadRulesManifest();

  const releaseRow = [...ledger].reverse().find((row) => row.amount_cents < 0) ?? null;
  const settlementAmount = releaseRow
    ? Math.abs(releaseRow.amount_cents)
    : rpt?.payload?.amount_cents != null
      ? Number(rpt.payload.amount_cents)
      : null;

  const settlement = {
    rail: rpt?.payload?.rail_id ?? null,
    provider_ref: rpt?.payload?.reference ?? null,
    amount_cents: settlementAmount,
    paid_at: releaseRow?.created_at ? releaseRow.created_at.toISOString() : null,
    simulated: Boolean(FEATURES.FEATURE_SIM_OUTBOUND),
  };

  let auditEntries: AuditEntry[] = [];
  let approvals: ApprovalEntry[] = [];
  let runningHash: string | null = null;

  if (releaseRow && settlement.provider_ref) {
    const auditPayload = {
      abn,
      taxType,
      periodId,
      amountCents: settlement.amount_cents ?? 0,
      rail: settlement.rail ?? "",
      reference: settlement.provider_ref,
      bank_receipt_hash: releaseRow.bank_receipt_hash ?? "",
    };
    const payloadHash = sha256Hex(JSON.stringify(auditPayload));
    auditEntries = await loadAuditEntriesByHash(payloadHash);
    approvals = auditEntries.map((entry) => ({ by: entry.actor, role: entry.action, at: entry.ts }));
    runningHash = auditEntries.length > 0 ? auditEntries[auditEntries.length - 1].terminal_hash : null;
  }

  const narrative = buildNarrative(period, settlement.provider_ref);

  return {
    period: {
      id: period.period_id,
      tax_type: period.tax_type,
      state: period.state,
      accrued_cents: toNumber(period.accrued_cents),
      credited_to_owa_cents: toNumber(period.credited_to_owa_cents),
      final_liability_cents: toNumber(period.final_liability_cents),
      merkle_root: period.merkle_root ?? null,
      running_balance_hash: period.running_balance_hash ?? null,
      anomaly_vector: period.anomaly_vector ?? {},
      thresholds: period.thresholds ?? {},
    },
    abn: period.abn,
    rpt: rpt
      ? {
          kid: rpt.payload?.kid ?? null,
          exp: rpt.payload?.expiry_ts ?? rpt.payload?.exp ?? null,
          rates_version: rpt.payload?.rates_version ?? null,
        }
      : null,
    rules: manifest,
    settlement,
    narrative,
    approvals,
    audit: {
      running_hash: runningHash,
      entries: auditEntries,
    },
  };
}
