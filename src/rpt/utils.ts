export function deriveTotals(taxType: "PAYGW" | "GST", finalLiabilityCents: number): { paygw_cents: number; gst_cents: number } {
  if (taxType === "PAYGW") {
    return { paygw_cents: finalLiabilityCents, gst_cents: 0 };
  }
  return { paygw_cents: 0, gst_cents: finalLiabilityCents };
}

export function deriveAnomalyScore(vector: Record<string, unknown> | null): number {
  if (!vector) return 0;
  const values = Object.values(vector).map(v => Math.abs(Number(v) || 0));
  if (values.length === 0) return 0;
  return Number(Math.max(...values).toFixed(6));
}
