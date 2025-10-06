import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { merkleRootHex, sha256Hex } from "../crypto/merkle";
import { getPool } from "../db/pool";

export async function closeAndIssue(req:any, res:any) {
  const { abn, taxType, periodId, thresholds } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }
  const thr = thresholds || { epsilon_cents: 50, variance_ratio: 0.25, dup_rate: 0.01, gap_minutes: 60, delta_vs_baseline: 0.2 };

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodLookup = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
      [abn, taxType, periodId]
    );
    if (periodLookup.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    }

    await client.query("select periods_sync_totals($1,$2,$3)", [abn, taxType, periodId]);
    const refreshed = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
      [abn, taxType, periodId]
    );
    const period = refreshed.rows[0];

    const { rows: ledgerRows } = await client.query(
      "select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    );

    const leaves = ledgerRows.map((row:any) => [row.id, row.amount_cents, row.balance_after_cents, row.bank_receipt_hash || ""].join(":"));
    const merkleRoot = merkleRootHex(leaves);

    let prevHash = "";
    for (const row of ledgerRows) {
      const receipt = row.bank_receipt_hash || "";
      const bal = Number(row.balance_after_cents ?? 0);
      const computedHash = sha256Hex(prevHash + receipt + String(bal));
      if (row.prev_hash !== prevHash || row.hash_after !== computedHash) {
        await client.query(
          "update owa_ledger set prev_hash=$1, hash_after=$2 where id=$3",
          [prevHash, computedHash, row.id]
        );
      }
      prevHash = computedHash;
    }
    const runningHash = ledgerRows.length > 0 ? prevHash : sha256Hex("");

    const finalLiability = Number(period?.credited_to_owa_cents ?? 0);
    await client.query(
      "update periods set state='CLOSING', final_liability_cents=$1, merkle_root=$2, running_balance_hash=$3, thresholds=$4 where id=$5",
      [finalLiability, merkleRoot, runningHash, thr, period.id]
    );
    await client.query("COMMIT");
  } catch (err:any) {
    await client.query("ROLLBACK");
    client.release();
    return res.status(400).json({ error: err.message || "CLOSE_FAILED" });
  }
  client.release();

  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e:any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req:any, res:any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pool = getPool();
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

const ensureSettlementTables = `
  create table if not exists settlement_ledger (
    id bigserial primary key,
    abn text not null,
    tax_type text not null,
    period_id text not null,
    ledger_type text not null check (ledger_type in ('GST','NET')),
    txn_id text not null,
    amount_cents bigint not null,
    settlement_ts timestamptz not null,
    reversal_of bigint,
    reversed_by bigint,
    created_at timestamptz default now()
  );
  create index if not exists settlement_ledger_idx on settlement_ledger(abn, tax_type, period_id, ledger_type, txn_id);
  create table if not exists settlement_reversals (
    txn_id text not null,
    abn text not null,
    tax_type text not null,
    period_id text not null,
    ledger_type text not null check (ledger_type in ('GST','NET')),
    original_entry_id bigint not null,
    reversal_entry_id bigint not null,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    primary key (txn_id, abn, tax_type, period_id, ledger_type)
  );
`;

type LedgerType = "GST" | "NET";

export async function settlementWebhook(req:any, res:any) {
  const { abn, taxType, periodId } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }

  const csvText = req.body?.csv || "";
  let rows;
  try {
    rows = parseSettlementCSV(csvText);
  } catch (err:any) {
    return res.status(400).json({ error: "BAD_CSV", detail: err.message });
  }

  const pool = getPool();
  const client = await pool.connect();
  let reversalPairs = 0;
  let ledgerRows = 0;
  try {
    await client.query("BEGIN");
    await client.query(ensureSettlementTables);

    const appendLedger = async (ledgerType: LedgerType, txnId: string, amount: number, ts: string) => {
      if (!Number.isFinite(amount) || amount === 0) return;
      const existing = await client.query(
        "select id, reversed_by from settlement_ledger where abn=$1 and tax_type=$2 and period_id=$3 and ledger_type=$4 and txn_id=$5 order by id",
        [abn, taxType, periodId, ledgerType, txnId]
      );
      const openOriginal = existing.rows.find((r:any) => r.reversed_by == null);
      const reversalOf = openOriginal ? openOriginal.id : null;
      const inserted = await client.query(
        "insert into settlement_ledger(abn,tax_type,period_id,ledger_type,txn_id,amount_cents,settlement_ts,reversal_of) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
        [abn, taxType, periodId, ledgerType, txnId, amount, ts, reversalOf]
      );
      ledgerRows += 1;
      const entryId = inserted.rows[0].id;
      if (reversalOf) {
        reversalPairs += 1;
        await client.query("update settlement_ledger set reversed_by=$1 where id=$2", [entryId, reversalOf]);
        await client.query(
          "insert into settlement_reversals(txn_id,abn,tax_type,period_id,ledger_type,original_entry_id,reversal_entry_id,created_at,updated_at) values ($1,$2,$3,$4,$5,$6,$7,now(),now()) on conflict (txn_id,abn,tax_type,period_id,ledger_type) do update set original_entry_id=excluded.original_entry_id, reversal_entry_id=excluded.reversal_entry_id, updated_at=now()",
          [txnId, abn, taxType, periodId, ledgerType, reversalOf, entryId]
        );
      }
    };

    for (const row of rows) {
      await appendLedger("GST", row.txn_id, Number(row.gst_cents ?? 0), row.settlement_ts);
      await appendLedger("NET", row.txn_id, Number(row.net_cents ?? 0), row.settlement_ts);
    }

    await client.query("COMMIT");
  } catch (err:any) {
    await client.query("ROLLBACK");
    client.release();
    return res.status(500).json({ error: "SETTLEMENT_FAILED", detail: err.message });
  }
  client.release();
  return res.json({ ingested: rows.length, ledger_rows: ledgerRows, reversals: reversalPairs });
}

export async function evidence(req:any, res:any) {
  const { abn, taxType, periodId } = req.query as any;
  res.json(await buildEvidenceBundle(abn, taxType, periodId));
}
