import { PoolLike, getPool } from "../db/pool";
import { PayPeriod, PaygwFlags, getPaygw } from "../tax/rules";

export type StpEmployeeLine = {
  employeeId: string;
  gross: number;
  allowances?: number;
  deductions?: number;
  taxWithheld?: number;
  flags?: PaygwFlags;
};

export type PayrollEventPayload = {
  eventId: string;
  abn: string;
  payDate: string;
  period: {
    frequency: PayPeriod;
    periodId: string;
  };
  employees: StpEmployeeLine[];
};

export type PaygwTotals = {
  ratesVersion: string;
  effectiveFrom: string;
  effectiveTo: string;
  totals: {
    W1: number;
    W2: number;
  };
  events: number;
  employees: number;
};

function parsePayload(row: any): PayrollEventPayload | null {
  if (!row) return null;
  const payload = row.payload ?? row;
  if (!payload) return null;
  if (typeof payload === "string") {
    return JSON.parse(payload);
  }
  return payload as PayrollEventPayload;
}

function sumValues(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export async function computePaygwForPeriod({
  abn,
  period,
  periodId,
  pool = getPool(),
}: {
  abn: string;
  period: PayPeriod;
  periodId: string;
  pool?: PoolLike;
}): Promise<PaygwTotals | null> {
  const result = await pool.query(
    "SELECT payload FROM payroll_events WHERE abn=$1 AND period=$2 AND period_id=$3 ORDER BY received_at ASC",
    [abn, period, periodId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  let w1 = 0;
  let w2 = 0;
  let version: string | null = null;
  let effectiveFrom: string | null = null;
  let effectiveTo: string | null = null;
  let employees = 0;

  for (const row of result.rows) {
    const payload = parsePayload(row);
    if (!payload) continue;
    for (const employee of payload.employees ?? []) {
      employees += 1;
      const gross = Number(employee.gross ?? 0);
      const allowances = Number(employee.allowances ?? 0);
      const deductions = Number(employee.deductions ?? 0);
      const taxableGross = gross + allowances - deductions;
      w1 += taxableGross;
      const calc = getPaygw(period, taxableGross, employee.flags);
      version = calc.ratesVersion;
      effectiveFrom = calc.effectiveFrom;
      effectiveTo = calc.effectiveTo;
      w2 += calc.withheld;
    }
  }

  return {
    ratesVersion: version ?? "",
    effectiveFrom: effectiveFrom ?? "",
    effectiveTo: effectiveTo ?? "",
    totals: {
      W1: sumValues(w1),
      W2: sumValues(w2),
    },
    events: result.rowCount,
    employees,
  };
}
