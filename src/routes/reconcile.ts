import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool, PoolClient } from "pg";

const pool = new Pool();

async function ensureSettlementMapTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS settlement_txn_map (
      txn_id text PRIMARY KEY,
      abn text NOT NULL,
      tax_type text NOT NULL,
      period_id text NOT NULL,
      settlement_ts timestamptz,
      gst_ledger_id bigint,
      net_ledger_id bigint,
      reversal_gst_ledger_id bigint,
      reversal_net_ledger_id bigint,
      created_at timestamptz DEFAULT now(),
      reversed_at timestamptz,
      reversal_reason text
    )
  `);
}

async function appendLedger(
  client: PoolClient,
  abn: string,
  taxType: string,
  periodId: string,
  amount: number,
  receipt: string
) {
  const sql = `SELECT id, balance_after, hash_after FROM owa_append($1,$2,$3,$4,$5)`;
  const { rows } = await client.query(sql, [abn, taxType, periodId, amount, receipt]);
  return rows[0] ?? null;
}

function normalizeReceipt(prefix: string, txnId: string) {
  return `${prefix}:${txnId}`;
}

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query("select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1", [abn, taxType, periodId]);
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
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
  const abn = req.body?.abn;
  const taxType = req.body?.taxType || "GST";
  const periodId = req.body?.periodId;

  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_IDENTIFIERS" });
  }

  const rows = parseSettlementCSV(csvText);
  if (!rows.length) {
    return res.json({ ingested: 0, summary: { inserted: 0, reversed: 0, skipped: 0 } });
  }

  await ensureSettlementMapTable();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const summary = { inserted: 0, reversed: 0, skipped: 0 };

    for (const row of rows) {
      const txnId = row.txn_id;
      if (!txnId) {
        summary.skipped += 1;
        continue;
      }
      const isReversal = row.gst_cents < 0 || row.net_cents < 0;
      const existing = await client.query("SELECT * FROM settlement_txn_map WHERE txn_id=$1", [txnId]);

      if (!existing.rowCount && isReversal) {
        summary.skipped += 1;
        continue;
      }

      if (!existing.rowCount) {
        const gstReceipt = normalizeReceipt("settlement:gst", txnId);
        const netReceipt = normalizeReceipt("settlement:net", txnId);

        const gstLedger = row.gst_cents ? await appendLedger(client, abn, taxType, periodId, row.gst_cents, gstReceipt) : null;
        const netLedger = row.net_cents ? await appendLedger(client, abn, "NET", periodId, row.net_cents, netReceipt) : null;

        await client.query(
          `INSERT INTO settlement_txn_map (txn_id, abn, tax_type, period_id, settlement_ts, gst_ledger_id, net_ledger_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (txn_id) DO NOTHING`,
          [
            txnId,
            abn,
            taxType,
            periodId,
            row.settlement_ts ? new Date(row.settlement_ts) : null,
            gstLedger?.id ?? null,
            netLedger?.id ?? null,
          ]
        );
        await client.query("SELECT periods_sync_totals($1,$2,$3)", [abn, taxType, periodId]);
        summary.inserted += 1;
      } else {
        const record = existing.rows[0];
        if (!isReversal) {
          summary.skipped += 1;
          continue;
        }
        const gstReceipt = normalizeReceipt("settlement:gst:reversal", txnId);
        const netReceipt = normalizeReceipt("settlement:net:reversal", txnId);
        const gstLedger = row.gst_cents ? await appendLedger(client, abn, taxType, periodId, row.gst_cents, gstReceipt) : null;
        const netLedger = row.net_cents ? await appendLedger(client, abn, "NET", periodId, row.net_cents, netReceipt) : null;

        await client.query(
          `UPDATE settlement_txn_map
             SET reversal_gst_ledger_id = COALESCE($2, reversal_gst_ledger_id),
                 reversal_net_ledger_id = COALESCE($3, reversal_net_ledger_id),
                 reversed_at = now(),
                 reversal_reason = $4
           WHERE txn_id=$1`,
          [
            record.txn_id,
            gstLedger?.id ?? null,
            netLedger?.id ?? null,
            "reversal",
          ]
        );
        await client.query("SELECT periods_sync_totals($1,$2,$3)", [abn, taxType, periodId]);
        summary.reversed += 1;
      }
    }

    await client.query("COMMIT");
    return res.json({ ingested: rows.length, summary });
  } catch (err: any) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: "SETTLEMENT_INGEST_FAILED", detail: err?.message || String(err) });
  } finally {
    client.release();
  }
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
