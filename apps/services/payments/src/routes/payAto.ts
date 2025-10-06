import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { ZodError, z } from "zod";

import { pool } from "../index.js";
import { isAbnAllowlisted } from "../utils/allowlist.js";

const releaseRequestSchema = z
  .object({
    abn: z
      .string()
      .trim()
      .regex(/^[0-9]{11}$/u, { message: "abn must be 11 digits" }),
    taxType: z.string().trim().min(1, { message: "taxType is required" }),
    periodId: z.string().trim().min(1, { message: "periodId is required" }),
    amountCents: z.preprocess(val => {
      if (typeof val === "number" && Number.isFinite(val)) return val;
      if (typeof val === "string" && val.trim().length) {
        const parsed = Number(val);
        if (Number.isFinite(parsed)) return parsed;
      }
      return val;
    }, z.number({ invalid_type_error: "amountCents must be a number" })),
    currency: z
      .string()
      .trim()
      .transform(v => v.toUpperCase())
      .refine(v => v === "AUD", { message: "currency must be AUD" }),
    mode: z
      .preprocess(val => (val === undefined || val === null ? "COMMIT" : val), z.enum(["COMMIT", "DRY_RUN"])),
    reversal: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!Number.isFinite(value.amountCents)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amountCents must be finite", path: ["amountCents"] });
      return;
    }
    if (value.amountCents === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amountCents must be non-zero", path: ["amountCents"] });
      return;
    }
    if (value.reversal) {
      if (value.amountCents >= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reversal amount must be negative", path: ["amountCents"] });
      }
    } else if (value.amountCents <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amountCents must be positive", path: ["amountCents"] });
    }
  });

type ReleaseRequest = z.infer<typeof releaseRequestSchema>;

const PG_ERROR_MAP: Record<string, { status: number; error: string }> = {
  "23505": { status: 409, error: "Release already exists for this period" },
  "23503": { status: 409, error: "Related ledger entry not found" },
  "23514": { status: 400, error: "Ledger constraint violated" },
};

function buildReceipt(req: ReleaseRequest, opts: { requestId: string; rpt: any; dryRun: boolean; balanceAfter?: number; transferUuid?: string; releaseUuid?: string; ledgerId?: number }) {
  const base = {
    ok: true,
    request_id: opts.requestId,
    mode: req.mode,
    amount_cents: Math.abs(req.amountCents),
    currency: req.currency,
    abn: req.abn,
    taxType: req.taxType,
    periodId: req.periodId,
    reversal: Boolean(req.reversal),
    rpt_ref: opts.rpt
      ? { rpt_id: opts.rpt.rpt_id, kid: opts.rpt.kid, payload_sha256: opts.rpt.payload_sha256 }
      : undefined,
  } as const;

  if (opts.dryRun) {
    return { ...base, dry_run: true };
  }

  return {
    ...base,
    dry_run: false,
    ledger_id: opts.ledgerId,
    transfer_uuid: opts.transferUuid,
    release_uuid: opts.releaseUuid,
    balance_after_cents: opts.balanceAfter,
  };
}

export async function payAtoRelease(req: Request, res: Response) {
  const requestId = randomUUID();

  let parsed: ReleaseRequest;
  try {
    parsed = releaseRequestSchema.parse(req.body ?? {});
  } catch (err) {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: "Validation failed", request_id: requestId, issues: err.issues });
    }
    return res.status(400).json({ error: "Invalid payload", request_id: requestId });
  }

  if (!isAbnAllowlisted(parsed.abn)) {
    return res.status(403).json({ error: "ABN not allowlisted", request_id: requestId });
  }

  const rpt = (req as any).rpt;
  if (!rpt) {
    return res.status(403).json({ error: "RPT not verified", request_id: requestId });
  }

  if (parsed.mode === "DRY_RUN") {
    return res.json(buildReceipt(parsed, { requestId, rpt, dryRun: true }));
  }

  const ledgerDelta = parsed.reversal ? Math.abs(parsed.amountCents) : -Math.abs(parsed.amountCents);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: lastRows } = await client.query<{ balance_after_cents: string | number }>(
      `SELECT balance_after_cents
       FROM owa_ledger
       WHERE abn=$1 AND tax_type=$2 AND period_id=$3
       ORDER BY id DESC
       LIMIT 1`,
      [parsed.abn, parsed.taxType, parsed.periodId]
    );
    const lastBal = lastRows.length ? Number(lastRows[0].balance_after_cents) : 0;
    const newBal = lastBal + ledgerDelta;

    const transferUuid = randomUUID();
    const releaseUuid = randomUUID();

    const insert = `
      INSERT INTO owa_ledger
        (abn, tax_type, period_id, transfer_uuid, amount_cents, balance_after_cents,
         rpt_verified, release_uuid, created_at)
      VALUES ($1,$2,$3,$4,$5,$6, TRUE, $7, now())
      RETURNING id, transfer_uuid, balance_after_cents
    `;

    const { rows: inserted } = await client.query(insert, [
      parsed.abn,
      parsed.taxType,
      parsed.periodId,
      transferUuid,
      ledgerDelta,
      newBal,
      releaseUuid,
    ]);

    await client.query("COMMIT");

    return res.json(
      buildReceipt(parsed, {
        requestId,
        rpt,
        dryRun: false,
        balanceAfter: Number(inserted[0].balance_after_cents),
        transferUuid: inserted[0].transfer_uuid,
        releaseUuid,
        ledgerId: inserted[0].id,
      })
    );
  } catch (err: any) {
    await client.query("ROLLBACK");
    const pgCode = err?.code as string | undefined;
    if (pgCode && PG_ERROR_MAP[pgCode]) {
      const mapped = PG_ERROR_MAP[pgCode];
      return res.status(mapped.status).json({ error: mapped.error, request_id: requestId, detail: err?.detail });
    }

    console.error(`[payments] release error ${requestId}`, err);
    return res.status(500).json({ error: "Release error", request_id: requestId });
  } finally {
    client.release();
  }
}
