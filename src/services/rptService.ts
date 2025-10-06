import crypto from "crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "../persistence/db";
import { insertRpt } from "../persistence/rptRepository";
import { ensureTransition, getPeriod } from "./periodService";
import { signRpt, RptPayload } from "../crypto/ed25519";
import { exceeds } from "../anomaly/deterministic";
import { PeriodState } from "../persistence/periodsRepository";

const secretKey = Buffer.from(process.env.RPT_ED25519_SECRET_BASE64 || "", "base64");

export interface IssueRptArgs {
  abn: string;
  taxType: "PAYGW" | "GST";
  periodId: string;
  thresholds: Record<string, number>;
}

export async function issueRpt(args: IssueRptArgs) {
  if (secretKey.length === 0) {
    throw new Error("NO_RPT_SECRET");
  }
  const period = await getPeriod(args.abn, args.taxType, args.periodId);
  if (!period) throw new Error("PERIOD_NOT_FOUND");
  if (period.state !== "CLOSING") {
    throw new Error("BAD_STATE");
  }
  const anomalyVector = period.anomaly_vector || {};
  if (exceeds(anomalyVector, args.thresholds)) {
    await ensureTransition(args.abn, args.taxType, args.periodId, "BLOCKED_ANOMALY", "anomaly", {
      anomalyVector,
    });
    throw new Error("BLOCKED_ANOMALY");
  }
  const epsilon = Math.abs(
    Number(period.final_liability_cents ?? 0) - Number(period.credited_to_owa_cents ?? 0),
  );
  if (epsilon > (args.thresholds.epsilon_cents ?? 0)) {
    await ensureTransition(
      args.abn,
      args.taxType,
      args.periodId,
      "BLOCKED_DISCREPANCY",
      "epsilon_threshold",
      { epsilon },
    );
    throw new Error("BLOCKED_DISCREPANCY");
  }

  const payload: RptPayload = {
    entity_id: period.abn,
    period_id: period.period_id,
    tax_type: period.tax_type as "PAYGW" | "GST",
    amount_cents: Number(period.final_liability_cents ?? 0),
    merkle_root: period.merkle_root,
    running_balance_hash: period.running_balance_hash,
    anomaly_vector: anomalyVector,
    thresholds: args.thresholds,
    rail_id: "EFT",
    reference: process.env.ATO_PRN || "",
    expiry_ts: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    nonce: crypto.randomUUID(),
  };

  const canonical = JSON.stringify(payload);
  const payloadSha256 = crypto.createHash("sha256").update(canonical).digest("hex");
  const signature = signRpt(payload, new Uint8Array(secretKey));

  await withTransaction(async (client: PoolClient) => {
    await insertRpt(
      {
        abn: args.abn,
        taxType: args.taxType,
        periodId: args.periodId,
        payload,
        signature,
        canonicalPayload: canonical,
        payloadSha256,
      },
      client,
    );
    await ensureTransition(args.abn, args.taxType, args.periodId, "READY_RPT", "issued", null, client);
  });

  return { payload, signature, payload_sha256: payloadSha256 };
}

export async function ensureState(abn: string, taxType: string, periodId: string, state: PeriodState) {
  await ensureTransition(abn, taxType, periodId, state, "manual", null);
}

