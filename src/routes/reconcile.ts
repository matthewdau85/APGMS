import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool, PoolClient } from "pg";

const pool = new Pool();

async function ensureSettlementTables(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS settlement_splits (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      txn_id TEXT NOT NULL,
      gst_cents BIGINT NOT NULL,
      net_cents BIGINT NOT NULL,
      settlement_ts TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (abn, tax_type, period_id, txn_id)
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS settlements (
      id BIGSERIAL PRIMARY KEY,
      abn TEXT NOT NULL,
      tax_type TEXT NOT NULL,
      period_id TEXT NOT NULL,
      reference TEXT NOT NULL,
      amount_cents BIGINT NOT NULL,
      channel TEXT NOT NULL,
      paid_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (abn, tax_type, period_id, reference)
    )
  `);
}

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
  try {
    const { abn, taxType, periodId, reference, channel, paidAt, amountCents } = req.body || {};
    const csvText = req.body?.csv || "";
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    if (!reference || !channel) {
      return res.status(400).json({ error: "Missing settlement reference/channel" });
    }
    const rows = parseSettlementCSV(csvText);
    if (!rows.length) {
      return res.status(400).json({ error: "No settlement rows provided" });
    }

    const totalGst = rows.reduce((sum:number, r:any) => sum + Number(r.gst_cents || 0), 0);
    const totalNet = rows.reduce((sum:number, r:any) => sum + Number(r.net_cents || 0), 0);
    const settlementAmount = Number.isFinite(Number(amountCents)) ? Number(amountCents) : totalGst;

    const paidAtCandidate = paidAt ? new Date(paidAt) : (rows[rows.length - 1]?.settlement_ts ? new Date(rows[rows.length - 1].settlement_ts) : new Date());
    if (Number.isNaN(paidAtCandidate.getTime())) {
      return res.status(400).json({ error: "Invalid paidAt timestamp" });
    }
    const paidAtIso = paidAtCandidate.toISOString();

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await ensureSettlementTables(client);

      const splitSql = `
        INSERT INTO settlement_splits (abn,tax_type,period_id,txn_id,gst_cents,net_cents,settlement_ts,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,now())
        ON CONFLICT (abn,tax_type,period_id,txn_id)
        DO UPDATE SET gst_cents=EXCLUDED.gst_cents, net_cents=EXCLUDED.net_cents,
                      settlement_ts=EXCLUDED.settlement_ts, updated_at=now()
      `;
      for (const row of rows) {
        const ts = row.settlement_ts ? new Date(row.settlement_ts) : null;
        const tsVal = ts && !Number.isNaN(ts.getTime()) ? ts : null;
        await client.query(splitSql, [
          abn,
          taxType,
          periodId,
          row.txn_id,
          Number(row.gst_cents || 0),
          Number(row.net_cents || 0),
          tsVal,
        ]);
      }

      await client.query(
        `INSERT INTO settlements (abn,tax_type,period_id,reference,amount_cents,channel,paid_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now())
         ON CONFLICT (abn,tax_type,period_id,reference)
         DO UPDATE SET amount_cents=EXCLUDED.amount_cents,
                       channel=EXCLUDED.channel,
                       paid_at=EXCLUDED.paid_at,
                       updated_at=now()`,
        [abn, taxType, periodId, reference, settlementAmount, channel, paidAtIso]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    return res.json({
      ok: true,
      ingested: rows.length,
      totals: {
        gst_cents: totalGst,
        net_cents: totalNet,
      },
      settlement: {
        reference,
        channel,
        amount_cents: settlementAmount,
        paid_at: paidAtIso,
      },
      bundle,
    });
  } catch (e:any) {
    return res.status(500).json({ error: "settlement ingest failed", detail: String(e?.message || e) });
  }
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}

export async function auditEvidence(req:any, res:any) {
  try {
    const { abn, taxType, periodId } = req.query as any;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    return res.json({ bundle });
  } catch (e:any) {
    return res.status(500).json({ error: "audit evidence failed", detail: String(e?.message || e) });
  }
}
