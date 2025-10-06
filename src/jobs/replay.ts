import { merkleRootHex } from "../crypto/merkle";
import { orderedEvents, totals } from "../services/ingestionService";
import { creditedTotal, latestBalance } from "../services/ledgerService";
import { averageLiability, listPeriodsNeedingReplay, updateMetrics } from "../persistence/periodsRepository";
import { latestLedger } from "../persistence/ledgerRepository";

interface Args {
  abn?: string;
  taxType?: "PAYGW" | "GST";
  periodId?: string;
}

function parseArgs(): Args {
  const args: Args = {};
  for (const arg of process.argv.slice(2)) {
    const [key, value] = arg.split("=");
    if (key === "--abn") args.abn = value;
    if (key === "--tax") args.taxType = value as "PAYGW" | "GST";
    if (key === "--period") args.periodId = value;
  }
  return args;
}

function computeAnomalyVector(amounts: number[], timestamps: Date[], baseline: number | null) {
  if (amounts.length === 0) {
    return {
      variance_ratio: 0,
      dup_rate: 0,
      gap_minutes: 0,
      delta_vs_baseline: baseline ? -1 : 0,
    };
  }
  const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance =
    amounts.reduce((acc, amt) => acc + Math.pow(amt - mean, 2), 0) / Math.max(1, amounts.length - 1);
  const varianceRatio = mean === 0 ? 0 : variance / mean;
  const uniqueIds = new Set<string>();
  let dup = 0;
  for (let i = 0; i < amounts.length; i += 1) {
    const key = `${amounts[i]}#${timestamps[i].toISOString()}`;
    if (uniqueIds.has(key)) dup += 1;
    uniqueIds.add(key);
  }
  let maxGap = 0;
  for (let i = 1; i < timestamps.length; i += 1) {
    const gap = (timestamps[i].getTime() - timestamps[i - 1].getTime()) / 60000;
    if (gap > maxGap) maxGap = gap;
  }
  const total = amounts.reduce((a, b) => a + b, 0);
  const delta = baseline ? (total - baseline) / baseline : 0;
  return {
    variance_ratio: Number(varianceRatio.toFixed(6)),
    dup_rate: Number((dup / amounts.length).toFixed(6)),
    gap_minutes: Number(maxGap.toFixed(2)),
    delta_vs_baseline: Number(delta.toFixed(6)),
  };
}

async function replay(abn: string, taxType: "PAYGW" | "GST", periodId: string) {
  const eventRows =
    taxType === "PAYGW"
      ? await orderedEvents.payroll(abn, periodId)
      : await orderedEvents.pos(abn, periodId);
  const amounts = eventRows.map((e) => Number(e.amount_cents));
  const timestamps = eventRows.map((e) => new Date(e.occurred_at));
  const leaves = eventRows.map((e) => `${e.event_id}:${e.amount_cents}`);
  const merkle = merkleRootHex(leaves);
  const totalsRow =
    taxType === "PAYGW"
      ? await totals.payroll(abn, periodId)
      : await totals.pos(abn, periodId);
  const totalAmount =
    taxType === "PAYGW" ? Number(totalsRow.withheld) : Number(totalsRow.gst);
  const baseline = await averageLiability(abn, taxType, periodId, 4);
  const anomalyVector = computeAnomalyVector(amounts, timestamps, baseline);
  const ledger = await latestLedger(abn, taxType, periodId);
  const credited = await creditedTotal(abn, taxType, periodId);
  await updateMetrics(abn, taxType, periodId, {
    merkle_root: merkle,
    running_balance_hash: ledger?.hash_after ?? null,
    anomaly_vector: anomalyVector,
    accrued_cents: BigInt(totalAmount),
    final_liability_cents: BigInt(totalAmount),
    credited_to_owa_cents: credited,
  });
  const balance = await latestBalance(abn, taxType, periodId);
  console.log(
    JSON.stringify({
      abn,
      taxType,
      periodId,
      merkle,
      anomalyVector,
      totalAmount,
      credited: credited.toString(),
      balance: balance.toString(),
    }),
  );
}

(async () => {
  const args = parseArgs();
  if (args.abn && args.taxType && args.periodId) {
    await replay(args.abn, args.taxType, args.periodId);
    process.exit(0);
  }
  const periods = await listPeriodsNeedingReplay();
  for (const period of periods) {
    await replay(period.abn, period.tax_type as "PAYGW" | "GST", period.period_id);
  }
  process.exit(0);
})();
