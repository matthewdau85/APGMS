import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { merkleRootHex, sha256Hex } from "../crypto/merkle";
import { Pool } from "pg";
const pool = new Pool();

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr = thresholds ? { ...DEFAULT_THRESHOLDS, ...thresholds } : { ...DEFAULT_THRESHOLDS };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: periodRows } = await client.query(
      `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE`,
      [abn, taxType, periodId]
    );
    if (periodRows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    }

    const period = periodRows[0];
    if (period.state !== "OPEN" && period.state !== "CLOSING") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "BAD_STATE", state: period.state });
    }

    const { rows: ledgerRows } = await client.query(
      `SELECT id, transfer_uuid, amount_cents, balance_after_cents, bank_receipt_hash, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id`,
      [abn, taxType, periodId]
    );

    let creditedToOwa = 0;
    let runningHash = "";
    const leaves: string[] = [];
    for (const row of ledgerRows) {
      const amount = Number(row.amount_cents || 0);
      if (amount > 0) creditedToOwa += amount;
      const balance = Number(row.balance_after_cents || 0);
      const receiptHash = row.bank_receipt_hash || "";
      const computedHash = sha256Hex(runningHash + receiptHash + String(balance));
      runningHash = row.hash_after && row.hash_after.length ? row.hash_after : computedHash;
      leaves.push(
        JSON.stringify({
          transfer_uuid: row.transfer_uuid,
          amount_cents: amount,
          balance_after_cents: balance,
          bank_receipt_hash: receiptHash,
          hash_after: runningHash,
        })
      );
    }
    const existingCredits = Number(period.credited_to_owa_cents || 0);
    if (leaves.length === 0) {
      creditedToOwa = creditedToOwa || existingCredits;
      runningHash = sha256Hex("");
    }
    const finalLiability = creditedToOwa || Number(period.final_liability_cents || existingCredits);
    const merkleRoot = merkleRootHex(leaves);

    await client.query(
      `UPDATE periods
          SET state=$4,
              credited_to_owa_cents=$5,
              final_liability_cents=$6,
              merkle_root=$7,
              running_balance_hash=$8,
              thresholds=$9::jsonb
        WHERE id=$1`,
      [
        period.id,
        "CLOSING",
        creditedToOwa,
        finalLiability,
        merkleRoot,
        runningHash,
        JSON.stringify(thr),
      ]
    );

    await client.query("COMMIT");
  } catch (e: any) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: e.message });
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
  const rpt = await pool.query(
    `SELECT payload FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  if (rpt.rowCount === 0) {
    if (res.locals?.completeIdempotency) {
      await res.locals.completeIdempotency("ERROR", { error: "NO_RPT" });
    }
    return res.status(400).json({ error: "NO_RPT" });
  }
  const payload = rpt.rows[0].payload;

  try {
    const destination = await resolveDestination(abn, rail, payload.reference);
    const releaseResult = await releasePayment(
      abn,
      taxType,
      periodId,
      payload.amount_cents,
      rail,
      destination.reference
    );
    const release: any = releaseResult;
    if (release.status === "DUPLICATE") {
      if (res.locals?.completeIdempotency) {
        await res.locals.completeIdempotency("ERROR", { error: "DUPLICATE_TRANSFER" });
      }
      return res.status(409).json({ error: "DUPLICATE_TRANSFER" });
    }

    const latestHash = release.hash_after ?? null;
    const latestBalance = Number(release.balance_after_cents ?? 0);

    await pool.query(
      `UPDATE periods
          SET state=$4,
              running_balance_hash=$5
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId, "RELEASED", latestHash]
    );

    const response = {
      transfer_uuid: release.transfer_uuid,
      bank_receipt_hash: release.bank_receipt_hash,
      new_balance: latestBalance,
      destination: {
        rail: destination.rail,
        reference: destination.reference,
      },
    };

    if (res.locals?.completeIdempotency) {
      await res.locals.completeIdempotency("DONE", response);
    }
    return res.json(response);
  } catch (e: any) {
    if (res.locals?.completeIdempotency) {
      await res.locals.completeIdempotency("ERROR", { error: e.message });
    }
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
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
