import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "../index.js";
import { sha256Hex } from "../utils/crypto.js";
import { getBankingPort, type BankingChannel } from "../banking/index.js";
import { resolveAllowListedDestination } from "../banking/destinations.js";
import { insertBankReceipt } from "../banking/receipts.js";
import { BankingValidationError } from "../banking/errors.js";

const DRY_RUN = (process.env.DRY_RUN ?? "false").toLowerCase() === "true";
const SHADOW_ONLY = (process.env.SHADOW_ONLY ?? "false").toLowerCase() === "true";

function normalizeChannel(raw: unknown): BankingChannel {
  const value = String(raw ?? "EFT").toUpperCase();
  if (value === "EFT" || value === "BECS") return "EFT";
  if (value === "BPAY") return "BPAY";
  if (value === "PAYTO" || value === "PAY_TO") return "PAYTO";
  throw new BankingValidationError("UNSUPPORTED_CHANNEL", `Unsupported channel ${value}`);
}

function ensureNegativeAmount(amount: unknown): number {
  const num = Number(amount);
  if (!Number.isFinite(num)) {
    throw new BankingValidationError("INVALID_AMOUNT", "amountCents must be numeric");
  }
  if (num >= 0) {
    throw new BankingValidationError("INVALID_AMOUNT", "amountCents must be negative for a release");
  }
  return num;
}

export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "MISSING_FIELDS", detail: "Missing abn/taxType/periodId" });
  }

  const rpt = (req as any).rpt;
  if (!rpt) {
    return res.status(403).json({ error: "RPT_NOT_VERIFIED" });
  }

  let amountCents: number;
  try {
    amountCents = ensureNegativeAmount(req.body?.amountCents ?? -100);
  } catch (e) {
    if (e instanceof BankingValidationError) {
      return res.status(400).json({ error: e.code, detail: e.message });
    }
    return res.status(400).json({ error: "INVALID_AMOUNT", detail: "Unable to parse amount" });
  }

  const channelInput = req.body?.channel ?? req.body?.rail;
  let channel: BankingChannel;
  try {
    channel = normalizeChannel(channelInput);
  } catch (err) {
    if (err instanceof BankingValidationError) {
      return res.status(400).json({ error: err.code, detail: err.message });
    }
    return res.status(400).json({ error: "UNSUPPORTED_CHANNEL" });
  }

  const reference = req.body?.reference ?? req.body?.destinationRef;
  const billerCodeOverride = req.body?.billerCode;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const destination = await resolveAllowListedDestination({
      client,
      abn,
      channel,
      reference,
      billerCodeOverride,
    });

    const transferUuid = randomUUID();
    const idempotencyKey = randomUUID();
    const absoluteAmount = Math.abs(amountCents);
    const port = getBankingPort();

    let bankingResult = { providerRef: `dryrun:${transferUuid.slice(0, 12)}`, transferUuid };
    let dryRun = DRY_RUN;
    let shadowOnly = SHADOW_ONLY && !DRY_RUN;

    if (!dryRun) {
      try {
        if (destination.channel === "EFT") {
          bankingResult = await port.eft({
            abn,
            taxType,
            periodId,
            amountCents: absoluteAmount,
            transferUuid,
            idempotencyKey,
            bsb: destination.bsb,
            accountNumber: destination.accountNumber,
            lodgementReference: req.body?.lodgementReference ?? destination.lodgementReference,
          });
        } else if (destination.channel === "BPAY") {
          bankingResult = await port.bpay({
            abn,
            taxType,
            periodId,
            amountCents: absoluteAmount,
            transferUuid,
            idempotencyKey,
            billerCode: destination.billerCode,
            crn: destination.crn,
          });
        } else {
          bankingResult = await port.payToSweep({
            abn,
            taxType,
            periodId,
            amountCents: absoluteAmount,
            transferUuid,
            idempotencyKey,
            sweepId: destination.sweepId,
          });
        }
      } catch (err: any) {
        throw err;
      }
    }

    const receipt = await insertBankReceipt({
      client,
      abn,
      taxType,
      periodId,
      channel: destination.channel,
      providerRef: bankingResult.providerRef,
      dryRun,
      shadowOnly,
    });

    if (dryRun) {
      await client.query("COMMIT");
      console.info("[payments] DRY_RUN release intent", { abn, taxType, periodId, channel: destination.channel, amountCents });
      return res.json({
        ok: true,
        channel: destination.channel,
        dry_run: true,
        receipt_id: receipt.id,
        provider_ref: receipt.providerRef,
        transfer_uuid: transferUuid,
      });
    }

    if (shadowOnly) {
      await client.query("COMMIT");
      console.info("[payments] SHADOW_ONLY release", { abn, taxType, periodId, channel: destination.channel, amountCents });
      return res.json({
        ok: true,
        channel: destination.channel,
        shadow_only: true,
        receipt_id: receipt.id,
        provider_ref: receipt.providerRef,
        transfer_uuid: bankingResult.transferUuid,
      });
    }

    const { rows: lastRows } = await client.query<{ balance_after_cents: string | number }>(
      `SELECT balance_after_cents
         FROM owa_ledger
        WHERE abn=$1 AND tax_type=$2 AND period_id=$3
        ORDER BY id DESC
        LIMIT 1`,
      [abn, taxType, periodId]
    );
    const lastBalance = lastRows.length ? Number(lastRows[0].balance_after_cents) : 0;
    const newBalance = lastBalance + amountCents;

    const releaseUuid = randomUUID();
    const bankReceiptHash = sha256Hex(receipt.providerRef);

    const { rows: inserted } = await client.query(
      `INSERT INTO owa_ledger
         (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
          bank_receipt_hash, rpt_verified, release_uuid, bank_receipt_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, TRUE, $8, $9, now())
       RETURNING id, balance_after_cents`,
      [
        abn,
        taxType,
        periodId,
        bankingResult.transferUuid,
        amountCents,
        newBalance,
        bankReceiptHash,
        releaseUuid,
        receipt.id,
      ]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      channel: destination.channel,
      ledger_id: inserted[0].id,
      transfer_uuid: bankingResult.transferUuid,
      release_uuid: releaseUuid,
      receipt_id: receipt.id,
      provider_ref: receipt.providerRef,
      balance_after_cents: inserted[0].balance_after_cents,
      rpt_ref: { rpt_id: rpt.rpt_id, kid: rpt.kid, payload_sha256: rpt.payload_sha256 },
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (err instanceof BankingValidationError) {
      return res.status(400).json({ error: err.code, detail: err.message });
    }
    const status = err?.response?.status ? 502 : 500;
    const detail = err?.message ?? String(err);
    return res.status(status).json({ error: "BANK_RELEASE_FAILED", detail });
  } finally {
    client.release();
  }
}
