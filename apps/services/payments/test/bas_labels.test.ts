import {
  normalizeDomainTotals,
  projectToLabels,
  computeNetLiability,
  diffTotals,
} from "../src/bas/labels";

describe("BAS label mapping", () => {
  it("maps GST domain totals to label totals", () => {
    const domain = normalizeDomainTotals("GST", {
      total_taxable_sales_cents: 50000,
      export_sales_cents: 1000,
      other_gst_free_sales_cents: 200,
      capital_purchases_cents: 1500,
      non_capital_purchases_cents: 2500,
      gst_on_sales_cents: 6000,
      gst_on_purchases_cents: 3000,
    });
    const labels = projectToLabels("GST", domain);
    expect(labels.G1).toBe(50000);
    expect(labels.G2).toBe(1000);
    expect(labels.G3).toBe(200);
    expect(labels.G10).toBe(1500);
    expect(labels.G11).toBe(2500);
    expect(labels["1A"]).toBe(6000);
    expect(labels["1B"]).toBe(3000);
    expect(computeNetLiability("GST", labels)).toBe(3000);
  });

  it("computes deltas across totals", () => {
    const before = { G1: 1000, G2: 0 };
    const after = { G1: 800, G2: 50 };
    expect(diffTotals(before, after)).toEqual({ G1: -200, G2: 50 });
  });
});
