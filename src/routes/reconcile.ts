import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
import { normalizeReference } from "../bankFeed/util";
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
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({error:"NO_RPT"});
  const payload = pr.rows[0].payload;
  try {
    const destination = await resolveDestination(abn, rail, payload.reference);
    const amountCents = Number(payload.amount_cents);
    if (!Number.isFinite(amountCents)) throw new Error("INVALID_AMOUNT");
    const r = await releasePayment(abn, taxType, periodId, amountCents, destination);
    await pool.query(
      "update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
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
  if (rows.length === 0) return res.status(400).json({ error: "NO_ROWS" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      const gst = Number(row.gst_cents) || 0;
      const net = Number(row.net_cents) || 0;
      const total = gst + net;
      const settlementTs = new Date(row.settlement_ts);
      if (Number.isNaN(settlementTs.valueOf())) {
        throw new Error("INVALID_SETTLEMENT_TS");
      }
      const reference = row.txn_id || "";
      const normalizedRef = normalizeReference(reference);
      await client.query(
        `insert into settlements(txn_id,gst_cents,net_cents,total_cents,settlement_ts,reference,reference_normalized,status)
         values ($1,$2,$3,$4,$5,$6,$7,'PENDING')
         on conflict (txn_id) do update set
           gst_cents=excluded.gst_cents,
           net_cents=excluded.net_cents,
           total_cents=excluded.total_cents,
           settlement_ts=excluded.settlement_ts,
           reference=excluded.reference,
           reference_normalized=excluded.reference_normalized,
           status=case when settlements.status='MATCHED' then 'MATCHED' else 'PENDING' end`,
        [reference, gst, net, total, settlementTs.toISOString(), reference, normalizedRef]
      );
    }
    await client.query("COMMIT");
    return res.json({ ingested: rows.length });
  } catch (err:any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err?.message || String(err) });
  } finally {
    client.release();
  }
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
