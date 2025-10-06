import { PoolLike, getPool } from "../db/pool";
import { GstAdjustments, GstBasket, GstComputation, getGst } from "../tax/rules";

export type PosSaleLine = {
  transactionId: string;
  type: "sale" | "refund";
  total: number;
  taxableAmount?: number;
  gstAmount?: number;
  taxCode: string;
  cashPeriodId?: string | null;
  accrualPeriodId?: string | null;
};

export type PosPurchaseLine = {
  purchaseId: string;
  total: number;
  gstAmount?: number;
  taxCode: string;
  category: "capital" | "non_capital";
  cashPeriodId?: string | null;
  accrualPeriodId?: string | null;
};

export type PosEventPayload = {
  eventId: string;
  abn: string;
  periodId: string;
  locationId: string;
  occurredAt: string;
  sales: PosSaleLine[];
  purchases?: PosPurchaseLine[];
  adjustments?: Partial<GstAdjustments>;
};

export type GstTotals = GstComputation & {
  events: number;
  salesCount: number;
  purchaseCount: number;
};

function parsePayload(row: any): PosEventPayload | null {
  if (!row) return null;
  const payload = row.payload ?? row;
  if (!payload) return null;
  if (typeof payload === "string") {
    return JSON.parse(payload);
  }
  return payload as PosEventPayload;
}

function shouldInclude({
  requestedPeriodId,
  basis,
  eventPeriodId,
  cashId,
  accrualId,
}: {
  requestedPeriodId: string;
  basis: "cash" | "accrual";
  eventPeriodId: string;
  cashId?: string | null;
  accrualId?: string | null;
}): boolean {
  if (basis === "cash") {
    return (cashId ?? accrualId ?? eventPeriodId) === requestedPeriodId;
  }
  return (accrualId ?? cashId ?? eventPeriodId) === requestedPeriodId;
}

export async function computeGstForPeriod({
  abn,
  periodId,
  basis,
  pool = getPool(),
}: {
  abn: string;
  periodId: string;
  basis: "cash" | "accrual";
  pool?: PoolLike;
}): Promise<GstTotals | null> {
  const result = await pool.query(
    "SELECT payload FROM pos_events WHERE abn=$1 AND period_id=$2 ORDER BY received_at ASC",
    [abn, periodId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const basket: GstBasket = { sales: [], purchases: [] };
  const adjustments: GstAdjustments = {};
  let salesCount = 0;
  let purchaseCount = 0;

  for (const row of result.rows) {
    const payload = parsePayload(row);
    if (!payload) continue;

    for (const sale of payload.sales ?? []) {
      if (
        !shouldInclude({
          requestedPeriodId: periodId,
          basis,
          eventPeriodId: payload.periodId,
          cashId: sale.cashPeriodId,
          accrualId: sale.accrualPeriodId,
        })
      ) {
        continue;
      }
      basket.sales.push({
        transactionId: sale.transactionId,
        type: sale.type,
        total: sale.total,
        taxableAmount: sale.taxableAmount,
        gstAmount: sale.gstAmount,
        taxCode: sale.taxCode,
      });
      salesCount += 1;
    }

    for (const purchase of payload.purchases ?? []) {
      if (
        !shouldInclude({
          requestedPeriodId: periodId,
          basis,
          eventPeriodId: payload.periodId,
          cashId: purchase.cashPeriodId,
          accrualId: purchase.accrualPeriodId,
        })
      ) {
        continue;
      }
      basket.purchases.push({
        purchaseId: purchase.purchaseId,
        total: purchase.total,
        gstAmount: purchase.gstAmount,
        taxCode: purchase.taxCode,
        category: purchase.category,
      });
      purchaseCount += 1;
    }

    if (payload.adjustments) {
      adjustments.salesAdjustments = (adjustments.salesAdjustments ?? 0) + (payload.adjustments.salesAdjustments ?? 0);
      adjustments.gstOnSalesAdjustments = (adjustments.gstOnSalesAdjustments ?? 0) + (payload.adjustments.gstOnSalesAdjustments ?? 0);
      adjustments.capitalPurchasesAdjustments =
        (adjustments.capitalPurchasesAdjustments ?? 0) + (payload.adjustments.capitalPurchasesAdjustments ?? 0);
      adjustments.nonCapitalPurchasesAdjustments =
        (adjustments.nonCapitalPurchasesAdjustments ?? 0) + (payload.adjustments.nonCapitalPurchasesAdjustments ?? 0);
      adjustments.gstOnPurchasesAdjustments =
        (adjustments.gstOnPurchasesAdjustments ?? 0) + (payload.adjustments.gstOnPurchasesAdjustments ?? 0);
    }
  }

  const computation = getGst(basket, basis, adjustments);

  return {
    ...computation,
    events: result.rowCount,
    salesCount,
    purchaseCount,
  };
}
