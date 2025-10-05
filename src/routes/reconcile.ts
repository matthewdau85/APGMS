import { PoolClient } from "pg";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination, ReleaseError } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { pool } from "../db/pool";
import { merkleRootHex } from "../crypto/merkle";

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2
};

type CloseIssuePayload = {
  abn?: string;
  taxType?: string;
  periodId?: string;
  thresholds?: Record<string, number>;
};

interface LedgerRow {
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  transfer_uuid: string;
  id: number;
  hash_after: string | null;
}

function computeLedgerMerkle(rows: LedgerRow[]): string | null {
  if (rows.length === 0) return null;
  const leaves = rows.map((row) =>
    JSON.stringify({
      id: row.id,
      transfer_uuid: row.transfer_uuid,
      amount_cents: Number(row.amount_cents),
      balance_after_cents: Number(row.balance_after_cents),
      bank_receipt_hash: row.bank_receipt_hash ?? ""
    })
  );
  return merkleRootHex(leaves);
}

async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds }: CloseIssuePayload = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }
  const thr = { ...DEFAULT_THRESHOLDS, ...(thresholds || {}) };

  try {
    const rpt = await withTransaction(async (client) => {
      const periodQ = await client.query(
        `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE`,
        [abn, taxType, periodId]
      );
      if (periodQ.rowCount === 0) {
        throw new Error("PERIOD_NOT_FOUND");
      }
      const period = periodQ.rows[0];
      if (!["OPEN", "CLOSING"].includes(period.state)) {
        throw new Error("BAD_STATE");
      }

      await client.query(`SELECT periods_sync_totals($1,$2,$3)`, [abn, taxType, periodId]);

      const ledgerQ = await client.query<LedgerRow>(
        `SELECT id,transfer_uuid,amount_cents,balance_after_cents,bank_receipt_hash,hash_after
           FROM owa_ledger
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3
          ORDER BY id`,
        [abn, taxType, periodId]
      );

      const creditedCents = ledgerQ.rows
        .filter((row) => Number(row.amount_cents) > 0)
        .reduce((acc, row) => acc + Number(row.amount_cents), 0);
      const merkleRoot = computeLedgerMerkle(ledgerQ.rows);
      const runningHash = ledgerQ.rows[ledgerQ.rows.length - 1]?.hash_after ?? null;

      await client.query(
        `UPDATE periods
            SET state='CLOSING',
                merkle_root=$4,
                running_balance_hash=$5,
                thresholds=$6,
                credited_to_owa_cents=$7,
                final_liability_cents=$8
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
        [abn, taxType, periodId, merkleRoot, runningHash, thr, creditedCents, creditedCents]
      );

      return issueRPT(abn, taxType, periodId, thr, client);
    });

    return res.json(rpt);
  } catch (e: any) {
    const message = typeof e?.message === "string" ? e.message : "CLOSE_FAILED";
    const status = message === "PERIOD_NOT_FOUND" ? 404 : message === "BAD_STATE" ? 409 : 400;
    return res.status(status).json({ error: message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body || {};
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }

  try {
    const result = await withTransaction(async (client) => {
      const rptRes = await client.query(
        `SELECT payload FROM rpt_tokens
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3
          ORDER BY id DESC LIMIT 1`,
        [abn, taxType, periodId]
      );
      if (rptRes.rowCount === 0) {
        throw new Error("NO_RPT");
      }

      const payload = rptRes.rows[0].payload;
      await resolveDestination(abn, rail, payload.reference, client);

      const releaseResult = await releasePayment(
        abn,
        taxType,
        periodId,
        payload.amount_cents,
        rail,
        payload.reference,
        { client }
      );

      await client.query(
        `UPDATE periods SET state='RELEASED' WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
        [abn, taxType, periodId]
      );

      return releaseResult;
    });

    return res.json(result);
  } catch (e: any) {
    if (e instanceof ReleaseError) {
      return res.status(422).json({ error: "RELEASE_FAILED", code: e.code, detail: e.detail });
    }
    const message = typeof e?.message === "string" ? e.message : "RELEASE_FAILED";
    const status = message === "NO_RPT" ? 400 : message === "DEST_NOT_ALLOW_LISTED" ? 409 : 400;
    return res.status(status).json({ error: message });
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
