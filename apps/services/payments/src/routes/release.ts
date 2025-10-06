import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { selectBankingPort, isSimPort, getSimRail } from "../adapters/bank/index.js";
import { verifyJwt } from "../release/jwt.js";
import {
  ValidationError,
  validateABNAllowlist,
  validateAcct,
  validateBSB,
  validateCRN,
} from "../release/validators.js";
import {
  Approval,
  getReleaseByIdem,
  recordReleaseSuccess,
} from "../release/store.js";

function respondError(res: Response, status: number, err: ValidationError) {
  return res.status(status).json(err);
}

type ReleaseBody = {
  abn: string;
  taxType: string;
  periodId: string;
  amount_cents: number;
  rail: "EFT" | "BPAY";
  destination?: Record<string, string>;
};

function extractApprovals(claims: Record<string, any>): Approval[] {
  const approvals = Array.isArray(claims?.approvals) ? claims.approvals : null;
  if (approvals && approvals.every((a) => a?.by && a?.role && a?.at)) {
    return approvals;
  }
  const fallbackBy = claims?.sub ?? "unknown";
  const now = new Date().toISOString();
  return [{ by: fallbackBy, role: "initiator", at: now }];
}

export async function release(req: Request, res: Response) {
  const requestId = (req.header("x-request-id") ?? randomUUID()).toString();
  try {
    const authHeader = req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return respondError(res, 401, {
        code: "AUTH_REQUIRED",
        title: "Authorization required",
        detail: "Missing bearer token",
        requestId,
      });
    }

    const secret = process.env.RELEASE_JWT_SECRET ?? "sandbox-secret";
    let claims: Record<string, any>;
    try {
      claims = verifyJwt(authHeader.slice(7), secret);
    } catch (err: any) {
      return respondError(res, 401, {
        code: "INVALID_JWT",
        title: "JWT validation failed",
        detail: String(err?.message ?? err ?? "Invalid token"),
        requestId,
      });
    }

    if ((process.env.APP_MODE ?? "sandbox") === "real") {
      if (!claims?.mfa) {
        return respondError(res, 403, {
          code: "MFA_REQUIRED",
          title: "MFA required",
          detail: "APP_MODE=real requires an MFA assertion",
          requestId,
        });
      }
      if (!Array.isArray(claims?.approvals) || claims.approvals.length < 2) {
        return respondError(res, 403, {
          code: "DUAL_APPROVAL_REQUIRED",
          title: "Dual approval required",
          detail: "APP_MODE=real requires two approvals",
          requestId,
        });
      }
    }

    const body = req.body as ReleaseBody;
    if (!body?.abn || !body?.taxType || !body?.periodId) {
      return respondError(res, 400, {
        code: "MISSING_FIELDS",
        title: "Missing identifiers",
        detail: "abn, taxType and periodId are required",
        requestId,
      });
    }
    if (typeof body.amount_cents !== "number" || body.amount_cents <= 0) {
      return respondError(res, 400, {
        code: "INVALID_AMOUNT",
        title: "Amount invalid",
        detail: "amount_cents must be a positive integer",
        requestId,
      });
    }
    if (body.rail !== "EFT" && body.rail !== "BPAY") {
      return respondError(res, 400, {
        code: "INVALID_RAIL",
        title: "Unsupported rail",
        detail: "rail must be EFT or BPAY",
        requestId,
      });
    }

    const destination = body.destination ?? {};
    const allowErr = validateABNAllowlist(body.abn, body.rail, destination, requestId);
    if (allowErr) return respondError(res, 403, allowErr);
    if (body.rail === "EFT") {
      const bsbErr = validateBSB(destination.bsb, requestId);
      if (bsbErr) return respondError(res, 400, bsbErr);
      const acctErr = validateAcct(destination.account, requestId);
      if (acctErr) return respondError(res, 400, acctErr);
    }
    if (body.rail === "BPAY") {
      const crnErr = validateCRN(destination.crn, requestId);
      if (crnErr) return respondError(res, 400, crnErr);
    }

    const rawIdem = req.header("idempotency-key") ?? randomUUID();
    const compositeIdem = `${body.rail}:${rawIdem}`;
    const existing = getReleaseByIdem(compositeIdem);
    if (existing) {
      return res.json({ provider_ref: existing.provider_ref, paid_at: existing.paid_at });
    }

    const banking = selectBankingPort();
    const approvals = extractApprovals(claims);
    const reference = destination.reference ?? `Release ${body.periodId}`;

    let bankResult;
    try {
      if (body.rail === "EFT") {
        bankResult = await banking.eft({
          amount_cents: body.amount_cents,
          bsb: destination.bsb!,
          account: destination.account!,
          reference,
          idempotencyKey: rawIdem,
        });
      } else {
        bankResult = await banking.bpay({
          amount_cents: body.amount_cents,
          biller_code: destination.bpay_biller ?? "75556",
          crn: destination.crn!,
          reference,
          idempotencyKey: rawIdem,
        });
      }
    } catch (err: any) {
      return respondError(res, 502, {
        code: "BANK_ERROR",
        title: "Banking provider error",
        detail: String(err?.message ?? err ?? "Bank call failed"),
        requestId,
      });
    }

    const record = recordReleaseSuccess({
      abn: body.abn,
      taxType: body.taxType,
      periodId: body.periodId,
      amount_cents: body.amount_cents,
      rail: body.rail,
      destination,
      provider_ref: bankResult.provider_ref,
      paid_at: bankResult.paid_at,
      idempotency_key: compositeIdem,
      requestId,
      approvals,
      simulated: isSimPort(banking),
    });

    if (isSimPort(banking)) {
      // ensure the shared simulator retains the same settlement list used for recon endpoints
      const sim = getSimRail();
      const settlement = sim.getByProviderRef(record.provider_ref);
      if (!settlement) {
        // if a different instance was used for this call, reflect the settlement for exports
        sim.listSettlements();
      }
    }

    return res.status(200).json({ provider_ref: record.provider_ref, paid_at: record.paid_at });
  } catch (err: any) {
    return respondError(res, 500, {
      code: "RELEASE_ERROR",
      title: "Release failed",
      detail: String(err?.message ?? err ?? "Unknown error"),
      requestId,
    });
  }
}
