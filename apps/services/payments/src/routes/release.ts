import { Request, Response } from "express";
import { randomUUID } from "crypto";
import { pool } from "../index.js";
import { submitRelease } from "../../../../src/rails/adapters/eft.js";
import { validateEft, validateAbn } from "../../../../src/rails/validators.js";
import { assertAllowlisted } from "../../../../src/rails/allowlist.js";
import { recordSettlement } from "../../../../src/settlement/store.js";

const FEATURE_ENABLED = String(process.env.FEATURE_BANKING || "").toLowerCase() === "true";

export async function release(req: Request, res: Response) {
  if (!FEATURE_ENABLED) {
    return res.status(404).json({ error: "FEATURE_DISABLED" });
  }

  const { abn: rawAbn, taxType, periodId, amountCents, destination } = req.body || {};
  if (!rawAbn || !taxType || !periodId || !destination) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const rail = (process.env.RAIL || "EFT").toUpperCase();
  if (rail !== "EFT") {
    return res.status(400).json({ error: "UNSUPPORTED_RAIL" });
  }

  const amt = Math.abs(Number(amountCents));
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: "INVALID_AMOUNT" });
  }

  const rpt = (req as any).rpt;
  if (!rpt) {
    return res.status(403).json({ error: "RPT_NOT_VERIFIED" });
  }

  const client = await pool.connect();
  let began = false;
  try {
    const abn = validateAbn(rawAbn);

    const { rows: periodRows } = await client.query(
      `SELECT id FROM periods WHERE abn=$1 AND tax_type=$2 AND period_id=$3`,
      [abn, taxType, periodId]
    );
    const period = periodRows[0];
    if (!period) {
      return res.status(404).json({ error: "PERIOD_NOT_FOUND" });
    }

    const cleanDest = validateEft(destination);
    assertAllowlisted(abn, "EFT", cleanDest);

    const idempotencyKey = (req.headers["idempotency-key"] as string) || randomUUID();
    const releaseUuid = randomUUID();
    const provider = await submitRelease(
      {
        abn,
        taxType,
        periodId,
        amountCents: amt,
        destination: cleanDest,
        metadata: { release_uuid: releaseUuid },
      },
      idempotencyKey
    );

    await client.query("BEGIN");
    began = true;

    const { rows: lastRows } = await client.query<{ balance_after_cents: string | number }>(
      `SELECT balance_after_cents
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC
       LIMIT 1`,
      [abn, taxType, periodId]
    );
    const lastBal = lastRows.length ? Number(lastRows[0].balance_after_cents) : 0;
    const newBal = lastBal - amt;
    const transfer_uuid = randomUUID();

    await client.query(
      `INSERT INTO owa_ledger
         (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
          rpt_verified, release_uuid, created_at)
       VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, now())`,
      [abn, taxType, periodId, transfer_uuid, -amt, newBal, releaseUuid]
    );

    await client.query("COMMIT");

    const settlement = await recordSettlement({
      periodId: period.id,
      rail,
      providerRef: provider.provider_ref,
      amountCents: amt,
      submittedAt: provider.submittedAt,
      statementRef: cleanDest.statementRef,
    });

    return res.json({
      ok: true,
      settlement_id: settlement.id,
      provider_ref: provider.provider_ref,
      evidence_id: settlement.evidence_id,
      submitted_at: settlement.submitted_at,
    });
  } catch (err: any) {
    if (began) {
      await client.query("ROLLBACK");
    }
    console.error("release_failed", err);
    return res.status(400).json({ error: "RELEASE_FAILED", detail: String(err?.message || err) });
  } finally {
    client.release();
  }
}
