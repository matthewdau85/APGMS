import crypto from "crypto";
import type { Request } from "express";
import { Router } from "express";

import { getPool } from "../db/pool";
import type { PayPeriod } from "../tax/rules";
import type { PayrollEventPayload, StpEmployeeLine } from "../utils/paygw";

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

const HMAC_HEADER = "x-signature";

function computeHmac(body: Buffer, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

export const stpIngestRouter = Router();

stpIngestRouter.post("/", async (req, res) => {
  const pool = getPool();
  const secret = process.env.STP_WEBHOOK_SECRET;
  const rawBody = (req as RawBodyRequest).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
  const signature = (req.get(HMAC_HEADER) ?? "").trim().toLowerCase();

  const recordFailure = async (reason: string, payload?: unknown) => {
    let serialised: string;
    try {
      serialised = JSON.stringify(payload ?? JSON.parse(rawBody.toString() || "{}"));
    } catch {
      serialised = JSON.stringify({});
    }
    await pool.query("INSERT INTO payroll_dlq (reason, raw_payload, created_at) VALUES ($1, $2::jsonb, NOW())", [reason, serialised]);
  };

  if (!secret) {
    await recordFailure("NO_SECRET", req.body);
    return res.status(500).json({ error: "STP_SECRET_NOT_CONFIGURED" });
  }

  const expectedSignature = computeHmac(rawBody, secret);
  let signaturesMatch = false;
  if (signature.length === expectedSignature.length) {
    signaturesMatch = crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex"));
  }

  if (!signaturesMatch) {
    await recordFailure("INVALID_SIGNATURE", req.body);
    return res.status(202).json({ status: "DLQ" });
  }

  let parsed: PayrollEventPayload;
  try {
    parsed = normaliseStpEvent(req.body);
  } catch (err) {
    await recordFailure("SCHEMA_INVALID", req.body);
    return res.status(202).json({ status: "DLQ" });
  }

  try {
    await pool.query(
      `INSERT INTO payroll_events (event_id, abn, period, period_id, payload, received_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
       ON CONFLICT (event_id) DO UPDATE SET payload = EXCLUDED.payload, received_at = EXCLUDED.received_at`,
      [parsed.eventId, parsed.abn, parsed.period.frequency, parsed.period.periodId, JSON.stringify(parsed)]
    );
    return res.status(200).json({ status: "OK" });
  } catch (err) {
    await recordFailure("DB_ERROR", parsed);
    return res.status(500).json({ error: "INGEST_FAILED" });
  }
});

const allowedPeriods: PayPeriod[] = ["weekly", "fortnightly", "monthly"];

function ensureString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${field}`);
  }
  return value.trim();
}

function ensureNumber(value: unknown, field: string, { min = 0 } = {}): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < min) {
    throw new Error(`Invalid ${field}`);
  }
  return num;
}

function normaliseFlags(input: any): StpEmployeeLine["flags"] {
  if (!input || typeof input !== "object") return undefined;
  const flags: StpEmployeeLine["flags"] = {};
  if ("taxFreeThreshold" in input) {
    flags.taxFreeThreshold = Boolean(input.taxFreeThreshold);
  }
  if ("roundingMode" in input) {
    const mode = String(input.roundingMode);
    if (mode === "HALF_UP" || mode === "DOWN" || mode === "UP") {
      flags.roundingMode = mode;
    }
  }
  return Object.keys(flags).length ? flags : undefined;
}

function normaliseEmployee(raw: any): StpEmployeeLine {
  if (!raw || typeof raw !== "object") throw new Error("Invalid employee");
  return {
    employeeId: ensureString(raw.employeeId, "employeeId"),
    gross: ensureNumber(raw.gross, "gross"),
    allowances: ensureNumber(raw.allowances ?? 0, "allowances", { min: 0 }),
    deductions: ensureNumber(raw.deductions ?? 0, "deductions", { min: 0 }),
    taxWithheld: raw.taxWithheld != null ? ensureNumber(raw.taxWithheld, "taxWithheld", { min: 0 }) : undefined,
    flags: normaliseFlags(raw.flags),
  };
}

function normaliseStpEvent(body: any): PayrollEventPayload {
  if (!body || typeof body !== "object") throw new Error("INVALID_BODY");
  const eventId = ensureString(body.eventId, "eventId");
  const abn = ensureString(body.abn, "abn");
  const payDateRaw = body.payDate ?? new Date().toISOString();
  const payDate = new Date(payDateRaw);
  if (Number.isNaN(payDate.getTime())) {
    throw new Error("INVALID_PAYDATE");
  }
  const periodObj = body.period ?? {};
  const frequency = ensureString(periodObj.frequency, "period.frequency") as PayPeriod;
  if (!allowedPeriods.includes(frequency)) {
    throw new Error("INVALID_PERIOD");
  }
  const periodId = ensureString(periodObj.periodId, "period.periodId");
  const employeesInput = Array.isArray(body.employees) ? body.employees : [];
  if (employeesInput.length === 0) {
    throw new Error("NO_EMPLOYEES");
  }
  const employees = employeesInput.map(normaliseEmployee);
  return {
    eventId,
    abn,
    payDate: payDate.toISOString(),
    period: { frequency, periodId },
    employees,
  };
}
