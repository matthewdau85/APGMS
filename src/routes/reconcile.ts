import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle, computeLedgerArtifacts, normalizeThresholds } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";

const pool = new Pool();

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  const normalizedTaxType = String(taxType).toUpperCase();
  if (normalizedTaxType !== "GST" && normalizedTaxType !== "PAYGW") {
    return res.status(400).json({ error: "INVALID_TAX_TYPE" });
  }

  const client = await pool.connect();
  let finalThresholds: Record<string, number> = normalizeThresholds(thresholds);
  try {
    await client.query("BEGIN");
    const periodRes = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
      [abn, normalizedTaxType, periodId]
    );
    if (periodRes.rowCount === 0) {
      throw new Error("PERIOD_NOT_FOUND");
    }
    const period = periodRes.rows[0];

    const ledger = await computeLedgerArtifacts(client, abn, normalizedTaxType, periodId);

    for (const update of ledger.updates) {
      const sets = ["prev_hash=$1", "hash_after=$2"];
      const values: any[] = [update.prev_hash, update.hash_after];
      let nextIdx = 3;
      if (update.balance_after_cents !== undefined) {
        sets.push(`balance_after_cents=$${nextIdx}`);
        values.push(update.balance_after_cents);
        nextIdx += 1;
      }
      values.push(update.id);
      const sql = `update owa_ledger set ${sets.join(", ")} where id=$${nextIdx}`;
      await client.query(sql, values);
    }

    const credited = ledger.creditedTotal;
    const finalLiability = credited;
    finalThresholds = normalizeThresholds(period.thresholds, thresholds);

    await client.query(
      "update periods set state=$1, credited_to_owa_cents=$2, final_liability_cents=$3, merkle_root=$4, running_balance_hash=$5, thresholds=$6 where id=$7",
      [
        "CLOSING",
        credited,
        finalLiability,
        ledger.merkleRoot,
        ledger.runningHash,
        finalThresholds,
        period.id,
      ]
    );

    await client.query("COMMIT");
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err?.message === "PERIOD_NOT_FOUND") {
      return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    }
    return res.status(400).json({ error: err.message });
  } finally {
    client.release();
  }

  try {
    const rpt = await issueRPT(abn, normalizedTaxType as "PAYGW" | "GST", periodId, finalThresholds);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query("select * from rpt_tokens where abn= and tax_type= and period_id= order by id desc limit 1", [abn, taxType, periodId]);
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
