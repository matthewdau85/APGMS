import fs from "fs";
import path from "path";
import crypto from "crypto";
import { mockPayroll, mockSales } from "../src/utils/mockData";

interface CliOptions {
  abn: string;
  periodId: string;
  start: Date;
  totalHours: number;
  posIntervalHours: number;
  payrollIntervalHours: number;
  outputDir: string;
  gstRate: number;
  paygwRate: number;
  settlementLagMinutes: number;
  minSalesPerBatch: number;
  maxSalesPerBatch: number;
  seed?: number;
}

interface CreditRow {
  abn: string;
  taxType: "GST" | "PAYGW";
  periodId: string;
  amount_cents: number;
  bank_receipt_hash: string;
  eventTs: Date;
  grossCents: number;
}

interface SettlementRow {
  txn_id: string;
  gst_cents: number;
  net_cents: number;
  settlement_ts: string;
}

type PayrollRecord = (typeof mockPayroll)[number];
type SaleRecord = (typeof mockSales)[number];

function parseArgs(): CliOptions {
  const argv = process.argv.slice(2);
  const opts: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const [flag, valueFromEq] = arg.split("=");
    const key = flag.replace(/^--/, "");
    if (valueFromEq !== undefined) {
      opts[key] = valueFromEq;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      opts[key] = next;
      i++;
    } else {
      opts[key] = true;
    }
  }

  if (opts.help || opts.h) {
    printHelp();
    process.exit(0);
  }

  const abn = typeof opts.abn === "string" ? opts.abn : "12345678901";
  const periodId = typeof opts.period === "string" ? opts.period : deriveDefaultPeriodId();
  const start = parseStart(periodId, typeof opts.start === "string" ? opts.start : undefined);
  const defaultHours = deriveDefaultHours(periodId, start);
  const totalHours = opts.hours ? Number(opts.hours) : defaultHours;
  const posIntervalHours = opts["pos-interval"] ? Number(opts["pos-interval"]) : 1;
  const payrollIntervalHours = opts["payroll-interval"] ? Number(opts["payroll-interval"]) : 168;
  const outputDir = path.resolve(typeof opts.out === "string" ? opts.out : path.join(process.cwd(), "samples", "inbound"));
  const gstRate = opts["gst-rate"] ? Number(opts["gst-rate"]) : 0.1;
  const paygwRate = opts["paygw-rate"] ? Number(opts["paygw-rate"]) : 0.25;
  const settlementLagMinutes = opts["settlement-lag"] ? Number(opts["settlement-lag"]) : 90;
  const minSalesPerBatch = opts["min-sales"] ? Math.max(1, Number(opts["min-sales"])) : 2;
  const maxSalesPerBatch = opts["max-sales"] ? Math.max(minSalesPerBatch, Number(opts["max-sales"])) : 6;
  const seed = opts.seed !== undefined ? Number(opts.seed) : undefined;

  return {
    abn,
    periodId,
    start,
    totalHours,
    posIntervalHours,
    payrollIntervalHours,
    outputDir,
    gstRate,
    paygwRate,
    settlementLagMinutes,
    minSalesPerBatch,
    maxSalesPerBatch,
    seed,
  };
}

function deriveDefaultPeriodId(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return `${year}-${month.toString().padStart(2, "0")}`;
}

function parseStart(periodId: string, override?: string): Date {
  if (override) {
    const parsed = new Date(override);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const monthly = periodId.match(/^(\d{4})-(\d{2})$/);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  }
  const quarterly = periodId.match(/^(\d{4})Q([1-4])$/i);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const quarter = Number(quarterly[2]);
    const month = (quarter - 1) * 3;
    return new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  }
  const fallback = new Date();
  fallback.setUTCMinutes(0, 0, 0);
  return fallback;
}

function deriveDefaultHours(periodId: string, start: Date): number {
  const monthly = periodId.match(/^(\d{4})-(\d{2})$/);
  if (monthly) {
    const year = Number(monthly[1]);
    const month = Number(monthly[2]);
    const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
    return Math.round((end.getTime() - start.getTime()) / 3600000);
  }
  const quarterly = periodId.match(/^(\d{4})Q([1-4])$/i);
  if (quarterly) {
    const year = Number(quarterly[1]);
    const quarter = Number(quarterly[2]);
    const endMonth = (quarter - 1) * 3 + 3;
    const end = new Date(Date.UTC(year, endMonth, 1, 0, 0, 0, 0));
    return Math.round((end.getTime() - start.getTime()) / 3600000);
  }
  return 24 * 14; // two-week default
}

function createRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rand: () => number, min: number, max: number) {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function randomChoice<T>(rand: () => number, arr: readonly T[]): T {
  const idx = Math.floor(rand() * arr.length);
  return arr[idx];
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function formatCredits(rows: CreditRow[]): string {
  const header = "abn,taxType,periodId,amount_cents,bank_receipt_hash";
  const body = rows
    .map((row) => [row.abn, row.taxType, row.periodId, row.amount_cents, row.bank_receipt_hash].join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

function formatSettlements(rows: SettlementRow[]): string {
  const header = "txn_id,gst_cents,net_cents,settlement_ts";
  const body = rows
    .map((row) => [row.txn_id, row.gst_cents, row.net_cents, row.settlement_ts].join(","))
    .join("\n");
  return `${header}\n${body}\n`;
}

function printHelp() {
  console.log(`Usage: npx tsx tools/simulate_inbound.ts [options]\n\n` +
    `Options:\n` +
    `  --abn <value>               ABN to attribute credits to (default 12345678901)\n` +
    `  --period <YYYY-MM|YYYYQ#>   Period identifier (default current month)\n` +
    `  --start <iso-date>          Override period start timestamp\n` +
    `  --hours <n>                 How many hours of activity to synthesise\n` +
    `  --pos-interval <n>          Hours between POS batches (default 1)\n` +
    `  --payroll-interval <n>      Hours between STP runs (default 168)\n` +
    `  --gst-rate <rate>           GST rate applied to taxable sales (default 0.1)\n` +
    `  --paygw-rate <rate>         PAYGW rate applied to payroll (default 0.25)\n` +
    `  --min-sales <n>             Minimum sales per POS batch (default 2)\n` +
    `  --max-sales <n>             Maximum sales per POS batch (default 6)\n` +
    `  --settlement-lag <mins>     Minutes between accrual and settlement (default 90)\n` +
    `  --seed <n>                  Seed for deterministic replay\n` +
    `  --out <dir>                 Output directory (default samples/inbound)\n` +
    `  --help                      Show this message\n`);
}

function buildReceipt(prefix: string, ts: Date, rand: () => number): string {
  const iso = ts.toISOString();
  const entropy = crypto.randomBytes(3).toString("hex");
  // include prefix so reconcile_worker can infer taxType when logging
  return `${prefix}-${iso}-${entropy}`;
}

function generatePosCredits(config: CliOptions, rand: () => number): { credits: CreditRow[]; settlements: SettlementRow[] } {
  const credits: CreditRow[] = [];
  const settlements: SettlementRow[] = [];
  const startMs = config.start.getTime();
  const intervalMs = config.posIntervalHours * 3600000;
  const endMs = startMs + config.totalHours * 3600000;

  for (let tsMs = startMs; tsMs < endMs; tsMs += intervalMs) {
    const eventTs = new Date(tsMs);
    const saleCount = randomInt(rand, config.minSalesPerBatch, config.maxSalesPerBatch);
    let taxableCents = 0;
    let grossCents = 0;
    for (let i = 0; i < saleCount; i++) {
      const sale: SaleRecord = randomChoice(rand, mockSales);
      const drift = 0.9 + rand() * 0.2; // +/-10%
      const gross = Math.round(sale.amount * drift);
      grossCents += gross;
      if (!sale.exempt) {
        taxableCents += gross;
      }
    }
    const gstCents = Math.round(taxableCents * config.gstRate);
    if (gstCents <= 0) continue;
    const receipt = buildReceipt("GST", eventTs, rand);
    credits.push({
      abn: config.abn,
      taxType: "GST",
      periodId: config.periodId,
      amount_cents: gstCents,
      bank_receipt_hash: receipt,
      eventTs,
      grossCents,
    });
    const settlementTs = new Date(eventTs.getTime() + config.settlementLagMinutes * 60000);
    settlements.push({
      txn_id: receipt,
      gst_cents: gstCents,
      net_cents: Math.max(grossCents - gstCents, 0),
      settlement_ts: settlementTs.toISOString(),
    });
  }
  return { credits, settlements };
}

function generatePayrollCredits(config: CliOptions, rand: () => number): { credits: CreditRow[]; settlements: SettlementRow[] } {
  const credits: CreditRow[] = [];
  const settlements: SettlementRow[] = [];
  const startMs = config.start.getTime();
  const intervalMs = config.payrollIntervalHours * 3600000;
  const endMs = startMs + config.totalHours * 3600000;

  for (let tsMs = startMs + intervalMs; tsMs <= endMs; tsMs += intervalMs) {
    const eventTs = new Date(tsMs);
    const rosterSize = randomInt(rand, 1, mockPayroll.length);
    const shuffled = [...mockPayroll].sort(() => rand() - 0.5);
    let withheldCents = 0;
    let grossCents = 0;
    for (let i = 0; i < rosterSize; i++) {
      const worker: PayrollRecord = shuffled[i];
      const gross = Math.round(worker.gross * (0.95 + rand() * 0.1)); // +/-5%
      grossCents += gross;
      const withheld = Math.max(0, Math.round(gross * config.paygwRate));
      withheldCents += withheld;
    }
    if (withheldCents <= 0) continue;
    const receipt = buildReceipt("PAYGW", eventTs, rand);
    credits.push({
      abn: config.abn,
      taxType: "PAYGW",
      periodId: config.periodId,
      amount_cents: withheldCents,
      bank_receipt_hash: receipt,
      eventTs,
      grossCents,
    });
    const settlementTs = new Date(eventTs.getTime() + config.settlementLagMinutes * 60000);
    settlements.push({
      txn_id: receipt,
      gst_cents: 0,
      net_cents: Math.max(grossCents - withheldCents, 0),
      settlement_ts: settlementTs.toISOString(),
    });
  }

  return { credits, settlements };
}

function main() {
  const config = parseArgs();
  const rand = config.seed !== undefined ? createRng(config.seed) : Math.random;

  ensureDir(config.outputDir);

  const pos = generatePosCredits(config, rand);
  const payroll = generatePayrollCredits(config, rand);

  const gstCredits = [...pos.credits].sort((a, b) => a.eventTs.getTime() - b.eventTs.getTime());
  const paygwCredits = [...payroll.credits].sort((a, b) => a.eventTs.getTime() - b.eventTs.getTime());
  const settlementRows = [...pos.settlements, ...payroll.settlements].sort(
    (a, b) => new Date(a.settlement_ts).getTime() - new Date(b.settlement_ts).getTime()
  );

  const gstPath = path.join(config.outputDir, `${config.periodId}_GST_credits.csv`);
  const paygwPath = path.join(config.outputDir, `${config.periodId}_PAYGW_credits.csv`);
  const settlementPath = path.join(config.outputDir, `${config.periodId}_settlements.csv`);

  fs.writeFileSync(gstPath, formatCredits(gstCredits), "utf8");
  fs.writeFileSync(paygwPath, formatCredits(paygwCredits), "utf8");
  fs.writeFileSync(settlementPath, formatSettlements(settlementRows), "utf8");

  const gstTotal = gstCredits.reduce((acc, row) => acc + row.amount_cents, 0);
  const paygwTotal = paygwCredits.reduce((acc, row) => acc + row.amount_cents, 0);

  console.log("Generated inbound CSV payloads:");
  console.log(`  GST credits:    ${gstCredits.length} rows, ${gstTotal} cents -> ${gstPath}`);
  console.log(`  PAYGW credits:  ${paygwCredits.length} rows, ${paygwTotal} cents -> ${paygwPath}`);
  console.log(`  Settlements:    ${settlementRows.length} rows -> ${settlementPath}`);
  console.log("Use these with reconcile_worker.js --watch to replay the synthetic activity.");
}

main();
