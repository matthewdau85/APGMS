import crypto from "crypto";
import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { Pool, PoolClient } from "pg";
import { computeAnomalyVector, evaluateAnomaly, ReconLedgerEntry } from "../anomaly/deterministic";
import { nextState, PeriodState } from "../recon/stateMachine";

const pool = new Pool();

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 100,
  variance_ratio: 0.25,
  dup_rate: 0.05,
  gap_minutes: 60,
  delta_vs_baseline: 0.1,
};

const parsedTtl = Number(process.env.RPT_TTL_SECONDS);
const RPT_TTL_SECONDS = Number.isFinite(parsedTtl) ? parsedTtl : 900;
const RATES_VERSION = process.env.RPT_RATES_VERSION || "2025-10";
const ATO_PRN = process.env.ATO_PRN || "ATO-PRN";

type Thresholds = typeof DEFAULT_THRESHOLDS;

interface LedgerRow {
  id: number;
  amount_cents: number;
  balance_after_cents: number;
  bank_receipt_hash: string | null;
  hash_after: string | null;
  created_at: string | null;
}

interface LedgerSummary {
  credited_cents: number;
  debited_cents: number;
  net_cents: number;
  final_liability_cents: number;
  running_balance_cents: number;
  running_balance_hash: string | null;
  merkle_root: string | null;
}

function coerceNumber(value: any): number {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  if (typeof value === "bigint") return Number(value);
  return 0;
}

function mapLedgerRow(row: any): LedgerRow {
  return {
    id: row.id,
    amount_cents: coerceNumber(row.amount_cents),
    balance_after_cents: coerceNumber(row.balance_after_cents),
    bank_receipt_hash: row.bank_receipt_hash ?? null,
    hash_after: row.hash_after ?? null,
    created_at: row.created_at ?? null,
  };
}

function computeMerkleRoot(rows: LedgerRow[]): string | null {
  if (!rows.length) return null;
  const leafData = rows.map((row) => [
    row.id,
    row.amount_cents,
    row.balance_after_cents,
    row.bank_receipt_hash ?? "",
    row.hash_after ?? "",
  ]);
  return crypto.createHash("sha256").update(JSON.stringify(leafData)).digest("hex");
}

function summariseLedger(rows: LedgerRow[]): LedgerSummary {
  let credited = 0;
  let debited = 0;
  rows.forEach((row) => {
    if (row.amount_cents >= 0) {
      credited += row.amount_cents;
    } else {
      debited += Math.abs(row.amount_cents);
    }
  });
  const net = credited - debited;
  const last = rows[rows.length - 1] ?? null;
  return {
    credited_cents: credited,
    debited_cents: debited,
    net_cents: net,
    final_liability_cents: Math.max(net, 0),
    running_balance_cents: last ? last.balance_after_cents : 0,
    running_balance_hash: last ? last.hash_after : null,
    merkle_root: computeMerkleRoot(rows),
  };
}

function mergeThresholds(periodThresholds: any, overrides: any): Thresholds {
  const merged = {
    ...DEFAULT_THRESHOLDS,
    ...(periodThresholds ?? {}),
    ...(overrides ?? {}),
  } as Record<string, number>;
  return {
    epsilon_cents: Number(merged.epsilon_cents ?? DEFAULT_THRESHOLDS.epsilon_cents),
    variance_ratio: Number(merged.variance_ratio ?? DEFAULT_THRESHOLDS.variance_ratio),
    dup_rate: Number(merged.dup_rate ?? DEFAULT_THRESHOLDS.dup_rate),
    gap_minutes: Number(merged.gap_minutes ?? DEFAULT_THRESHOLDS.gap_minutes),
    delta_vs_baseline: Number(merged.delta_vs_baseline ?? DEFAULT_THRESHOLDS.delta_vs_baseline),
  };
}

async function withTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeAndIssue(req: any, res: any) {
  const { abn, taxType, periodId, thresholds: overrides } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }

  try {
    const result = await withTransaction(async (client) => {
      const periodRes = await client.query(
        `select * from periods where abn=$1 and tax_type=$2 and period_id=$3 for update`,
        [abn, taxType, periodId]
      );
      if (periodRes.rowCount === 0) {
        throw new Error("PERIOD_NOT_FOUND");
      }
      const period = periodRes.rows[0];
      const currentState = period.state as PeriodState;
      const closingState = nextState(currentState, "CLOSE");

      const ledgerRes = await client.query(
        `select id, amount_cents, balance_after_cents, bank_receipt_hash, hash_after, created_at
           from owa_ledger
          where abn=$1 and tax_type=$2 and period_id=$3
          order by id`,
        [abn, taxType, periodId]
      );
      const ledgerRows = ledgerRes.rows.map(mapLedgerRow);
      const summary = summariseLedger(ledgerRows);

      const baseline = coerceNumber(period.accrued_cents);
      const reconEntries: ReconLedgerEntry[] = ledgerRows.map((row) => ({
        amount_cents: row.amount_cents,
        bank_receipt_hash: row.bank_receipt_hash,
        created_at: row.created_at,
      }));
      const anomalyVector = computeAnomalyVector(
        reconEntries,
        { credited_cents: summary.credited_cents, net_cents: summary.net_cents },
        baseline
      );
      const periodThresholds =
        typeof period.thresholds === "string"
          ? JSON.parse(period.thresholds)
          : period.thresholds;
      const thresholds = mergeThresholds(periodThresholds, overrides);

      await client.query(
        `update periods
            set credited_to_owa_cents=$1,
                final_liability_cents=$2,
                running_balance_hash=$3,
                merkle_root=$4,
                anomaly_vector=$5::jsonb,
                thresholds=$6::jsonb,
                state=$7
          where id=$8`,
        [
          summary.credited_cents,
          summary.final_liability_cents,
          summary.running_balance_hash,
          summary.merkle_root,
          JSON.stringify(anomalyVector),
          JSON.stringify(thresholds),
          closingState,
          period.id,
        ]
      );

      const epsilon = Math.abs(summary.final_liability_cents - summary.running_balance_cents);
      if (epsilon > thresholds.epsilon_cents) {
        const failState = nextState(closingState, "FAIL_DISCREPANCY");
        await client.query(`update periods set state=$1 where id=$2`, [failState, period.id]);
        return {
          state: failState,
          reason_code: "DISCREPANCY_EPSILON",
          epsilon_cents: epsilon,
          anomaly_vector: anomalyVector,
          thresholds,
          totals: summary,
        };
      }

      const anomaly = evaluateAnomaly(anomalyVector, thresholds);
      if (anomaly.breach) {
        const failState = nextState(closingState, "FAIL_ANOMALY");
        await client.query(`update periods set state=$1 where id=$2`, [failState, period.id]);
        return {
          state: failState,
          reason_code: `ANOMALY_${anomaly.code}`,
          epsilon_cents: epsilon,
          anomaly_vector: anomalyVector,
          thresholds,
          totals: summary,
        };
      }

      const readyState = nextState(closingState, "PASS");
      const payload = {
        abn,
        tax_type: taxType,
        period_id: periodId,
        totals: {
          credited_to_owa_cents: summary.credited_cents,
          net_cents: summary.net_cents,
          final_liability_cents: summary.final_liability_cents,
          accrued_cents: baseline,
        },
        rates_version: RATES_VERSION,
        nonce: crypto.randomUUID(),
        exp: new Date(Date.now() + RPT_TTL_SECONDS * 1000).toISOString(),
      };

      const rpt = await issueRPT(abn, taxType, periodId, payload, client);
      await client.query(`update periods set state=$1 where id=$2`, [readyState, period.id]);

      return {
        state: readyState,
        rpt,
        epsilon_cents: epsilon,
        anomaly_vector: anomalyVector,
        thresholds,
        totals: summary,
      };
    });

    if (result.state === "BLOCKED_DISCREPANCY" || result.state === "BLOCKED_ANOMALY") {
      return res.status(409).json(result);
    }

    return res.json(result);
  } catch (err: any) {
    console.error(err);
    const message = err?.message || "INTERNAL_ERROR";
    const status = message === "PERIOD_NOT_FOUND" ? 404 : 400;
    return res.status(status).json({ error: message });
  }
}

export async function payAto(req: any, res: any) {
  const { abn, taxType, periodId, rail } = req.body;
  if (!abn || !taxType || !periodId || !rail) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }

  const tokenRes = await pool.query(
    `select payload, signature from rpt_tokens
      where abn=$1 and tax_type=$2 and period_id=$3
      order by id desc limit 1`,
    [abn, taxType, periodId]
  );
  if (tokenRes.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const rawPayload = tokenRes.rows[0].payload;
  const payload = typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload || {};
  const totals = payload?.totals || {};
  const amount = Number(totals.final_liability_cents ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "INVALID_RPT_TOTAL" });
  }

  const reference = ATO_PRN;
  try {
    await resolveDestination(abn, rail, reference);
    const release = await releasePayment(abn, taxType, periodId, amount, rail, reference);
    await pool.query(
      `update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3`,
      [abn, taxType, periodId]
    );
    return res.json(release);
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
  return res.json({ ingested: rows.length });
}

export async function evidence(req: any, res: any) {
  const { abn, taxType, periodId } = req.query as any;
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_PARAMS" });
  }
  try {
    const bundle = await buildEvidenceBundle(abn, taxType, periodId);
    if (!bundle.period) {
      return res.status(404).json({ error: "NOT_FOUND" });
    }
    res.json(bundle);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
}
