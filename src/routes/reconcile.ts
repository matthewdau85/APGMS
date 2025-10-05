import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { merkleRootHex } from "../crypto/merkle";
import { nextState, PeriodState, Thresholds } from "../recon/stateMachine";
import { Pool } from "pg";
const pool = new Pool();

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr: Thresholds = thresholds || {
    epsilon_cents: 50,
    variance_ratio: 0.25,
    dup_rate: 0.01,
    gap_minutes: 60,
    delta_vs_baseline: 0.2,
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodRes = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    }

    const period = periodRes.rows[0];
    const currentState = period.state as PeriodState;
    const closingState = nextState(currentState, "CLOSE");
    if (closingState !== "CLOSING") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "BAD_STATE", state: currentState });
    }

    const totals = await client.query(
      "select credited_cents from v_period_balances where abn=$1 and tax_type=$2 and period_id=$3",
      [abn, taxType, periodId]
    );
    const credited = Number(totals.rows[0]?.credited_cents ?? period.credited_to_owa_cents ?? 0);

    const ledger = await client.query(
      "select id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    );
    const leaves = ledger.rows.map((row: any) =>
      JSON.stringify({
        id: row.id,
        amount_cents: Number(row.amount_cents),
        balance_after_cents: Number(row.balance_after_cents),
        bank_receipt_hash: row.bank_receipt_hash || "",
        hash_after: row.hash_after || "",
      })
    );
    const merkleRoot = merkleRootHex(leaves);
    const runningHash = ledger.rows.length ? (ledger.rows[ledger.rows.length - 1].hash_after || "") : "";

    await client.query(
      `update periods
         set state=$1,
             credited_to_owa_cents=$2,
             final_liability_cents=$3,
             merkle_root=$4,
             running_balance_hash=$5,
             thresholds=$6
       where id=$7`,
      [closingState, credited, credited, merkleRoot, runningHash, thr, period.id]
    );
    await client.query("COMMIT");
  } catch (err: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }

  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
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
