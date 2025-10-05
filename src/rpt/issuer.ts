import { Pool, PoolClient, QueryResult } from "pg";
import crypto from "crypto";
import { merkleRootHex } from "../crypto/merkle";
import { getActiveKid, signJWS } from "./kms";
import { RptPayloadV01 } from "./types";
import { deriveAnomalyScore, deriveTotals } from "./utils";

const pool = new Pool();

function ensureRptEnabled() {
  if (process.env.PROTO_ENABLE_RPT !== "true") {
    throw new Error("RPT_DISABLED");
  }
}

type Queryable = Pick<Pool, "query"> | PoolClient;

async function computeEvidenceRoot(client: Queryable, abn: string, taxType: string, periodId: string, fallback: string | null): Promise<string> {
  const { rows }: QueryResult<{ hash_after: string | null }> = await client.query(
    "select hash_after from owa_ledger where abn = $1 and tax_type = $2 and period_id = $3 order by id",
    [abn, taxType, periodId]
  );
  if (rows.length === 0) {
    return fallback ?? "";
  }
  const leaves = rows.map(r => String(r.hash_after ?? ""));
  return merkleRootHex(leaves);
}

export interface IssueRptResult {
  rpt_id: string;
  jws: string;
  payload: RptPayloadV01;
}

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>
): Promise<IssueRptResult> {
  ensureRptEnabled();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const periodRes = await client.query(
      "select * from periods where abn = $1 and tax_type = $2 and period_id = $3 for update",
      [abn, taxType, periodId]
    );
    if (periodRes.rowCount === 0) {
      throw new Error("PERIOD_NOT_FOUND");
    }
    const period = periodRes.rows[0];
    if (period.state !== "CLOSING" && period.state !== "READY_RPT") {
      throw new Error("BAD_STATE");
    }

    const kid = await getActiveKid();
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ttlSeconds = Number(process.env.RPT_TTL_SECONDS ?? 900);
    const rptId = crypto.randomUUID();
    const nonce = crypto.randomUUID();
    const evidenceRoot = await computeEvidenceRoot(client, abn, taxType, periodId, period.merkle_root);
    const finalLiability = Number(period.final_liability_cents || 0);
    const payload: RptPayloadV01 = {
      rpt_id: rptId,
      abn,
      bas_period: periodId,
      totals: deriveTotals(taxType, finalLiability),
      evidence_merkle_root: evidenceRoot,
      rates_version: process.env.RPT_RATES_VERSION || "baseline",
      anomaly_score: deriveAnomalyScore(period.anomaly_vector),
      iat: nowSeconds,
      exp: nowSeconds + ttlSeconds,
      nonce,
      kid,
    };

    const jws = await signJWS(payload, kid);

    await client.query(
      `insert into rpt_tokens (abn, tax_type, period_id, payload, signature, status, rpt_id, kid, nonce, jws, expires_at)
       values ($1, $2, $3, $4, $5, 'ISSUED', $6, $7, $8, $9, to_timestamp($10))
       on conflict (rpt_id) do update set payload = excluded.payload, signature = excluded.signature,
         status = excluded.status, kid = excluded.kid, nonce = excluded.nonce, jws = excluded.jws, expires_at = excluded.expires_at`,
      [
        abn,
        taxType,
        periodId,
        payload,
        jws.split(".")[2] || "",
        rptId,
        kid,
        nonce,
        jws,
        payload.exp,
      ]
    );

    await client.query(
      "update periods set state = 'READY_RPT', thresholds = $2 where id = $1",
      [period.id, thresholds]
    );

    await client.query("COMMIT");
    return { rpt_id: rptId, jws, payload };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
