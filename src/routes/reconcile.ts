import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { merkleRootHex, sha256Hex } from "../crypto/merkle";
import { nextState, PeriodState } from "../recon/stateMachine";
import { Pool } from "pg";
const pool = new Pool();

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(String(body?.error ?? status));
    this.status = status;
    this.body = body;
  }
}

function normalizeThresholds(input: any): Record<string, number> {
  const thr = { ...DEFAULT_THRESHOLDS } as Record<string, number>;
  if (input && typeof input === "object") {
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        thr[key] = value;
      }
    }
  }
  return thr;
}

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId } = req.body;
  const thresholds = normalizeThresholds(req.body?.thresholds);

  const client = await pool.connect();
  let creditedToOwa = 0;
  let merkleRoot: string | null = null;
  let runningBalanceHash: string | null = null;
  try {
    await client.query("BEGIN");
    const periodRes = await client.query(
      "select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update",
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) {
      throw new HttpError(404, { error: "PERIOD_NOT_FOUND" });
    }
    const period = periodRes.rows[0];
    const currentState = period.state as PeriodState;

    let closingState: PeriodState = currentState;
    if (currentState !== "CLOSING") {
      const candidate = nextState(currentState, "CLOSE");
      if (candidate === currentState) {
        throw new HttpError(409, { error: "BAD_STATE", state: currentState });
      }
      closingState = candidate;
    }

    const ledgerRes = await client.query(
      "select id, amount_cents, balance_after_cents, bank_receipt_hash, prev_hash, hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id",
      [abn, taxType, periodId]
    );

    let prevHash = "";
    const leaves: string[] = [];
    const ledgerUpdates: Array<{ id: number; prev_hash: string; hash_after: string }> = [];
    for (const row of ledgerRes.rows) {
      const amount = Number(row.amount_cents || 0);
      const balanceAfter = Number(row.balance_after_cents || 0);
      const receipt = row.bank_receipt_hash || "";
      const expectedHash = sha256Hex(prevHash + receipt + String(balanceAfter));
      if ((row.prev_hash ?? "") !== prevHash || (row.hash_after ?? "") !== expectedHash) {
        ledgerUpdates.push({ id: Number(row.id), prev_hash: prevHash, hash_after: expectedHash });
      }
      if (amount > 0) creditedToOwa += amount;
      leaves.push(
        JSON.stringify({
          id: Number(row.id),
          amount_cents: amount,
          balance_after_cents: balanceAfter,
          bank_receipt_hash: receipt,
          hash_after: expectedHash,
        })
      );
      prevHash = expectedHash;
    }

    for (const upd of ledgerUpdates) {
      await client.query(
        "update owa_ledger set prev_hash=$1, hash_after=$2 where id=$3",
        [upd.prev_hash, upd.hash_after, upd.id]
      );
    }

    merkleRoot = leaves.length > 0 ? merkleRootHex(leaves) : null;
    runningBalanceHash = prevHash || null;

    await client.query(
      "update periods set state=$1, credited_to_owa_cents=$2, final_liability_cents=$3, merkle_root=$4, running_balance_hash=$5, thresholds=$6 where id=$7",
      [
        closingState,
        creditedToOwa,
        creditedToOwa,
        merkleRoot,
        runningBalanceHash,
        thresholds,
        period.id,
      ]
    );
    await client.query("COMMIT");
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
    if (err instanceof HttpError) {
      return res.status(err.status).json(err.body);
    }
    return res.status(500).json({ error: err?.message || "CLOSE_FAILED" });
  }
  client.release();

  try {
    const rpt = await issueRPT(abn, taxType, periodId, thresholds);
    return res.json({
      state: "READY_RPT",
      rpt,
      period: {
        credited_to_owa_cents: creditedToOwa,
        final_liability_cents: creditedToOwa,
        merkle_root: merkleRoot,
        running_balance_hash: runningBalanceHash,
        thresholds,
      },
    });
  } catch (e: any) {
    const message = e?.message || "ISSUE_FAILED";
    const status = message.startsWith("BLOCKED") || message === "BAD_STATE" ? 409 : 400;
    return res.status(status).json({ error: message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body; // EFT|BPAY
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });

  const periodRes = await pool.query(
    "select id, state from periods where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  if (periodRes.rowCount === 0) {
    return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
  }
  const period = periodRes.rows[0];
  const next = nextState(period.state as PeriodState, "RELEASE");
  if (next === period.state) {
    return res.status(409).json({ error: "BAD_STATE", state: period.state });
  }

  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const release = await releasePayment(
      abn,
      taxType,
      periodId,
      payload.amount_cents,
      rail,
      payload.reference
    );
    const tail = await pool.query(
      "select hash_after from owa_ledger where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
      [abn, taxType, periodId]
    );
    const runningHash = tail.rows[0]?.hash_after ?? null;
    await pool.query("update periods set state=$1, running_balance_hash=$2 where id=$3", [next, runningHash, period.id]);
    return res.json({ ...release, state: next, running_balance_hash: runningHash });
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
