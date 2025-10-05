import { Request, Response } from "express";
import { pool } from "../index.js";
import { releasePayment, type ReleaseResult } from "../../../../../src/rails/adapter.js";
import { sendEftOrBpay } from "../bank/eftBpayAdapter.js";
import { debitMandate } from "../bank/paytoAdapter.js";

function normalizeRail(raw: string | undefined): "EFT" | "BPAY" | "PayTo" {
  const upper = (raw || "EFT").toUpperCase();
  if (upper === "BPAY") return "BPAY";
  if (upper === "PAYTO" || upper === "PAYID") return "PayTo";
  return "EFT";
}

export async function payAtoRelease(req: Request, res: Response) {
  const { abn, taxType, periodId, amountCents } = req.body || {};
  if (!abn || !taxType || !periodId) {
    return res.status(400).json({ error: "Missing abn/taxType/periodId" });
  }

  const amt = Number(amountCents);
  if (!Number.isFinite(amt)) {
    return res.status(400).json({ error: "amountCents must be numeric" });
  }
  if (amt >= 0) {
    return res.status(400).json({ error: "amountCents must be negative for a release" });
  }

  const rpt = (req as any).rpt;
  if (!rpt || !rpt.rpt_id) {
    return res.status(403).json({ error: "RPT not verified" });
  }

  try {
    const rptRow = await pool.query<{ payload_c14n: string }>(
      "SELECT payload_c14n FROM rpt_tokens WHERE id=$1",
      [rpt.rpt_id]
    );
    if (!rptRow.rowCount) {
      return res.status(403).json({ error: "RPT payload unavailable" });
    }
    const payload = JSON.parse(rptRow.rows[0].payload_c14n || "{}") as Record<string, any>;
    const payloadRail = normalizeRail(String(payload.rail_id ?? payload.rail ?? "EFT"));
    const reference = String(payload.reference ?? "");
    const rptAmount = Number(payload.amount_cents ?? 0);
    const debitAmount = Math.abs(amt);

    if (!reference) {
      return res.status(400).json({ error: "RPT reference missing" });
    }
    if (!Number.isFinite(rptAmount) || rptAmount <= 0) {
      return res.status(400).json({ error: "RPT amount invalid" });
    }
    if (rptAmount !== debitAmount) {
      return res.status(409).json({ error: "Requested amount does not match RPT" });
    }

    const idempotencyKey = `payato:${abn}:${taxType}:${periodId}`;

    const result: ReleaseResult = await releasePayment(
      abn,
      taxType,
      periodId,
      debitAmount,
      payloadRail,
      reference,
      {
        idempotencyKey,
        callRail: async ({ rail, traceId, destination }) => {
          if (rail === "EFT") {
            const dest = {
              bsb: destination.account_bsb ?? "",
              acct: destination.account_number ?? "",
            };
            const bank = await sendEftOrBpay({
              abn,
              taxType,
              periodId,
              amount_cents: debitAmount,
              destination: dest,
              idempotencyKey,
              traceId,
            });
            return bank;
          }
          if (rail === "BPAY") {
            const dest = {
              bpay_biller: destination.reference,
              crn: reference,
            };
            const bank = await sendEftOrBpay({
              abn,
              taxType,
              periodId,
              amount_cents: debitAmount,
              destination: dest,
              idempotencyKey,
              traceId,
            });
            return bank;
          }
          const mandateId =
            destination.metadata?.payto?.mandate_id ||
            destination.metadata?.mandate_id ||
            destination.reference;
          if (!mandateId) {
            throw new Error("PAYTO_MANDATE_UNKNOWN");
          }
          const payto = await debitMandate(mandateId, debitAmount, { traceId, abn, taxType, periodId, reference });
          if (payto.status !== "OK") {
            throw new Error(`PAYTO_${payto.status}`);
          }
          return {
            providerReceiptId: payto.bank_ref ?? `payto-${traceId.slice(0, 12)}`,
          };
        },
      }
    );

    return res.json({ ok: result.status === "OK", ...result });
  } catch (err: any) {
    const message = String(err?.message || err);
    if (message === "DEST_NOT_ALLOW_LISTED") {
      return res.status(403).json({ error: "Destination not allowlisted" });
    }
    if (message === "INSUFFICIENT_FUNDS") {
      return res.status(409).json({ error: message });
    }
    if (message === "RELEASE_IN_PROGRESS") {
      return res.status(409).json({ error: message });
    }
    if (message.startsWith("PAYTO_")) {
      const code = message.slice("PAYTO_".length);
      const status = code === "INSUFFICIENT_FUNDS" ? 409 : code === "BANK_ERROR" ? 502 : 400;
      return res.status(status).json({ error: message });
    }
    return res.status(400).json({ error: "Release failed", detail: message });
  }
}
