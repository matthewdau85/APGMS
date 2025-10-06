import { Pool, PoolClient } from "pg";
import { merkleRootHex, sha256Hex } from "../crypto/merkle";

const pool = new Pool();

type Queryable = Pool | PoolClient;

export interface DiscrepancyEntry {
  code: string;
  message: string;
  expected?: number | string | null;
  actual?: number | string | null;
  delta?: number;
}

interface LedgerUpdate {
  id: number;
  prev_hash: string;
  hash_after: string;
  balance_after_cents?: number;
}

export interface LedgerRowWithProof {
  id: number;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  prev_hash: string | null;
  hash_after: string | null;
  created_at: Date | string;
  computed_prev_hash: string;
  computed_hash_after: string;
  computed_balance_after_cents: number;
}

export interface LedgerArtifacts {
  rows: LedgerRowWithProof[];
  creditedTotal: number;
  netBalance: number;
  merkleRoot: string;
  runningHash: string;
  tailReceipt: string | null;
  updates: LedgerUpdate[];
  issues: DiscrepancyEntry[];
}

const DEFAULT_THRESHOLDS: Record<string, number> = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

function canonicalize(value: any): any {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

function canonicalJson(value: any): string {
  return JSON.stringify(canonicalize(value));
}

export function normalizeThresholds(...sources: Array<Record<string, any> | null | undefined>) {
  const merged: Record<string, number> = { ...DEFAULT_THRESHOLDS };
  for (const src of sources) {
    if (!src) continue;
    for (const [key, raw] of Object.entries(src)) {
      const num = typeof raw === "number" ? raw : Number(raw);
      if (Number.isFinite(num)) merged[key] = num;
    }
  }
  return merged;
}

export async function computeLedgerArtifacts(db: Queryable, abn: string, taxType: string, periodId: string): Promise<LedgerArtifacts> {
  const { rows } = await db.query(
    "select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after, created_at from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
    [abn, taxType, periodId]
  );

  const proofRows: LedgerRowWithProof[] = [];
  const issues: DiscrepancyEntry[] = [];
  const updateMap = new Map<number, LedgerUpdate>();
  const recordUpdate = (id: number, prev_hash: string, hash_after: string) => {
    const existing = updateMap.get(id) || { id, prev_hash, hash_after };
    existing.prev_hash = prev_hash;
    existing.hash_after = hash_after;
    updateMap.set(id, existing);
    return existing;
  };

  let creditedTotal = 0;
  let netBalance = 0;
  let runningBalance = 0;
  let prevHash = "";
  const leaves: string[] = [];

  for (const raw of rows as any[]) {
    const id = Number(raw.id);
    const amount = Number(raw.amount_cents ?? 0);
    if (amount > 0) creditedTotal += amount;
    netBalance += amount;
    const expectedBalance = runningBalance + amount;
    const storedBalance = raw.balance_after_cents != null ? Number(raw.balance_after_cents) : expectedBalance;
    runningBalance = storedBalance;

    if (raw.balance_after_cents == null || storedBalance !== expectedBalance) {
      issues.push({
        code: "LEDGER_BALANCE_MISMATCH",
        message: `Ledger row ${id} balance mismatch`,
        expected: expectedBalance,
        actual: raw.balance_after_cents == null ? null : storedBalance,
        delta: storedBalance - expectedBalance,
      });
      const entry = recordUpdate(id, prevHash, "");
      entry.balance_after_cents = expectedBalance;
    }

    const receipt = raw.bank_receipt_hash ? String(raw.bank_receipt_hash) : "";
    if (!receipt) {
      issues.push({
        code: "LEDGER_RECEIPT_MISSING",
        message: `Ledger row ${id} missing bank_receipt_hash`,
        expected: null,
        actual: null,
      });
    }

    const computedPrevHash = prevHash;
    const computedHashAfter = sha256Hex(prevHash + receipt + String(runningBalance));
    if ((raw.prev_hash || "") !== computedPrevHash || (raw.hash_after || "") !== computedHashAfter) {
      issues.push({
        code: "LEDGER_HASH_MISMATCH",
        message: `Ledger row ${id} hash mismatch`,
        expected: computedHashAfter,
        actual: raw.hash_after || null,
      });
      const entry = recordUpdate(id, computedPrevHash, computedHashAfter);
      if (entry.balance_after_cents === undefined) entry.balance_after_cents = runningBalance;
    }

    const canonicalLeaf = JSON.stringify({
      amount_cents: amount,
      balance_after_cents: runningBalance,
      bank_receipt_hash: receipt,
    });
    leaves.push(canonicalLeaf);

    proofRows.push({
      id,
      amount_cents: amount,
      balance_after_cents: storedBalance,
      bank_receipt_hash: receipt || null,
      prev_hash: raw.prev_hash || null,
      hash_after: raw.hash_after || null,
      created_at: raw.created_at,
      computed_prev_hash: computedPrevHash,
      computed_hash_after: computedHashAfter,
      computed_balance_after_cents: runningBalance,
    });

    prevHash = computedHashAfter;
  }

  const merkleRoot = merkleRootHex(leaves);
  const runningHash = rows.length ? prevHash : sha256Hex("");
  const tailReceipt = rows.length ? rows[rows.length - 1].bank_receipt_hash || null : null;

  const updates = Array.from(updateMap.values()).map((u) => ({
    id: u.id,
    prev_hash: u.prev_hash,
    hash_after: u.hash_after || sha256Hex((u.prev_hash || "") + String(u.balance_after_cents ?? 0)),
    balance_after_cents: u.balance_after_cents,
  }));

  return { rows: proofRows, creditedTotal, netBalance, merkleRoot, runningHash, tailReceipt, updates, issues };
}

export async function buildEvidenceBundle(abn: string, taxType: string, periodId: string) {
  const periodRes = await pool.query(
    "select * from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  if (periodRes.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const period = periodRes.rows[0];

  const ledger = await computeLedgerArtifacts(pool, abn, taxType, periodId);
  const rptRes = await pool.query(
    "select payload, signature, payload_c14n, payload_sha256, created_at from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  const rptRow = rptRes.rows[0] || null;

  let rptPayload: any = null;
  let rptPayloadC14n: string | null = null;
  let rptPayloadSha256: string | null = null;
  if (rptRow) {
    rptPayload = typeof rptRow.payload === "string" ? JSON.parse(rptRow.payload) : rptRow.payload;
    rptPayloadC14n = rptRow.payload_c14n || canonicalJson(rptPayload);
    rptPayloadSha256 = rptRow.payload_sha256 || sha256Hex(rptPayloadC14n);
  }

  const thresholds = normalizeThresholds(period.thresholds);
  const accrued = Number(period.accrued_cents ?? 0);
  const credited = Number(period.credited_to_owa_cents ?? ledger.creditedTotal);
  const finalLiability = Number(period.final_liability_cents ?? ledger.creditedTotal);

  const basLabels = {
    W1: taxType === "PAYGW" ? accrued : null,
    W2: taxType === "PAYGW" ? Math.max(0, accrued - finalLiability) : null,
    "1A": taxType === "GST" ? finalLiability : finalLiability,
    "1B": taxType === "GST" ? Math.max(0, credited - finalLiability) : null,
  };

  const discrepancyLog: DiscrepancyEntry[] = [...ledger.issues];
  if (credited !== ledger.creditedTotal) {
    discrepancyLog.push({
      code: "PERIOD_CREDIT_MISMATCH",
      message: "Period credited_to_owa_cents differs from ledger credits",
      expected: ledger.creditedTotal,
      actual: credited,
      delta: credited - ledger.creditedTotal,
    });
  }
  if ((period.merkle_root || "") !== ledger.merkleRoot) {
    discrepancyLog.push({
      code: "MERKLE_MISMATCH",
      message: "Stored period merkle_root differs from computed ledger root",
      expected: ledger.merkleRoot,
      actual: period.merkle_root || null,
    });
  }
  if ((period.running_balance_hash || "") !== ledger.runningHash) {
    discrepancyLog.push({
      code: "RUNNING_BALANCE_HASH_MISMATCH",
      message: "Stored running_balance_hash differs from ledger tail hash",
      expected: ledger.runningHash,
      actual: period.running_balance_hash || null,
    });
  }
  if (rptPayloadSha256 && rptRow?.payload_sha256 && rptRow.payload_sha256 !== rptPayloadSha256) {
    discrepancyLog.push({
      code: "RPT_PAYLOAD_SHA_MISMATCH",
      message: "Stored payload_sha256 differs from recomputed hash",
      expected: rptPayloadSha256,
      actual: rptRow.payload_sha256,
    });
  }

  const meta = { generated_at: new Date().toISOString(), abn, taxType, periodId };
  const periodSummary = {
    state: period.state,
    accrued_cents: accrued,
    credited_to_owa_cents: credited,
    final_liability_cents: finalLiability,
    merkle_root: ledger.merkleRoot,
    running_balance_hash: ledger.runningHash,
    anomaly_vector: period.anomaly_vector || {},
    thresholds,
  };

  const rpt = rptRow
    ? {
        payload: rptPayload,
        signature: rptRow.signature,
        created_at: rptRow.created_at,
        payload_c14n: rptPayloadC14n,
        payload_sha256: rptPayloadSha256,
      }
    : null;

  const owaLedger = ledger.rows.map((row) => ({
    id: row.id,
    amount_cents: row.amount_cents,
    balance_after_cents: row.balance_after_cents,
    bank_receipt_hash: row.bank_receipt_hash,
    prev_hash: row.prev_hash,
    hash_after: row.hash_after,
    computed_prev_hash: row.computed_prev_hash,
    computed_hash_after: row.computed_hash_after,
    computed_balance_after_cents: row.computed_balance_after_cents,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  }));

  return {
    meta,
    period: periodSummary,
    rpt,
    owa_ledger: owaLedger,
    bas_labels: basLabels,
    verification: {
      ledger_merkle_root: ledger.merkleRoot,
      ledger_tail_hash: ledger.runningHash,
      last_bank_receipt_hash: ledger.tailReceipt,
      rpt_payload_sha256: rptPayloadSha256,
    },
    discrepancy_log: discrepancyLog,
  };
}
