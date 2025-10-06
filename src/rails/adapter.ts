import { pool } from "../db/pool";
import { enqueueRelease, ReleaseRail, QueueSaturatedError, DeadLetterError } from "../queues/releaseQueue";

/** Allow-list enforcement and PRN/CRN lookup */
export async function resolveDestination(abn: string, rail: ReleaseRail, reference: string) {
  const { rows } = await pool.query(
    "select * from remittance_destinations where abn= and rail= and reference=",
    [abn, rail, reference]
  );
  if (rows.length === 0) throw new Error("DEST_NOT_ALLOW_LISTED");
  return rows[0];
}

export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: ReleaseRail,
  reference: string
) {
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("INVALID_AMOUNT");
  }
  try {
    const result = await enqueueRelease({
      abn,
      taxType,
      periodId,
      amountCents,
      rail,
      reference,
    });
    return result;
  } catch (err) {
    if (err instanceof QueueSaturatedError) {
      throw err;
    }
    if (err instanceof DeadLetterError) {
      throw err;
    }
    const error = err instanceof Error ? err : new Error(String(err));
    (error as any).code = (err as any)?.code;
    throw error;
  }
}
