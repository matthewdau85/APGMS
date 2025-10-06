// src/tax/engine.ts
// Lightweight helpers mirroring the PAYGW/GST logic used by the Python tax-engine service.

export interface PayrollLineInput {
  gross_cents: number;
}

export interface PosLineInput {
  quantity: number;
  unit_price_cents: number;
  tax_code?: string | null;
}

const GST_RATE = 0.10;
const PAYGW_BRACKET_CENTS = 80_000;

export function computePaygwWithholding(grossCents: number): number {
  if (!Number.isFinite(grossCents) || grossCents <= 0) {
    return 0;
  }
  if (grossCents <= PAYGW_BRACKET_CENTS) {
    return Math.round(grossCents * 0.15);
  }
  const base = Math.round(PAYGW_BRACKET_CENTS * 0.15);
  const excess = grossCents - PAYGW_BRACKET_CENTS;
  return base + Math.round(excess * 0.20);
}

export function computePaygwTotal(lines: PayrollLineInput[]): number {
  return lines.reduce((acc, line) => acc + computePaygwWithholding(line.gross_cents), 0);
}

export function computeLineTotalCents(line: PosLineInput): number {
  const qty = Number.isFinite(line.quantity) ? line.quantity : 0;
  const unit = Number.isFinite(line.unit_price_cents) ? line.unit_price_cents : 0;
  return Math.round(qty * unit);
}

export function computeLineGstCents(line: PosLineInput): number {
  const total = computeLineTotalCents(line);
  const code = (line.tax_code || "GST").toUpperCase();
  if (total <= 0) {
    return 0;
  }
  if (code === "GST" || code === "" || code === "STANDARD") {
    return Math.round(total * GST_RATE);
  }
  return 0;
}

export function computeGstTotal(lines: PosLineInput[]): number {
  return lines.reduce((acc, line) => acc + computeLineGstCents(line), 0);
}
