import { Request, Response } from "express";
import { Pool } from "pg";

import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import {
  CloseAndIssueBody,
  EvidenceQuery,
  PayAtoBody,
  PaytoSweepBody,
  SettlementWebhookBody,
} from "../http/validate";

const pool = new Pool();

export async function closeAndIssue(
  req: Request<unknown, unknown, CloseAndIssueBody>,
  res: Response
) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr =
    thresholds || {
      epsilon_cents: 50,
      variance_ratio: 0.25,
      dup_rate: 0.01,
      gap_minutes: 60,
      delta_vs_baseline: 0.2,
    };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    return res.status(400).json({ error });
  }
}

export async function payAto(
  req: Request<unknown, unknown, PayAtoBody>,
  res: Response
) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) {
    return res.status(400).json({ error: "NO_RPT" });
  }
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(
      abn,
      taxType,
      periodId,
      payload.amount_cents,
      rail,
      payload.reference
    );
    await pool.query(
      "update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
    return res.json(r);
  } catch (e) {
    const error = e instanceof Error ? e.message : "Unknown error";
    return res.status(400).json({ error });
  }
}

export async function paytoSweep(
  req: Request<unknown, unknown, PaytoSweepBody>,
  res: Response
) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(
  req: Request<unknown, unknown, SettlementWebhookBody>,
  res: Response
) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(
  req: Request<unknown, unknown, unknown, EvidenceQuery>,
  res: Response
) {
  const { abn, taxType, periodId } = req.query;
  const bundle = await buildEvidenceBundle(abn, taxType, periodId);
  res.json(bundle);
}

