import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool } from "pg";
import { merkleRootHex } from "../crypto/merkle";
const pool = new Pool();

export async function closeAndIssue(req:any, res:any) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }

  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const period = await client.query(
      "SELECT * FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3 FOR UPDATE",
      [abn, taxType, periodId]
    );
    if (period.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    }

    const { rows: ledgerRows } = await client.query(
      `SELECT id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id`,
      [abn, taxType, periodId]
    );

    const agg = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END),0)::bigint AS credited,
         COALESCE(SUM(amount_cents),0)::bigint AS net
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    const credited = Number(agg.rows[0]?.credited ?? 0);

    const merkleRoot = merkleRootHex(
      ledgerRows.map((row) =>
        JSON.stringify({
          id: row.id,
          receipt: row.bank_receipt_hash ?? "",
          amount_cents: String(row.amount_cents),
          balance_after_cents: String(row.balance_after_cents ?? 0)
        })
      )
    );
    const runningHash = ledgerRows.length > 0 ? (ledgerRows[ledgerRows.length - 1].hash_after ?? "") : "";

    await client.query(
      `UPDATE periods
          SET state='CLOSING',
              credited_to_owa_cents=$4,
              accrued_cents=$4,
              final_liability_cents=$4,
              merkle_root=$5,
              running_balance_hash=$6,
              thresholds=$7
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId, credited, merkleRoot, runningHash, JSON.stringify(thr)]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }

  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req:any, res:any) {
  const { abn, taxType, periodId, rail } = req.body || {};
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId/rail" });
  }
  const pr = await pool.query(
    "SELECT * FROM rpt_tokens WHERE abn=$1 AND tax_type=$2 AND period_id=$3 ORDER BY id DESC LIMIT 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({error:"NO_RPT"});
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    const latestHash = await pool.query(
      `SELECT hash_after FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC LIMIT 1`,
      [abn, taxType, periodId]
    );
    await pool.query(
      "UPDATE periods SET state='RELEASED', running_balance_hash=$4 WHERE abn=$1 AND tax_type=$2 AND period_id=$3",
      [abn, taxType, periodId, latestHash.rows[0]?.hash_after ?? ""]
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
  const { abn, taxType, periodId, csv } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }
  const csvText = csv || "";
  const rows = parseSettlementCSV(csvText);
  if (rows.length === 0) {
    return res.json({ ingested: 0 });
  }

  const client = await pool.connect();
  let ingested = 0;
  try {
    await client.query("BEGIN");
    await client.query(`CREATE TABLE IF NOT EXISTS settlement_txn_map (
      abn text NOT NULL,
      tax_type text NOT NULL,
      period_id text NOT NULL,
      txn_id text NOT NULL,
      gst_cents bigint NOT NULL,
      net_cents bigint NOT NULL,
      settlement_ts timestamptz NOT NULL,
      PRIMARY KEY (abn,tax_type,period_id,txn_id)
    )`);

    for (const row of rows) {
      const existing = await client.query(
        `SELECT gst_cents, net_cents FROM settlement_txn_map
          WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND txn_id=$4 FOR UPDATE`,
        [abn, taxType, periodId, row.txn_id]
      );
      const prevGst = Number(existing.rows[0]?.gst_cents ?? 0);
      const prevNet = Number(existing.rows[0]?.net_cents ?? 0);
      const deltaGst = Number(row.gst_cents ?? 0) - prevGst;
      const deltaNet = Number(row.net_cents ?? 0) - prevNet;

      if (existing.rowCount === 0) {
        await client.query(
          `INSERT INTO settlement_txn_map(abn,tax_type,period_id,txn_id,gst_cents,net_cents,settlement_ts)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [abn, taxType, periodId, row.txn_id, Number(row.gst_cents ?? 0), Number(row.net_cents ?? 0), row.settlement_ts]
        );
      } else if (deltaGst !== 0 || deltaNet !== 0) {
        await client.query(
          `UPDATE settlement_txn_map
              SET gst_cents=$5, net_cents=$6, settlement_ts=$7
            WHERE abn=$1 AND tax_type=$2 AND period_id=$3 AND txn_id=$4`,
          [abn, taxType, periodId, row.txn_id, Number(row.gst_cents ?? 0), Number(row.net_cents ?? 0), row.settlement_ts]
        );
      }

      const receiptBase = `${row.txn_id}:${row.settlement_ts}`;
      if (deltaGst !== 0) {
        await client.query(
          "SELECT * FROM owa_append($1,$2,$3,$4,$5)",
          [abn, taxType, periodId, deltaGst, `settle:gst:${receiptBase}`]
        );
      }
      if (deltaNet !== 0) {
        await client.query(
          "SELECT * FROM owa_append($1,$2,$3,$4,$5)",
          [abn, taxType, periodId, -deltaNet, `settle:net:${receiptBase}`]
        );
      }

      if (deltaGst !== 0 || deltaNet !== 0) {
        ingested += 1;
      }
    }

    const totals = await client.query(
      `SELECT
         COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END),0)::bigint AS credited
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );

    await client.query(
      `UPDATE periods
          SET credited_to_owa_cents=$4,
              accrued_cents=$4
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId, Number(totals.rows[0]?.credited ?? 0)]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "SETTLEMENT_INGEST_FAILED", detail: String(e instanceof Error ? e.message : e) });
  } finally {
    client.release();
  }

  return res.json({ ingested });
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
