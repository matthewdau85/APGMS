import type { Request, Response } from "express";
import { buildEvidenceBundle } from "../evidence/bundle";
import { pool } from "../db/pool";
import { getTaxTotals } from "../tax/totals";
import { issueRptToken } from "../rpt/issuer";
import { merkleRootHex } from "../crypto/merkle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import type { PoolClient } from "pg";

interface CloseAndIssueParams {
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
}

interface LedgerProofs {
  credited: number;
  merkleRoot: string;
  runningBalanceHash: string;
}

type Queryable = Pick<PoolClient, "query">;

async function computeLedgerProofs(
  client: Queryable,
  abn: string,
  taxType: string,
  periodId: string
): Promise<LedgerProofs> {
  const { rows } = await client.query(
    `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after
       FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id ASC`,
    [abn, taxType, periodId]
  );

  const credited = rows.reduce((acc: number, row: any) => {
    const value = Number(row.amount_cents ?? 0);
    return value > 0 ? acc + value : acc;
  }, 0);

  const leaves = rows.map((row: any) =>
    JSON.stringify({
      id: row.id,
      amount_cents: Number(row.amount_cents ?? 0),
      balance_after_cents: Number(row.balance_after_cents ?? 0),
      bank_receipt_hash: row.bank_receipt_hash ?? "",
      hash_after: row.hash_after ?? "",
    })
  );

  const merkleRoot = merkleRootHex(leaves);
  const runningBalanceHash = rows.length ? rows[rows.length - 1].hash_after ?? "" : "";

  return { credited, merkleRoot, runningBalanceHash };
}

function parseFinalLiability(totals: Record<string, unknown>): number {
  const candidates = [
    totals?.["final_liability_cents" as keyof typeof totals],
    totals?.["net_liability_cents" as keyof typeof totals],
    totals?.["amount_cents" as keyof typeof totals],
  ];
  for (const candidate of candidates) {
    const n = Number(candidate);
    if (Number.isFinite(n)) {
      return Math.trunc(n);
    }
  }
  throw new Error("INVALID_TOTALS");
}

export async function closeAndIssueFlow(params: CloseAndIssueParams) {
  const { abn, taxType, periodId } = params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const totalsRecord = await getTaxTotals(abn, taxType, periodId, client);
    const finalLiability = parseFinalLiability(totalsRecord.totals);

    const periodRes = await client.query(
      `SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE`,
      [abn, taxType, periodId]
    );

    let period = periodRes.rows[0];
    if (!period) {
      const insert = await client.query(
        `INSERT INTO periods (abn,tax_type,period_id,state)
         VALUES ($1,$2,$3,'OPEN') RETURNING *`,
        [abn, taxType, periodId]
      );
      period = insert.rows[0];
    }

    if (!["OPEN", "CLOSING", "READY_RPT"].includes(period.state)) {
      throw new Error("PERIOD_LOCKED");
    }

    const proofs = await computeLedgerProofs(client, abn, taxType, periodId);

    await client.query(
      `UPDATE periods
          SET state='CLOSING',
              credited_to_owa_cents=$4,
              final_liability_cents=$5,
              merkle_root=$6,
              running_balance_hash=$7,
              rates_version=$8
        WHERE id=$9`,
      [abn, taxType, periodId, proofs.credited, finalLiability, proofs.merkleRoot, proofs.runningBalanceHash, totalsRecord.rates_version, period.id]
    );

    const rpt = await issueRptToken({
      client,
      abn,
      taxType,
      periodId,
      totals: totalsRecord.totals,
      ratesVersion: totalsRecord.rates_version,
    });

    await client.query(`UPDATE periods SET state='READY_RPT' WHERE id=$1`, [period.id]);
    await client.query("COMMIT");

    return {
      payload: rpt.payload,
      signature: rpt.signature,
      payload_sha256: rpt.payloadSha256,
      totals: totalsRecord.totals,
      rates_version: totalsRecord.rates_version,
      merkle_root: proofs.merkleRoot,
      running_balance_hash: proofs.runningBalanceHash,
      rpt_id: rpt.rptId,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeAndIssue(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId } = (req.body ?? {}) as Partial<CloseAndIssueParams>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    const result = await closeAndIssueFlow({ abn, taxType, periodId } as CloseAndIssueParams);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message || "CLOSE_AND_ISSUE_FAILED" });
  }
}

export async function payAto(req: Request, res: Response) {
  const { abn, taxType, periodId, rail } = req.body || {};
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId/rail" });
  }
  const token = await pool.query(
    `SELECT payload FROM rpt_tokens
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
      ORDER BY id DESC LIMIT 1`,
    [abn, taxType, periodId]
  );
  if (token.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload: any = token.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload?.reference ?? "");
    const amount = Number(payload?.totals?.final_liability_cents ?? 0);
    const result = await releasePayment(abn, taxType, periodId, amount, rail, payload?.reference ?? "");
    await pool.query(`UPDATE periods SET state='RELEASED' WHERE abn=$1 AND tax_type=$2 AND period_id=$3`, [abn, taxType, periodId]);
    return res.json(result);
  } catch (e: any) {
    return res.status(400).json({ error: e.message || "PAYMENT_FAILED" });
  }
}

export async function paytoSweep(req: Request, res: Response) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = req.body?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as Record<string, string>;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
