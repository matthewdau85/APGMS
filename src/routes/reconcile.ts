import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle, buildEvidenceDetails } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { buildMerkleRoot, sha256Hex } from "../crypto/merkle";
import { getPool } from "../db/pool";

const pool = getPool();

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2
};

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }
  const thresholds = { ...DEFAULT_THRESHOLDS, ...(req.body?.thresholds || {}) };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodRes = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) {
      throw new Error("PERIOD_NOT_FOUND");
    }
    const period = periodRes.rows[0];

    const ledgerRes = await client.query(
      "select id, amount_cents from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    );
    const ledgerEntries = ledgerRes.rows.map((row: any) => {
      const amt = Number(row.amount_cents) || 0;
      return {
        id: row.id,
        amount_cents: amt,
        direction: amt >= 0 ? "CREDIT" : "DEBIT"
      };
    });

    const creditTotal = ledgerEntries
      .filter((entry) => entry.amount_cents > 0)
      .reduce((acc, entry) => acc + entry.amount_cents, 0);
    const debitTotal = ledgerEntries
      .filter((entry) => entry.amount_cents < 0)
      .reduce((acc, entry) => acc + Math.abs(entry.amount_cents), 0);
    const runningBalanceCents = creditTotal - debitTotal;
    const expectedScheduleCents = Number(period.accrued_cents ?? 0);
    const finalLiabilityCents = expectedScheduleCents - creditTotal;
    const creditedToOwaCents = creditTotal;

    const merklePayloads = ledgerEntries.map((entry) =>
      JSON.stringify({
        id: entry.id,
        amount_cents: entry.amount_cents,
        direction: entry.direction
      })
    );
    const merkleRoot = buildMerkleRoot(merklePayloads);
    let runningBalanceHash = "";
    if (ledgerEntries.length === 0) {
      runningBalanceHash = sha256Hex("");
    } else {
      for (const entry of ledgerEntries) {
        const payload = JSON.stringify({
          id: entry.id,
          delta_cents: entry.amount_cents,
          direction: entry.direction
        });
        runningBalanceHash = sha256Hex((runningBalanceHash || "") + payload);
      }
    }

    const mergedThresholds = {
      ...(period.thresholds || {}),
      ...thresholds
    };

    const updateVals = [
      runningBalanceHash,
      finalLiabilityCents,
      creditedToOwaCents,
      merkleRoot,
      JSON.stringify(mergedThresholds),
      period.id
    ];

    try {
      await client.query(
        "update periods set state='CLOSING', hash_head=$1, running_balance_hash=$1, final_liability_cents=$2, credited_to_owa_cents=$3, merkle_root=$4, thresholds=$5::jsonb where id=$6",
        updateVals
      );
    } catch (err: any) {
      if (err?.message && /column \"hash_head\"/i.test(err.message)) {
        await client.query(
          "update periods set state='CLOSING', running_balance_hash=$1, final_liability_cents=$2, credited_to_owa_cents=$3, merkle_root=$4, thresholds=$5::jsonb where id=$6",
          updateVals
        );
      } else {
        throw err;
      }
    }

    const evidenceLabels = {
      total_entries: ledgerEntries.length,
      credited_to_owa_cents: creditedToOwaCents,
      debit_total_cents: debitTotal,
      running_balance_cents: runningBalanceCents,
      expected_schedule_cents: expectedScheduleCents,
      final_liability_cents: finalLiabilityCents
    };

    const expectedCents = finalLiabilityCents;
    const actualCents = runningBalanceCents;
    const deltaCents = actualCents - expectedCents;
    const toleranceBps = Math.round((thresholds.delta_vs_baseline ?? 0) * 10000);

    const details = buildEvidenceDetails(
      evidenceLabels,
      expectedCents,
      actualCents,
      runningBalanceHash,
      merkleRoot
    );

    await client.query(
      `insert into evidence_bundles(abn,tax_type,period_id,delta_cents,tolerance_bps,details)
       values ($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (abn,tax_type,period_id) do update set
         delta_cents=excluded.delta_cents,
         tolerance_bps=excluded.tolerance_bps,
         details=excluded.details`,
      [abn, taxType, periodId, deltaCents, toleranceBps, JSON.stringify(details)]
    );

    const rpt = await issueRPT(client, {
      abn,
      taxType,
      periodId,
      head: runningBalanceHash,
      ratesVersion: process.env.RATES_VERSION || "prototype",
      thresholds: mergedThresholds
    });

    await client.query("COMMIT");
    return res.json(rpt);
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // ignore rollback errors so the original failure is surfaced
    }
    const status = e?.message === "PERIOD_NOT_FOUND" ? 404 : 400;
    return res.status(status).json({ error: e?.message || String(e) });
  } finally {
    client.release();
  }
}

export async function payAto(req: any, res: any) {
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
  // TODO: For each row, post GST and NET into your ledgers, maintain txn_id reversal map
  return res.json({ ingested: rows.length });
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
