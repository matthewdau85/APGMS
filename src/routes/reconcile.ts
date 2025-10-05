import type { Request, Response } from "express";
import { Pool } from "pg";

import { buildEvidenceBundle } from "../evidence/bundle";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { issueRPT } from "../rpt/issuer";
import { releasePayment, resolveDestination } from "../rails/adapter";

const pool = new Pool();

type SettlementException = { id: number };

async function enqueueSettlementException(
  txnId: string,
  bankReference: string,
  reason: string,
  payload: unknown
): Promise<SettlementException> {
  const existing = await pool.query<{ id: number }>(
    `select id from settlement_exceptions where txn_id = $1 or bank_reference = $2 limit 1`,
    [txnId, bankReference]
  );

  if (existing.rowCount > 0) {
    const exceptionId = existing.rows[0].id;
    await pool.query(
      `update settlement_exceptions
          set reason = $2,
              raw_payload = $3,
              status = 'OPEN',
              updated_at = now(),
              resolved_at = null,
              resolution_notes = null,
              txn_id = case when coalesce($4, '') <> '' then $4 else txn_id end,
              bank_reference = case when coalesce($5, '') <> '' then $5 else bank_reference end
        where id = $1`,
      [exceptionId, reason, payload, txnId, bankReference]
    );
    return { id: exceptionId };
  }

  const inserted = await pool.query<SettlementException>(
    `insert into settlement_exceptions (txn_id, bank_reference, reason, raw_payload)
     values ($1, $2, $3, $4)
     returning id`,
    [txnId, bankReference, reason, payload]
  );
  return inserted.rows[0];
}

export async function closeAndIssue(req: Request, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr =
    thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = typeof req.body?.csv === "string" ? req.body.csv : "";
  const rows = parseSettlementCSV(csvText);

  const seenTxn = new Set<string>();
  const seenBankRef = new Set<string>();
  const flagged: Array<{ txn_id: string; bank_reference: string; reason: string; exception_id: number }> = [];
  let processedCount = 0;

  for (const row of rows) {
    const txnId = String(row.txn_id ?? "").trim();
    const bankReference = String(row.bank_reference ?? "").trim();
    let reason: string | null = null;

    if (!txnId || !bankReference) {
      reason = "MISSING_IDENTIFIERS";
    } else if (seenTxn.has(txnId)) {
      reason = "DUPLICATE_TXN_ID_IN_BATCH";
    } else if (seenBankRef.has(bankReference)) {
      reason = "DUPLICATE_BANK_REFERENCE_IN_BATCH";
    } else {
      const existing = await pool.query<{ txn_id: string; bank_reference: string; status: string }>(
        `select txn_id, bank_reference, status
           from settlement_exceptions
          where txn_id = $1 or bank_reference = $2
          order by created_at desc
          limit 1`,
        [txnId, bankReference]
      );

      if (existing.rowCount > 0) {
        const match = existing.rows[0];
        if (match.txn_id === txnId) {
          reason = "DUPLICATE_TXN_ID_HISTORY";
        } else if (match.bank_reference === bankReference) {
          reason = "DUPLICATE_BANK_REFERENCE_HISTORY";
        }
      }
    }

    if (reason) {
      const exception = await enqueueSettlementException(txnId, bankReference, reason, row);
      flagged.push({ txn_id: txnId, bank_reference: bankReference, reason, exception_id: exception.id });
      continue;
    }

    seenTxn.add(txnId);
    seenBankRef.add(bankReference);
    // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
    processedCount += 1;
  }

  return res.json({ ingested: processedCount, flagged });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}

export async function listSettlementExceptions(req: Request, res: Response) {
  const statusFilter = typeof req.query.status === "string" ? req.query.status : null;
  const result = await pool.query(
    `select id, txn_id, bank_reference, reason, status, created_at, updated_at, resolved_at, resolution_notes, raw_payload
       from settlement_exceptions
      where ($1::text is null or status = $1)
      order by created_at asc`,
    [statusFilter]
  );

  return res.json({ exceptions: result.rows });
}
