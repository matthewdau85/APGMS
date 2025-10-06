import type { Request, Response } from "express";
import { Pool } from "pg";

import { merkleRootHex } from "../crypto/merkle";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";

const pool = new Pool();

type ThresholdInput = Partial<Record<
  "epsilon_cents" | "variance_ratio" | "dup_rate" | "gap_minutes" | "delta_vs_baseline",
  number
>>;

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

const DEFAULT_ANOMALY = {
  variance_ratio: 0.1,
  dup_rate: 0,
  gap_minutes: 10,
  delta_vs_baseline: 0.05,
};

function normalizeThresholds(input?: ThresholdInput) {
  return Object.fromEntries(
    Object.entries(DEFAULT_THRESHOLDS).map(([key, fallback]) => {
      const raw = input?.[key as keyof ThresholdInput];
      const value = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
      return [key, value];
    })
  ) as typeof DEFAULT_THRESHOLDS;
}

function normalizeAnomaly(raw: any) {
  return Object.fromEntries(
    Object.entries(DEFAULT_ANOMALY).map(([key, fallback]) => {
      const value = Number(raw?.[key]);
      return [key, Number.isFinite(value) ? value : fallback];
    })
  );
}

async function primePeriod(abn: string, taxType: string, periodId: string, thresholds: typeof DEFAULT_THRESHOLDS) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const periodRes = await client.query(
      `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE`,
      [abn, taxType, periodId]
    );

    if (periodRes.rowCount === 0) {
      await client.query(
        `INSERT INTO periods(
           abn,tax_type,period_id,state,basis,accrued_cents,credited_to_owa_cents,final_liability_cents,
           merkle_root,running_balance_hash,anomaly_vector,thresholds
         ) VALUES ($1,$2,$3,'OPEN','ACCRUAL',0,0,0,NULL,NULL,$4,$5)
         ON CONFLICT (abn,tax_type,period_id) DO NOTHING`,
        [abn, taxType, periodId, DEFAULT_ANOMALY, thresholds]
      );
    }

    const lockedRes = periodRes.rowCount
      ? periodRes
      : await client.query(
          `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE`,
          [abn, taxType, periodId]
        );

    if (lockedRes.rowCount === 0) {
      throw new Error("PERIOD_NOT_FOUND");
    }

    const period = lockedRes.rows[0];

    const ledgerRes = await client.query(
      `SELECT amount_cents, bank_receipt_hash, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id`,
      [abn, taxType, periodId]
    );

    const ledgerRows = ledgerRes.rows as Array<{
      amount_cents: number | string;
      bank_receipt_hash: string | null;
      hash_after: string | null;
    }>;

    const credited = ledgerRows.reduce((sum, row) => {
      const amt = Number(row.amount_cents);
      return amt > 0 ? sum + amt : sum;
    }, 0);

    const leaves = ledgerRows.map(row => {
      const base = row.bank_receipt_hash ?? row.hash_after ?? `row:${row.amount_cents}`;
      return `${base}:${row.amount_cents}`;
    });
    const merkleRoot = leaves.length ? merkleRootHex(leaves) : null;
    const runningHash = ledgerRes.rows.length ? ledgerRes.rows[ledgerRes.rows.length - 1].hash_after ?? null : null;

    const anomalyVector = normalizeAnomaly(period.anomaly_vector);

    await client.query(
      `UPDATE periods SET
         state='CLOSING',
         accrued_cents=$4,
         credited_to_owa_cents=$4,
         final_liability_cents=$4,
         thresholds=$5,
         anomaly_vector=$6,
         merkle_root=$7,
         running_balance_hash=$8
       WHERE id=$9`,
      [abn, taxType, periodId, credited, thresholds, anomalyVector, merkleRoot, runningHash, period.id]
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }

  const thresholds = normalizeThresholds(req.body?.thresholds as ThresholdInput | undefined);

  try {
    await primePeriod(abn, taxType, periodId, thresholds);
    const rpt = await issueRPT(abn, taxType as "PAYGW" | "GST", periodId, thresholds);
    return res.json(rpt);
  } catch (e: any) {
    console.error("closeAndIssue error", e);
    return res.status(400).json({ error: e?.message || "CLOSE_AND_ISSUE_FAILED" });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.body || {};
  const rail = ((req.body || {}).rail || "EFT") as "EFT" | "BPAY";
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }

  const pr = await pool.query(
    `SELECT payload FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        AND status IN ('pending','active')
      ORDER BY id DESC
      LIMIT 1`,
    [abn, taxType, periodId]
  );

  if (pr.rowCount === 0) {
    return res.status(400).json({ error: "NO_RPT" });
  }

  const payload = pr.rows[0].payload || {};
  const amount = Number(payload.amount_cents);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "INVALID_RPT_AMOUNT" });
  }

  try {
    const reference = String(payload.reference || "");
    await resolveDestination(abn, rail, reference);
    const release = await releasePayment(abn, taxType, periodId, amount, rail, reference);
    await pool.query(
      `UPDATE periods SET state='RELEASED' WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    return res.json(release);
  } catch (e: any) {
    console.error("payAto error", e);
    return res.status(400).json({ error: e?.message || "RELEASE_FAILED" });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body || {};
  try {
    const r = await paytoDebit(abn, amount_cents, reference);
    return res.json(r);
  } catch (e: any) {
    console.error("paytoSweep error", e);
    return res.status(400).json({ error: e?.message || "SWEEP_FAILED" });
  }
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as Record<string, string>;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  try {
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    return res.json(bundle);
  } catch (e: any) {
    console.error("evidence error", e);
    return res.status(500).json({ error: e?.message || "EVIDENCE_FAILED" });
  }
}
