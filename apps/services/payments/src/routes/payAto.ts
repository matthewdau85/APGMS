// apps/services/payments/src/routes/payAto.ts
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "../index.js";
import { createRealBankingPort } from "../adapters/real/index.js";
import type { BankingPort, BpayDestination, EftDestination, PaymentDestination } from "../adapters/bankingPort.js";
import { ensureBpayAllowlisted, ensureEftAllowlisted } from "../adapters/real/allowlistValidators.js";
import { appendAuditLog } from "../utils/auditLog.js";

const bankingPort: BankingPort = createRealBankingPort();
const DEFAULT_BPAY_BILLER = process.env.BPAY_BILLER_CODE || "75556";

type DestinationInput = {
  rail?: string;
  bsb?: string;
  accountBsb?: string;
  accountNumber?: string;
  account_number?: string;
  account_bsb?: string;
  accountName?: string;
  account_name?: string;
  billerCode?: string;
  biller_code?: string;
  crn?: string;
  reference?: string;
};

function normaliseRail(value: string | undefined): "EFT" | "BPAY" | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  return upper === "EFT" || upper === "BPAY" ? (upper as "EFT" | "BPAY") : undefined;
}

function normaliseBsb(value: string): string {
  const cleaned = value.replace(/[^0-9]/g, "");
  if (cleaned.length === 6) {
    return cleaned;
  }
  return value;
}

async function resolveDestination(
  client: PoolClient,
  abn: string,
  input: DestinationInput | undefined
): Promise<PaymentDestination> {
  const requestedRail = normaliseRail(input?.rail);
  if (
    requestedRail === "EFT" &&
    (input?.bsb || input?.accountBsb || input?.account_bsb) &&
    (input?.accountNumber || input?.account_number)
  ) {
    const bsb = normaliseBsb(input?.bsb ?? input?.accountBsb ?? input?.account_bsb ?? "");
    const accountNumber = input?.accountNumber ?? input?.account_number ?? "";
    const accountName = input?.accountName ?? input?.account_name;
    return { rail: "EFT", bsb, accountNumber, accountName } satisfies EftDestination;
  }
  if (requestedRail === "BPAY" && (input?.crn || input?.reference)) {
    const crn = (input?.crn ?? input?.reference ?? "").replace(/\s+/g, "");
    const billerCode = input?.billerCode ?? input?.biller_code ?? DEFAULT_BPAY_BILLER;
    return { rail: "BPAY", crn, billerCode } satisfies BpayDestination;
  }

  const { rows } = await client.query<{
    rail: string;
    reference: string;
    account_bsb: string | null;
    account_number: string | null;
  }>(
    `SELECT rail, reference, account_bsb, account_number
       FROM remittance_destinations
      WHERE abn=$1`,
    [abn]
  );

  const preferBpay = rows.find(row => row.rail.toUpperCase() === "BPAY");
  if (preferBpay) {
    return {
      rail: "BPAY",
      crn: (preferBpay.reference || "").replace(/\s+/g, ""),
      billerCode: DEFAULT_BPAY_BILLER,
    } satisfies BpayDestination;
  }

  const preferEft = rows.find(row => row.rail.toUpperCase() === "EFT");
  if (preferEft && preferEft.account_bsb && preferEft.account_number) {
    return {
      rail: "EFT",
      bsb: normaliseBsb(preferEft.account_bsb),
      accountNumber: preferEft.account_number,
    } satisfies EftDestination;
  }

  throw new Error("DEST_NOT_ALLOWLISTED");
}

function requireRpt(req: Request) {
  const rpt = (req as any).rpt;
  if (!rpt) {
    throw Object.assign(new Error("RPT not verified"), { statusCode: 403 });
  }
  return rpt;
}

export async function payAtoRelease(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId, amountCents, destination: destinationInput } = req.body || {};
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const amount = Number(amountCents ?? 0);
    if (!Number.isFinite(amount) || amount >= 0) {
      return res.status(400).json({ error: "amountCents must be negative for a release" });
    }

    const rpt = requireRpt(req);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const destination = await resolveDestination(client, abn, destinationInput);
      const releaseUuid = randomUUID();
      const idempotencyKey = releaseUuid;
      const metadata = { abn, taxType, periodId, release_uuid: releaseUuid };

      let transferUuid: string;
      let bankReceiptId: string;

      if (destination.rail === "EFT") {
        await ensureEftAllowlisted(client, abn, destination.bsb, destination.accountNumber);
        const receipt = await bankingPort.sendEft({
          abn,
          taxType,
          periodId,
          amountCents: Math.abs(amount),
          idempotencyKey,
          metadata,
          destination,
        });
        transferUuid = receipt.transferUuid;
        bankReceiptId = receipt.bankReceiptId;
      } else {
        await ensureBpayAllowlisted(client, abn, destination.billerCode, destination.crn);
        const receipt = await bankingPort.sendBpay({
          abn,
          taxType,
          periodId,
          amountCents: Math.abs(amount),
          idempotencyKey,
          metadata,
          destination,
        });
        transferUuid = receipt.transferUuid;
        bankReceiptId = receipt.bankReceiptId;
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
      const newBalance = lastBalance + amount;

      const insert = `
        INSERT INTO owa_ledger
          (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
           rpt_verified, release_uuid, bank_receipt_id, created_at)
        VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7,$8, now())
        RETURNING id, balance_after_cents
      `;
      const { rows: inserted } = await client.query(insert, [
        abn,
        taxType,
        periodId,
        transferUuid,
        amount,
        newBalance,
        releaseUuid,
        bankReceiptId,
      ]);

      await appendAuditLog(client, "payments-egress", {
        abn,
        taxType,
        periodId,
        amount_cents: amount,
        release_uuid: releaseUuid,
        transfer_uuid: transferUuid,
        bank_receipt_id: bankReceiptId,
        destination: destination.rail === "EFT"
          ? { rail: "EFT", bsb: destination.bsb, accountNumber: destination.accountNumber }
          : { rail: "BPAY", billerCode: destination.billerCode, crn: destination.crn },
      });

      await client.query("COMMIT");

      return res.json({
        ok: true,
        ledger_id: inserted[0].id,
        transfer_uuid: transferUuid,
        release_uuid: releaseUuid,
        bank_receipt_id: bankReceiptId,
        balance_after_cents: inserted[0].balance_after_cents,
        rpt_ref: {
          rpt_id: rpt.rpt_id,
          nonce: rpt.nonce,
          payload_sha256: rpt.payload_sha256,
        },
      });
    } catch (error: any) {
      await client.query("ROLLBACK");
      const status = error?.statusCode ?? (String(error?.message || "").startsWith("DEST_") ? 400 : 502);
      return res.status(status).json({ error: "Release failed", detail: String(error?.message || error) });
    } finally {
      client.release();
    }
  } catch (outer: any) {
    const status = outer?.statusCode ?? 500;
    return res.status(status).json({ error: outer?.message || "Release failed" });
  }
}
