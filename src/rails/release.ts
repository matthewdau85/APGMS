import { Pool } from "pg";
import { resolveDestination, releasePayment } from "./adapter";

const pool = new Pool();

export interface RailReleasePayload {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  rail: "EFT" | "BPAY";
  reference: string;
}

export async function performRailRelease(payload: RailReleasePayload) {
  const { abn, taxType, periodId, amount_cents, rail, reference } = payload;
  if (!reference) {
    throw new Error("MISSING_REFERENCE");
  }
  const amount = Number(amount_cents);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }
  await resolveDestination(abn, rail, reference);
  const result = await releasePayment(abn, taxType, periodId, amount, rail, reference);
  await pool.query(
    "update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3",
    [abn, taxType, periodId]
  );
  return result;
}
