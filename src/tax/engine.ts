import type { PoolClient } from "pg";
import { paygwWithholdingCents, PAYGW_RULE_VERSION, PayPeriod } from "./rates";

export interface PeriodTotals {
  gst_sales: number;
  gst_purchases: number;
  gst_payable: number;
  gst_credits: number;
  paygw_w1: number;
  paygw_w2: number;
  final_liability_cents: number;
  rates_version: string;
}

type DbClient = PoolClient;

type QueryDescriptor = { sql: string; parser?: (row: any) => any };

async function gatherRows(client: DbClient, queries: QueryDescriptor[], params: any[]): Promise<any[]> {
  const rows: any[] = [];
  for (const q of queries) {
    try {
      const res = await client.query(q.sql, params);
      if (res.rows?.length) {
        if (q.parser) rows.push(...res.rows.map(q.parser));
        else rows.push(...res.rows);
      }
    } catch (err: any) {
      if (err?.code === "42P01") {
        continue; // table not present
      }
      throw err;
    }
  }
  return rows;
}

function parsePayCycle(value: any): PayPeriod {
  const raw = String(value ?? "weekly").toLowerCase();
  if (raw.startsWith("fort")) return "fortnightly";
  if (raw.startsWith("month")) return "monthly";
  return "weekly";
}

function extractBoolean(value: any, fallback = true): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  const str = String(value).toLowerCase();
  if (str === "true" || str === "t" || str === "1") return true;
  if (str === "false" || str === "f" || str === "0") return false;
  return fallback;
}

function toNumber(value: any): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function sumPaygw(rows: any[]): { gross: number; withholding: number } {
  let grossTotal = 0;
  let withholdingTotal = 0;
  let ratesVersion = PAYGW_RULE_VERSION;

  for (const row of rows) {
    const gross = toNumber(row.gross_cents ?? row.gross_amount_cents ?? row.gross ?? 0);
    if (!gross) continue;
    grossTotal += Math.round(gross);
    const period = parsePayCycle(row.pay_cycle ?? row.period ?? row.frequency ?? row.cycle);
    const taxFree = extractBoolean(row.tax_free_threshold ?? row.claims_tax_free_threshold, true);
    const { withholding_cents, rates_version } = paygwWithholdingCents(gross, period, { taxFreeThreshold: taxFree });
    ratesVersion = rates_version;
    withholdingTotal += withholding_cents;
  }

  return { gross: Math.round(grossTotal), withholding: Math.round(withholdingTotal) };
}

function isTaxableCode(code: any): boolean {
  if (code === null || code === undefined) return true;
  const c = String(code).toUpperCase();
  return !(c.includes("FREE") || c.includes("EXEMPT") || c.includes("ZERO"));
}

function extractGst(row: any, baseAmount: number): number {
  if (row == null) return 0;
  if (row.gst_cents != null) return Math.round(toNumber(row.gst_cents));
  if (row.gst_amount_cents != null) return Math.round(toNumber(row.gst_amount_cents));
  if (row.gst != null) return Math.round(toNumber(row.gst) * 100);
  const rate = row.gst_rate ?? row.rate;
  if (rate != null) {
    const numericRate = typeof rate === "number" ? rate : Number(rate);
    if (Number.isFinite(numericRate) && numericRate !== 0) {
      return Math.round(baseAmount * numericRate);
    }
  }
  if (!isTaxableCode(row.tax_code ?? row.code)) return 0;
  return Math.round(baseAmount * 0.1);
}

function sumGst(rows: any[]): { base: number; gst: number } {
  let base = 0;
  let gst = 0;
  for (const row of rows) {
    const amount = toNumber(
      row.taxable_amount_cents ?? row.amount_cents ?? row.net_amount_cents ?? row.net_cents ?? row.base_amount_cents ?? 0
    );
    if (!amount) continue;
    const amt = Math.round(amount);
    base += amt;
    gst += extractGst(row, amt);
  }
  return { base: Math.round(base), gst: Math.round(gst) };
}

export async function computePeriodTotals(client: DbClient, abn: string, periodId: string): Promise<PeriodTotals> {
  const payrollRows = await gatherRows(
    client,
    [
      { sql: "SELECT pay_cycle, gross_cents, tax_free_threshold FROM payroll_runs WHERE abn=$1 AND period_id=$2" },
      { sql: "SELECT period as pay_cycle, gross_cents, tax_free_threshold FROM payroll_events WHERE abn=$1 AND period_id=$2" },
      { sql: "SELECT frequency as pay_cycle, gross_amount_cents as gross_cents, tax_free_threshold FROM payroll_journal WHERE abn=$1 AND period_id=$2" }
    ],
    [abn, periodId]
  );

  const { gross: paygwGross, withholding: paygwWithheld } = sumPaygw(payrollRows);

  const gstSalesRows = await gatherRows(
    client,
    [
      { sql: "SELECT amount_cents, gst_cents, tax_code FROM gst_sales WHERE abn=$1 AND period_id=$2" },
      { sql: "SELECT amount_cents, gst_cents, tax_code, direction FROM gst_transactions WHERE abn=$1 AND period_id=$2 AND (direction='SALE' OR direction='SALES')" },
      { sql: "SELECT net_amount_cents as amount_cents, gst_amount_cents as gst_cents, tax_code FROM pos_tax_journal WHERE abn=$1 AND period_id=$2 AND direction='SALE'" }
    ],
    [abn, periodId]
  );

  const gstPurchaseRows = await gatherRows(
    client,
    [
      { sql: "SELECT amount_cents, gst_cents, tax_code FROM gst_purchases WHERE abn=$1 AND period_id=$2" },
      { sql: "SELECT amount_cents, gst_cents, tax_code, direction FROM gst_transactions WHERE abn=$1 AND period_id=$2 AND (direction='PURCHASE' OR direction='PURCHASES')" },
      { sql: "SELECT net_amount_cents as amount_cents, gst_amount_cents as gst_cents, tax_code FROM pos_tax_journal WHERE abn=$1 AND period_id=$2 AND direction='PURCHASE'" }
    ],
    [abn, periodId]
  );

  const sales = sumGst(gstSalesRows);
  const purchases = sumGst(gstPurchaseRows);

  const gstPayable = sales.gst;
  const gstCredits = purchases.gst;
  const netGst = gstPayable - gstCredits;
  const finalLiability = paygwWithheld + netGst;

  return {
    gst_sales: sales.base,
    gst_purchases: purchases.base,
    gst_payable: gstPayable,
    gst_credits: gstCredits,
    paygw_w1: paygwGross,
    paygw_w2: paygwWithheld,
    final_liability_cents: Math.round(finalLiability),
    rates_version: PAYGW_RULE_VERSION
  };
}
