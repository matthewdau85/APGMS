import {
  AccountingBasis,
  AdjustmentNote,
  BasLabel,
  BasLabelTotals,
  BasSummary,
  GstComponent,
  GstEvent,
  GstEventClassification,
  GstInput,
  GstPurchase,
  GstSale,
  ReportingPeriod,
} from "../types/tax";

const GST_RATE = 0.1;
const BAS_LABELS: BasLabel[] = [
  "G1",
  "G2",
  "G3",
  "G4",
  "G5",
  "G6",
  "G7",
  "G8",
  "G9",
  "G10",
  "G11",
  "G12",
  "G13",
  "G14",
];

type MutableBasLabelTotals = Record<BasLabel, number>;

export class GstModule {
  calculateSimpleGst(input: GstInput): number {
    if (input.exempt) return 0;
    const classification = input.classification ?? "taxable";
    if (classification !== "taxable") return 0;
    return this.gstFromGross(input.saleAmount);
  }

  classify(event: GstEvent): GstEventClassification {
    if (event.kind === "adjustment") return "adjustment";
    const categories = new Set(
      event.components.map(component =>
        component.category === "export" ? "gst_free" : component.category,
      ),
    );

    if (categories.size === 0) {
      return "mixed";
    }

    if (categories.size === 1) {
      const [category] = categories as unknown as ["taxable" | "gst_free" | "input_taxed"];
      return category;
    }

    return "mixed";
  }

  aggregate(events: GstEvent[], period: ReportingPeriod): BasSummary {
    const start = this.asDate(period.start);
    const end = this.asDate(period.end);
    const totals = this.createMutableTotals();

    let gstCollected = 0;
    let gstCredits = 0;

    for (const event of events) {
      if (event.kind === "adjustment") {
        if (!this.withinPeriod(event.note.date, start, end)) continue;
        this.applyAdjustment(event.note, totals, amount => {
          gstCollected += amount.sales;
          gstCredits += amount.purchases;
        });
        continue;
      }

      if (!this.shouldInclude(event, start, end, period.basis)) continue;

      if (event.kind === "sale") {
        gstCollected += this.applySale(event, totals);
      } else {
        gstCredits += this.applyPurchase(event, totals, start, end, period.basis);
      }
    }

    totals.G5 = totals.G1 - totals.G2 - totals.G3 - totals.G4;
    if (totals.G5 < 0) totals.G5 = 0;
    totals.G6 = totals.G5;
    totals.G12 = totals.G10 + totals.G11;
    totals.G9 = totals.G7 - totals.G8;

    const labels: BasLabelTotals = BAS_LABELS.reduce((acc, label) => {
      acc[label] = this.atoRound(totals[label]);
      return acc;
    }, {} as BasLabelTotals);

    const roundedCollected = this.atoRound(gstCollected);
    const roundedCredits = this.atoRound(gstCredits);

    return {
      period,
      basis: period.basis,
      labels,
      gstCollected: roundedCollected,
      gstCredits: roundedCredits,
      netAmount: this.atoRound(gstCollected - gstCredits),
    };
  }

  private applySale(event: GstSale, totals: MutableBasLabelTotals): number {
    let collected = 0;

    for (const component of event.components) {
      totals.G1 += component.amount;
      switch (component.category) {
        case "export":
          totals.G2 += component.amount;
          break;
        case "gst_free":
          totals.G3 += component.amount;
          break;
        case "input_taxed":
          totals.G4 += component.amount;
          break;
        case "taxable":
          collected += this.gstPortion(component);
          break;
        default:
          break;
      }
    }

    return collected;
  }

  private applyPurchase(
    event: GstPurchase,
    totals: MutableBasLabelTotals,
    start: Date,
    end: Date,
    basis: AccountingBasis,
  ): number {
    let credits = 0;

    for (const component of event.components) {
      const bucket = component.capital ? "G10" : "G11";
      totals[bucket] += component.amount;

      if (component.forInputTaxedSales) {
        totals.G13 += component.amount;
      }

      if (component.category === "gst_free" || component.category === "export") {
        totals.G14 += component.amount;
      }

      if (event.claimable && component.category === "taxable") {
        credits += this.gstPortion(component);
      }
    }

    if (event.purchaseCredits) {
      for (const credit of event.purchaseCredits) {
        if (this.withinPeriod(credit.creditDate, start, end, basis)) {
          credits += this.roundToCents(credit.gstAmount);
          totals.G7 += credit.amount;
        }
      }
    }

    return credits;
  }

  private applyAdjustment(
    note: AdjustmentNote,
    totals: MutableBasLabelTotals,
    collect: (amount: { sales: number; purchases: number }) => void,
  ) {
    const gstAmount = this.roundToCents(note.gstAmount);
    const decreasesNet = this.isDecreasing(note);

    if (decreasesNet) {
      totals.G7 += note.amount;
    } else {
      totals.G8 += note.amount;
    }

    if (note.target === "sales") {
      collect({
        sales: note.direction === "decreasing" ? -gstAmount : gstAmount,
        purchases: 0,
      });
    } else {
      collect({
        sales: 0,
        purchases: note.direction === "increasing" ? gstAmount : -gstAmount,
      });
    }
  }

  private shouldInclude(
    transaction: GstSale | GstPurchase,
    start: Date,
    end: Date,
    basis: AccountingBasis,
  ): boolean {
    const inclusion = basis === "cash" ? transaction.paymentDate ?? transaction.issueDate : transaction.issueDate;
    return this.withinPeriod(inclusion, start, end);
  }

  private gstPortion(component: GstComponent): number {
    if (component.gstAmount !== undefined) {
      return this.roundToCents(component.gstAmount);
    }

    if (component.amount === 0) return 0;

    return this.gstFromGross(component.amount);
  }

  private withinPeriod(
    value: Date | string | undefined,
    start: Date,
    end: Date,
    basis?: AccountingBasis,
  ): boolean {
    if (!value) return false;
    const date = this.asDate(value);
    return date >= start && date <= end;
  }

  private isDecreasing(note: AdjustmentNote): boolean {
    if (note.target === "sales") {
      return note.direction === "decreasing";
    }
    return note.direction === "increasing";
  }

  private createMutableTotals(): MutableBasLabelTotals {
    return BAS_LABELS.reduce((acc, label) => {
      acc[label] = 0;
      return acc;
    }, {} as MutableBasLabelTotals);
  }

  private asDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }

  private roundToCents(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private atoRound(value: number): number {
    const absolute = Math.abs(value);
    const rounded = Math.round(absolute);
    return value < 0 ? -rounded : rounded;
  }

  private gstFromGross(amount: number): number {
    if (amount === 0) return 0;
    const gstExclusive = amount / (1 + GST_RATE);
    return this.roundToCents(amount - gstExclusive);
  }
}

export const gstModule = new GstModule();
