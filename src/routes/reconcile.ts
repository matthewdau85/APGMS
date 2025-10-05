import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
import { randomUUID } from "crypto";
const pool = new Pool();

export async function closeAndIssue(req:any, res:any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  // TODO: set state -> CLOSING, compute final_liability_cents, merkle_root, running_balance_hash beforehand
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req:any, res:any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId]);
  if (pr.rowCount === 0) return res.status(400).json({error:"NO_RPT"});
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn= and tax_type= and period_id=", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req:any, res:any) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req:any, res:any) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  if (!rows.length) {
    return res.json({ ingested: 0, duplicates: 0 });
  }

  const client = await pool.connect();
  let ingested = 0;
  let duplicates = 0;
  try {
    await client.query("BEGIN");

    for (const row of rows) {
      const txnId = row.txn_id;
      const gst = ensureInteger(row.gst_cents, "gst_cents", txnId);
      const net = ensureInteger(row.net_cents, "net_cents", txnId);
      const settlementTs = new Date(row.settlement_ts);
      if (Number.isNaN(settlementTs.getTime())) {
        throw new Error(`INVALID_TS:${txnId}`);
      }
      const settlementIso = settlementTs.toISOString();

      const payable = await client.query(
        `SELECT abn, tax_type, period_id, amount_cents
         FROM owa_ledger
         WHERE transfer_uuid=$1
         FOR UPDATE`,
        [txnId]
      );
      if (payable.rowCount === 0) {
        throw new Error(`UNKNOWN_TXN:${txnId}`);
      }
      const payableRow = payable.rows[0];
      const payableAmount = Number(payableRow.amount_cents);
      if (!Number.isFinite(payableAmount) || payableAmount >= 0) {
        throw new Error(`NOT_PAYABLE:${txnId}`);
      }

      const components = [
        { component: "GST", amount: gst },
        { component: "NET", amount: net }
      ];

      const inserts: { component: string; amount: number }[] = [];
      for (const part of components) {
        if (part.amount === 0) continue;
        const existing = await client.query(
          `SELECT 1 FROM settlement_reversals
            WHERE txn_id=$1 AND component=$2 AND amount_cents=$3 AND settlement_ts=$4`,
          [txnId, part.component, part.amount, settlementIso]
        );
        if (existing.rowCount > 0) {
          continue;
        }
        inserts.push(part);
      }

      if (inserts.length === 0) {
        duplicates += 1;
        continue;
      }

      const settledTotalRes = await client.query(
        `SELECT COALESCE(SUM(amount_cents),0) AS total
           FROM settlement_reversals
          WHERE txn_id=$1`,
        [txnId]
      );
      const settledSoFar = Number(settledTotalRes.rows[0].total) || 0;
      const toSettle = inserts.reduce((sum, p) => sum + p.amount, 0);
      const newTotal = settledSoFar + toSettle;
      const payableAbs = Math.abs(payableAmount);
      if (newTotal > payableAbs) {
        throw new Error(`OVER_SETTLEMENT:${txnId}`);
      }
      if (newTotal < 0) {
        throw new Error(`NEGATIVE_SETTLEMENT:${txnId}`);
      }

      for (const part of inserts) {
        const { rows: balRows } = await client.query(
          `SELECT balance_after_cents FROM owa_ledger
             WHERE abn=$1 AND tax_type=$2 AND period_id=$3
             ORDER BY id DESC LIMIT 1`,
          [payableRow.abn, payableRow.tax_type, payableRow.period_id]
        );
        const prevBal = Number(balRows[0]?.balance_after_cents || 0);
        const newBal = prevBal + part.amount;
        const reversalTransferUuid = randomUUID();

        const inserted = await client.query(
          `INSERT INTO owa_ledger
             (abn,tax_type,period_id,transfer_uuid,amount_cents,balance_after_cents,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           RETURNING transfer_uuid`,
          [
            payableRow.abn,
            payableRow.tax_type,
            payableRow.period_id,
            reversalTransferUuid,
            part.amount,
            newBal,
            settlementIso
          ]
        );

        await client.query(
          `INSERT INTO settlement_reversals
             (txn_id, component, reversal_transfer_uuid, amount_cents, settlement_ts)
           VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (txn_id, component, reversal_transfer_uuid) DO NOTHING`,
          [
            txnId,
            part.component,
            inserted.rows[0].transfer_uuid,
            part.amount,
            settlementIso
          ]
        );
      }

      ingested += 1;
    }

    await client.query("COMMIT");
    return res.json({ ingested, duplicates });
  } catch (e:any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: e.message || String(e) });
  } finally {
    client.release();
  }
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}

function ensureInteger(value:number, field:string, txnId:string) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new Error(`INVALID_${field}:${txnId}`);
  }
  if (!Number.isInteger(num)) {
    throw new Error(`NON_INTEGER_${field}:${txnId}`);
  }
  return num;
}
