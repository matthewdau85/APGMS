import { Request, Response } from "express";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { getPool } from "../db/pool";
import { merkleRootHex } from "../crypto/merkle";
import { canonicalJson } from "../utils/json";
import { next, PeriodState } from "../recon/stateMachine";
import { isAnomalous } from "../anomaly/deterministic";

const pool = getPool();

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

interface CloseParams {
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  thresholds?: Record<string, number>;
}

interface CloseResult {
  state: PeriodState;
  epsilon: number;
  anomaly: boolean;
  thresholds: Record<string, number>;
}

export async function reconcilePeriod({ abn, taxType, periodId, thresholds }: CloseParams): Promise<CloseResult> {
  const thr = { ...DEFAULT_THRESHOLDS, ...(thresholds ?? {}) };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
      [abn, taxType, periodId]
    );
    if (!rows.length) {
      throw new Error("PERIOD_NOT_FOUND");
    }
    const period = rows[0];
    let state: PeriodState = period.state;
    if (state === "OPEN") {
      state = next(state, "START_CLOSING");
    }
    if (!["CLOSING", "RECON_FAIL"].includes(state)) {
      throw new Error("BAD_STATE");
    }

    const { rows: ledgerRows } = await client.query(
      "select id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    );

    let credited = 0;
    for (const row of ledgerRows) {
      const amt = Number(row.amount_cents || 0);
      if (amt > 0) credited += amt;
    }
    const merkleLeaves = ledgerRows.map(row =>
      canonicalJson({
        id: row.id,
        amount_cents: Number(row.amount_cents || 0),
        balance_after_cents: Number(row.balance_after_cents || 0),
        bank_receipt_hash: row.bank_receipt_hash || "",
        hash_after: row.hash_after || "",
      })
    );
    const merkle_root = merkleRootHex(merkleLeaves);
    const running_balance_hash = ledgerRows.length ? ledgerRows[ledgerRows.length - 1].hash_after || "" : "";
    const epsilon = Math.abs(credited - Number(period.credited_to_owa_cents || 0));
    const anomalyVector = period.anomaly_vector || {};
    const anomaly = isAnomalous(anomalyVector, thr);

    let newState = state;
    if (anomaly || epsilon > (thr.epsilon_cents ?? 0)) {
      newState = next(state, "RECONCILE_FAIL");
    } else {
      newState = next(state, "RECONCILE_OK");
    }

    await client.query(
      "update periods set state=$1, credited_to_owa_cents=$2, final_liability_cents=$3, merkle_root=$4, running_balance_hash=$5, thresholds=$6 where id=$7",
      [newState, credited, credited, merkle_root, running_balance_hash, JSON.stringify(thr), period.id]
    );
    await client.query("COMMIT");
    return { state: newState, epsilon, anomaly, thresholds: thr };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePeriodAndIssue(params: CloseParams) {
  const result = await reconcilePeriod(params);
  if (result.state !== "RECON_OK") {
    return result;
  }
  const rpt = await issueRPT(params.abn, params.taxType, params.periodId, result.thresholds);
  return { ...result, state: "READY_RPT" as PeriodState, rpt };
}

export async function closeAndIssue(req: Request, res: Response) {
  try {
    const abn = (req.body?.abn ?? req.query?.abn) as string;
    const taxType = (req.body?.taxType ?? req.query?.taxType) as "PAYGW" | "GST";
    const periodId = (req.params as any)?.periodId ?? (req.body?.periodId as string);
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "MISSING_FIELDS" });
    }
    const thresholds = req.body?.thresholds as Record<string, number> | undefined;
    const result = await closePeriodAndIssue({ abn, taxType, periodId, thresholds });
    if (result.state !== "READY_RPT") {
      return res.status(409).json({
        state: result.state,
        anomaly: result.anomaly,
        epsilon: result.epsilon,
      });
    }
    return res.json(result.rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message || "CLOSE_FAILED" });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body as any;
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state=$1 where abn=$2 and tax_type=$3 and period_id=$4", ["RELEASED", abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body as any;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
