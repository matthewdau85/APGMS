import { Router } from "express";
import crypto from "crypto";
import type { PoolClient } from "pg";
import { getPool } from "../db/pool";
import { nextState } from "../recon/stateMachine";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceDetails, type BasLabel, type EvidenceDetails } from "../evidence/bundle";

const PG_UNDEFINED_TABLE = "42P01";
const router = Router();
let evidenceStoreEnsured = false;

type MachineState = "OPEN" | "RECONCILING" | "CLOSED_OK" | "CLOSED_FAIL";

function isMachineState(value: unknown): value is MachineState {
  return value === "OPEN" || value === "RECONCILING" || value === "CLOSED_OK" || value === "CLOSED_FAIL";
}

function isUndefinedTable(err: unknown): boolean {
  return Boolean((err as { code?: string })?.code === PG_UNDEFINED_TABLE);
}

async function ensureEvidenceStore(client: PoolClient) {
  if (evidenceStoreEnsured) return;
  await client.query(`
    create table if not exists recon_evidence (
      abn text not null,
      period_id text not null,
      anomaly_hash text not null,
      details jsonb not null,
      created_at timestamptz default now(),
      updated_at timestamptz default now(),
      primary key (abn, period_id)
    )
  `);
  evidenceStoreEnsured = true;
}

async function markReconFailure(abn: string, internalId: number | null, periodKey: string | null) {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let row;
    if (internalId != null) {
      row = await client.query("select id, state from periods where id=$1 for update", [internalId]);
    } else if (periodKey) {
      row = await client.query(
        "select id, state from periods where abn=$1 and period_id=$2 for update",
        [abn, periodKey]
      );
    }
    if (!row || row.rowCount === 0) {
      await client.query("ROLLBACK");
      return;
    }
    const period = row.rows[0];
    let state = period.state as MachineState | string;
    if (!isMachineState(state)) {
      await client.query("ROLLBACK");
      return;
    }
    if (state === "OPEN") {
      state = nextState(state, "BEGIN_RECON");
      await client.query("update periods set state=$1 where id=$2", [state, period.id]);
    }
    if (state === "RECONCILING") {
      const failed = nextState(state, "RECON_FAIL");
      await client.query("update periods set state=$1 where id=$2", [failed, period.id]);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("failed to mark recon failure", err);
  } finally {
    client.release();
  }
}

async function fetchBasLabels(client: PoolClient, abn: string, periodId: string): Promise<BasLabel[]> {
  try {
    const res = await client.query(
      "select label, value_cents from bas_labels where abn=$1 and period_id=$2 order by label",
      [abn, periodId]
    );
    return res.rows.map((row) => ({ label: row.label, valueCents: Number(row.value_cents ?? 0) }));
  } catch (err) {
    if (isUndefinedTable(err)) return [];
    throw err;
  }
}

async function fetchSettlement(
  client: PoolClient,
  abn: string,
  periodId: string
): Promise<EvidenceDetails["settlement"] | undefined> {
  try {
    const res = await client.query(
      "select settlement_ref, paid_at, amount_cents, channel from settlements where abn=$1 and period_id=$2 order by paid_at desc limit 1",
      [abn, periodId]
    );
    if (res.rowCount === 0) return undefined;
    const row = res.rows[0];
    const paidAtValue = row.paid_at ? new Date(row.paid_at).toISOString() : new Date().toISOString();
    return {
      settlementRef: row.settlement_ref,
      paidAt: paidAtValue,
      amountCents: Number(row.amount_cents ?? 0),
      channel: row.channel ?? undefined,
    };
  } catch (err) {
    if (isUndefinedTable(err)) return undefined;
    throw err;
  }
}

async function fetchAnomalyVector(client: PoolClient, abn: string, periodId: string) {
  try {
    const res = await client.query(
      "select metric, value from recon_anomalies where abn=$1 and period_id=$2",
      [abn, periodId]
    );
    const out: Record<string, number> = {};
    for (const row of res.rows) {
      out[row.metric] = Number(row.value ?? 0);
    }
    return out;
  } catch (err) {
    if (isUndefinedTable(err)) return {};
    throw err;
  }
}

async function sumExpected(client: PoolClient, abn: string, periodId: string): Promise<number> {
  try {
    const res = await client.query(
      "select coalesce(sum(expected_cents),0) as cents from recon_inputs where abn=$1 and period_id=$2",
      [abn, periodId]
    );
    return Number(res.rows[0]?.cents ?? 0);
  } catch (err) {
    if (isUndefinedTable(err)) return 0;
    throw err;
  }
}

async function sumActual(client: PoolClient, abn: string, periodId: string): Promise<number> {
  try {
    const res = await client.query(
      "select coalesce(sum(actual_cents),0) as cents from recon_results where abn=$1 and period_id=$2",
      [abn, periodId]
    );
    return Number(res.rows[0]?.cents ?? 0);
  } catch (err) {
    if (!isUndefinedTable(err)) throw err;
  }
  const fallback = await client.query(
    "select coalesce(sum(amount_cents),0) as cents from owa_ledger where abn=$1 and period_id=$2",
    [abn, periodId]
  );
  return Number(fallback.rows[0]?.cents ?? 0);
}

async function fetchLedgerHead(client: PoolClient, abn: string, periodId: string): Promise<string | null> {
  try {
    const res = await client.query(
      "select hash_after from owa_ledger where abn=$1 and period_id=$2 order by id desc limit 1",
      [abn, periodId]
    );
    return res.rows[0]?.hash_after ?? null;
  } catch (err) {
    if (isUndefinedTable(err)) return null;
    throw err;
  }
}

router.post("/close-and-issue", async (req, res) => {
  const body = req.body ?? {};
  const abn = typeof body.abn === "string" && body.abn.trim().length > 0 ? body.abn.trim() : null;
  const periodParam = body.period_id;
  if (!abn || (!periodParam && periodParam !== 0)) {
    return res.status(400).json({ error: "abn, period_id required" });
  }
  const periodKey = String(periodParam);

  const pool = getPool();
  const client = await pool.connect();
  let canonicalPeriodId = periodKey;
  let internalId: number | null = null;
  let taxType: string | undefined;
  let periodLoaded = false;
  try {
    await client.query("BEGIN");
    const periodRes = await client.query(
      "select * from periods where abn=$1 and (period_id=$2 or id::text=$2) for update",
      [abn, periodKey]
    );
    if (periodRes.rowCount === 0) {
      throw new Error("period not found");
    }
    const period = periodRes.rows[0];
    internalId = typeof period.id === "number" ? period.id : period.id ? Number(period.id) : null;
    canonicalPeriodId = period.period_id ?? periodKey;
    taxType = period.tax_type ?? undefined;
    periodLoaded = true;

    const stateRaw = period.state;
    if (!isMachineState(stateRaw)) {
      throw new Error(`unsupported state ${stateRaw}`);
    }

    let state = stateRaw;
    if (state === "OPEN") {
      state = nextState(state, "BEGIN_RECON");
      await client.query("update periods set state=$1 where id=$2", [state, period.id]);
    } else if (state !== "RECONCILING") {
      throw new Error(`invalid state transition from ${state}`);
    }

    const expectedCentsRaw = await sumExpected(client, abn, canonicalPeriodId);
    const expectedCents = expectedCentsRaw || Number(period.final_liability_cents ?? 0);
    const actualCentsRaw = await sumActual(client, abn, canonicalPeriodId);
    const actualCents = actualCentsRaw || Number(period.credited_to_owa_cents ?? 0);
    const deltaCents = actualCents - expectedCents;

    const basLabels = await fetchBasLabels(client, abn, canonicalPeriodId);
    const settlement = await fetchSettlement(client, abn, canonicalPeriodId);
    const anomalyVector = await fetchAnomalyVector(client, abn, canonicalPeriodId);
    const anomalyHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ anomalyVector, deltaCents, expectedCents, actualCents }))
      .digest("hex");

    const ledgerHead = (await fetchLedgerHead(client, abn, canonicalPeriodId)) ?? anomalyHash;
    const toleranceBps = Number(period.policy_threshold_bps ?? period.tolerance_bps ?? 0);

    const rpt = await issueRPT(client, {
      abn,
      periodId: canonicalPeriodId,
      head: ledgerHead,
      deltaCents,
      expectedCents,
      toleranceBps,
    });

    await ensureEvidenceStore(client);
    const evidence = buildEvidenceDetails(basLabels, expectedCents, actualCents, anomalyHash, settlement);
    await client.query(
      `insert into recon_evidence (abn, period_id, anomaly_hash, details, updated_at)
       values ($1,$2,$3,$4::jsonb,now())
       on conflict (abn, period_id)
       do update set anomaly_hash=excluded.anomaly_hash, details=excluded.details, updated_at=now()`,
      [abn, canonicalPeriodId, anomalyHash, JSON.stringify(evidence)]
    );

    const closed = nextState(state, "RECON_OK");
    const updateTarget = internalId ?? period.id;
    await client.query(
      "update periods set state=$1, final_liability_cents=$2, credited_to_owa_cents=$3 where id=$4",
      [closed, expectedCents, actualCents, updateTarget]
    );

    await client.query("COMMIT");
    res.json({ token: rpt.token, state: closed, anomalyHash, deltaCents, expectedCents, actualCents, taxType, evidence });
  } catch (err) {
    await client.query("ROLLBACK");
    if (periodLoaded) {
      await markReconFailure(abn, internalId, canonicalPeriodId);
    }
    res.status(400).json({ error: (err as Error).message });
  } finally {
    client.release();
  }
});

export { router };
