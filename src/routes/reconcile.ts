import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { merkleRootHex } from "../crypto/merkle";
import { Pool } from "pg";

const pool = new Pool();
const RECON_URL = process.env.RECON_URL || "http://recon:8000";
const BAS_GATE_URL = process.env.BAS_GATE_URL || "http://bas-gate:8101";

interface Thresholds {
  [key: string]: number;
}

interface ReconOutcome {
  passed: boolean;
  reason_code: string | null;
  next_state: string;
  anomaly_vector: Record<string, number>;
  thresholds: Record<string, number>;
  totals?: Record<string, any>;
}

interface ClosureSummary {
  final_liability_cents: number;
  credited_to_owa_cents: number;
  merkle_root: string | null;
  running_balance_hash: string | null;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

async function ensurePeriod(abn: string, taxType: string, periodId: string) {
  const r = await pool.query(
    "select id, state from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  if (r.rowCount === 0) {
    throw new Error("PERIOD_NOT_FOUND");
  }
  return r.rows[0];
}

async function syncTotals(abn: string, taxType: string, periodId: string) {
  await pool.query("select periods_sync_totals($1,$2,$3)", [abn, taxType, periodId]);
}

async function computeLedgerClosure(
  abn: string,
  taxType: string,
  periodId: string,
  thresholds: Thresholds
): Promise<ClosureSummary> {
  await syncTotals(abn, taxType, periodId);
  const ledger = await pool.query(
    "select id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
    [abn, taxType, periodId]
  );
  const leaves = ledger.rows.map((row) =>
    [
      row.id,
      row.amount_cents,
      row.balance_after_cents,
      row.bank_receipt_hash || "",
      row.hash_after || "",
    ].join(":")
  );
  const merkle_root = leaves.length ? merkleRootHex(leaves) : null;
  const running_balance_hash = ledger.rows.length
    ? ledger.rows[ledger.rows.length - 1].hash_after || null
    : null;

  const update = await pool.query(
    "update periods set state='CLOSING', merkle_root=$4, running_balance_hash=$5, thresholds=$6::jsonb where abn=$1 and tax_type=$2 and period_id=$3 returning final_liability_cents, credited_to_owa_cents",
    [abn, taxType, periodId, merkle_root, running_balance_hash, JSON.stringify(thresholds)]
  );
  if (update.rowCount === 0) throw new Error("PERIOD_NOT_FOUND");
  const row = update.rows[0];
  return {
    final_liability_cents: Number(row.final_liability_cents || 0),
    credited_to_owa_cents: Number(row.credited_to_owa_cents || 0),
    merkle_root,
    running_balance_hash,
  };
}

async function runRecon(
  abn: string,
  taxType: string,
  periodId: string,
  thresholds: Thresholds
): Promise<ReconOutcome> {
  const resp = await fetch(`${RECON_URL}/recon/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      abn,
      tax_type: taxType,
      period_id: periodId,
      thresholds,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`RECON_ERROR:${resp.status}:${body}`);
  }
  const data = (await resp.json()) as ReconOutcome;
  return data;
}

async function transitionBasGate(
  periodId: string,
  targetState: string,
  recon?: ReconOutcome
) {
  const payload: any = {
    period_id: periodId,
    target_state: targetState,
  };
  if (recon) {
    payload.recon = {
      passed: recon.passed,
      reason_code: recon.reason_code,
      anomaly_vector: recon.anomaly_vector,
      thresholds: recon.thresholds,
    };
  }
  const resp = await fetch(`${BAS_GATE_URL}/gate/transition`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`BAS_GATE_ERROR:${resp.status}:${text}`);
  }
}

function mergeThresholds(thr?: Thresholds): Thresholds {
  return { ...DEFAULT_THRESHOLDS, ...(thr || {}) };
}

function mapBlockState(reason: string | null): "BLOCKED_ANOMALY" | "BLOCKED_DISCREPANCY" {
  if (reason === "baseline_delta") return "BLOCKED_DISCREPANCY";
  return "BLOCKED_ANOMALY";
}

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  const thr = mergeThresholds(thresholds);
  try {
    await ensurePeriod(abn, taxType, periodId);
    const closure = await computeLedgerClosure(abn, taxType, periodId, thr);
    const recon = await runRecon(abn, taxType, periodId, thr);

    await pool.query(
      "update periods set anomaly_vector=$4::jsonb where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId, JSON.stringify(recon.anomaly_vector)]
    );

    if (!recon.passed) {
      const blockState = mapBlockState(recon.reason_code);
      await pool.query(
        "update periods set state=$4 where abn=$1 and tax_type=$2 and period_id=$3",
        [abn, taxType, periodId, blockState]
      );
      await transitionBasGate(periodId, "Blocked", recon);
      return res.status(409).json({
        error: recon.reason_code || "RECON_FAILED",
        anomaly_vector: recon.anomaly_vector,
        thresholds: recon.thresholds,
      });
    }

    await transitionBasGate(periodId, "Reconciling", recon);
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    await transitionBasGate(periodId, "RPT-Issued", recon);

    return res.json({
      rpt,
      anomaly_vector: recon.anomaly_vector,
      closure,
    });
  } catch (e: any) {
    return res.status(400).json({ error: e.message || "PRE_CLOSE_FAILED" });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query(
      "update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: any, res: any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: any, res: any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
