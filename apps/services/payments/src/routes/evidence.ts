import path from "node:path";
import type { Request, Response } from "express";
import { pool } from "../index.js";
import { computeRulesManifest } from "../evidence/rulesManifest.js";
import { buildEvidenceView } from "../evidence/view.js";

const rulesDir = process.env.RULES_DIR || path.resolve(process.cwd(), "rules");

export async function evidence(req: Request, res: Response) {
  const { periodId } = req.params;
  const { abn, taxType } = req.query as Record<string, string>;

  if (!abn || !taxType) {
    return res.status(400).json({ error: "Missing abn/taxType" });
  }

  const { rows: periodRows } = await pool.query(
    `SELECT narrative, running_balance_hash
       FROM periods
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      LIMIT 1`,
    [abn, taxType, periodId],
  );

  if (!periodRows.length) {
    return res.status(404).json({ error: "Period not found" });
  }

  const periodRow = periodRows[0];

  const { rows: releaseRows } = await pool.query(
    `SELECT provider_ref, amount_cents, provider_paid_at, hash_after
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND provider_ref IS NOT NULL
      ORDER BY id DESC
      LIMIT 1`,
    [abn, taxType, periodId],
  );

  const releaseRow = releaseRows.length
    ? {
        provider_ref: releaseRows[0].provider_ref,
        amount_cents: Number(releaseRows[0].amount_cents),
        provider_paid_at: releaseRows[0].provider_paid_at
          ? new Date(releaseRows[0].provider_paid_at).toISOString()
          : null,
        hash_after: releaseRows[0].hash_after,
      }
    : null;

  const { rows: approvalRows } = await pool.query(
    `SELECT actor, note, approved_at
       FROM period_approvals
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY approved_at ASC`,
    [abn, taxType, periodId],
  );

  const approvals = approvalRows.map(row => ({
    actor: row.actor,
    note: row.note,
    approved_at: new Date(row.approved_at).toISOString(),
  }));

  const manifest = await computeRulesManifest(rulesDir, process.env.RULES_VERSION || undefined);

  const view = buildEvidenceView(
    {
      abn,
      taxType,
      periodId,
      narrative: periodRow.narrative,
      runningBalanceHash: periodRow.running_balance_hash,
    },
    releaseRow,
    approvals,
    manifest,
  );

  res.json(view);
}

