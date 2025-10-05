import type { Request, Response } from "express";
import { Pool } from "pg";

import { issueRPT } from "../rpt/issuer";
import { buildEvidenceBundle } from "../evidence/bundle";
import { releasePayment, resolveDestination } from "../rails/adapter";
import { debit as paytoDebit } from "../payto/adapter";
import { parseSettlementCSV } from "../settlement/splitParser";
import { validate, type Schema, type ValidationIssue } from "../http/validate";

type TaxType = "PAYGW" | "GST";
type Rail = "EFT" | "BPAY";

interface CloseAndIssueBody {
  abn: string;
  taxType: TaxType;
  periodId: string;
  thresholds?: Partial<Record<string, number>>;
}

interface PayAtoBody {
  abn: string;
  taxType: TaxType;
  periodId: string;
  rail: Rail;
}

interface PaytoSweepBody {
  abn: string;
  amount_cents: number;
  reference: string;
}

const DEFAULT_THRESHOLDS = {
  epsilon_cents: 50,
  variance_ratio: 0.25,
  dup_rate: 0.01,
  gap_minutes: 60,
  delta_vs_baseline: 0.2,
};

const pool = new Pool();

const closeAndIssueSchema: Schema<CloseAndIssueBody> = {
  safeParse(data) {
    const issues: ValidationIssue[] = [];
    if (!isRecord(data)) {
      issues.push({ path: [], message: "Expected object", code: "invalid_type" });
      return { success: false, error: { issues } };
    }

    const abn = readString(data, "abn", issues);
    const taxType = readTaxType(data, issues);
    const periodId = readString(data, "periodId", issues);
    const thresholds = readThresholds(data.thresholds, issues);

    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }

    return { success: true, data: { abn, taxType, periodId, thresholds } };
  },
};

const payAtoSchema: Schema<PayAtoBody> = {
  safeParse(data) {
    const issues: ValidationIssue[] = [];
    if (!isRecord(data)) {
      issues.push({ path: [], message: "Expected object", code: "invalid_type" });
      return { success: false, error: { issues } };
    }
    const abn = readString(data, "abn", issues);
    const taxType = readTaxType(data, issues);
    const periodId = readString(data, "periodId", issues);
    const rail = readRail(data, issues);
    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }
    return { success: true, data: { abn, taxType, periodId, rail } };
  },
};

const paytoSweepSchema: Schema<PaytoSweepBody> = {
  safeParse(data) {
    const issues: ValidationIssue[] = [];
    if (!isRecord(data)) {
      issues.push({ path: [], message: "Expected object", code: "invalid_type" });
      return { success: false, error: { issues } };
    }
    const abn = readString(data, "abn", issues);
    const amount = readNumber(data, "amount_cents", issues);
    if (amount !== undefined && amount <= 0) {
      issues.push({ path: ["amount_cents"], message: "amount_cents must be > 0", code: "too_small" });
    }
    const reference = readString(data, "reference", issues);
    if (issues.length > 0) {
      return { success: false, error: { issues } };
    }
    return { success: true, data: { abn, amount_cents: amount!, reference } };
  },
};

export const validateCloseAndIssue = validate(closeAndIssueSchema);
export const validatePayAto = validate(payAtoSchema);
export const validatePaytoSweep = validate(paytoSweepSchema);

export async function closeAndIssue(req: Request<unknown, unknown, CloseAndIssueBody>, res: Response) {
  const { abn, taxType, periodId, thresholds } = req.body;
  const thr = { ...DEFAULT_THRESHOLDS, ...(thresholds ?? {}) };
  try {
    const rpt = await issueRPT(abn, taxType, periodId, thr);
    return res.json(rpt);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function payAto(req: Request<unknown, unknown, PayAtoBody>, res: Response) {
  const { abn, taxType, periodId, rail } = req.body;
  const pr = await pool.query(
    "select * from rpt_tokens where abn=$1 and tax_type=$2 and period_id=$3 order by id desc limit 1",
    [abn, taxType, periodId]
  );
  if (pr.rowCount === 0) return res.status(400).json({ error: "NO_RPT" });
  const payload = pr.rows[0].payload;
  try {
    await resolveDestination(abn, rail, payload.reference);
    const r = await releasePayment(abn, taxType, periodId, payload.amount_cents, rail, payload.reference);
    await pool.query("update periods set state='RELEASED' where abn=$1 and tax_type=$2 and period_id=$3", [abn, taxType, periodId]);
    return res.json(r);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
}

export async function paytoSweep(req: Request<unknown, unknown, PaytoSweepBody>, res: Response) {
  const { abn, amount_cents, reference } = req.body;
  const r = await paytoDebit(abn, amount_cents, reference);
  return res.json(r);
}

export async function settlementWebhook(req: Request, res: Response) {
  const csvText = (req.body as any)?.csv || "";
  const rows = parseSettlementCSV(csvText);
  return res.json({ ingested: rows.length });
}

export async function evidence(req: Request, res: Response) {
  const { abn, taxType, periodId } = req.query as Record<string, string>;
  res.json(await buildEvidenceBundle(abn, taxType as TaxType, periodId));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(data: Record<string, unknown>, key: string, issues: ValidationIssue[]): string {
  const value = data[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path: [key], message: `${key} must be a non-empty string`, code: "invalid_type" });
    return "";
  }
  return value.trim();
}

function readNumber(data: Record<string, unknown>, key: string, issues: ValidationIssue[]): number | undefined {
  const value = data[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    issues.push({ path: [key], message: `${key} must be a number`, code: "invalid_type" });
    return undefined;
  }
  return value;
}

function readTaxType(data: Record<string, unknown>, issues: ValidationIssue[]): TaxType {
  const value = data["taxType"];
  if (value === "PAYGW" || value === "GST") {
    return value;
  }
  issues.push({ path: ["taxType"], message: "taxType must be PAYGW or GST", code: "invalid_enum" });
  return "PAYGW";
}

function readRail(data: Record<string, unknown>, issues: ValidationIssue[]): Rail {
  const value = data["rail"];
  if (value === "EFT" || value === "BPAY") {
    return value;
  }
  issues.push({ path: ["rail"], message: "rail must be EFT or BPAY", code: "invalid_enum" });
  return "EFT";
}

function readThresholds(value: unknown, issues: ValidationIssue[]): Partial<Record<string, number>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    issues.push({ path: ["thresholds"], message: "thresholds must be an object", code: "invalid_type" });
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "number" || Number.isNaN(raw)) {
      issues.push({ path: ["thresholds", key], message: "threshold values must be numeric", code: "invalid_type" });
      continue;
    }
    result[key] = raw;
  }
  return result;
}
