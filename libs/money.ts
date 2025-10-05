import assert from "node:assert";

export type MoneyCents = number & { readonly __brand: unique symbol };

function ensureSafeInteger(value: number): asserts value is number {
  assert(Number.isSafeInteger(value), `Expected safe integer cents but received ${value}`);
}

function normalizeCents(value: number | bigint): number {
  const cents = typeof value === "bigint" ? Number(value) : value;
  ensureSafeInteger(cents);
  return cents;
}

export function fromCents(value: number | bigint | string): MoneyCents {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^[-+]?\d+$/.test(trimmed)) {
      throw new Error(`Invalid cents string: ${value}`);
    }
    return fromCents(BigInt(trimmed));
  }
  return normalizeCents(value) as MoneyCents;
}

export function toCents(money: MoneyCents): number {
  return money as number;
}

const BP_SCALE = 10_000n;
const HALF_BP = BP_SCALE / 2n;

export function mulBp(amount: MoneyCents, basisPoints: number | bigint): MoneyCents {
  if (typeof basisPoints === "number" && !Number.isInteger(basisPoints)) {
    throw new Error(`Basis points must be integer, received ${basisPoints}`);
  }
  const bp = typeof basisPoints === "bigint" ? basisPoints : BigInt(basisPoints);
  const raw = BigInt(toCents(amount)) * bp;
  const cents = (raw + HALF_BP) / BP_SCALE;
  return fromCents(cents);
}

function parseDecimalInput(input: string): { sign: bigint; dollars: string; fraction: string } {
  const trimmed = input.trim();
  const match = trimmed.match(/^([+-]?)(\d+)(?:\.(\d{0,}))?$/);
  if (!match) {
    throw new Error(`Invalid decimal monetary value: ${input}`);
  }
  const [, signPart, dollars, fractionRaw = ""] = match;
  const sign = signPart === "-" ? -1n : 1n;
  return { sign, dollars, fraction: fractionRaw };
}

export function roundATO(value: string | number | bigint): MoneyCents {
  if (typeof value === "bigint") {
    return fromCents(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid numeric value: ${value}`);
    }
    const asString = value.toString();
    if (/e/i.test(asString)) {
      throw new Error("Scientific notation is not supported for monetary values");
    }
    return roundATO(asString);
  }
  const { sign, dollars, fraction } = parseDecimalInput(value);
  const centDigits = (fraction + "00").slice(0, 3);
  const centsPortion = BigInt(centDigits.slice(0, 2));
  const roundingDigit = Number(centDigits[2] ?? "0");
  let cents = BigInt(dollars) * 100n + centsPortion;
  if (roundingDigit >= 5) {
    cents += 1n;
  }
  return fromCents(sign * cents);
}

export function expectMoneyCents(value: unknown, field: string): MoneyCents {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new Error(`${field} must be integer cents`);
    }
    return fromCents(value);
  }
  if (typeof value === "bigint") {
    return fromCents(value);
  }
  if (typeof value === "string") {
    if (!/^[-+]?\d+$/.test(value.trim())) {
      throw new Error(`${field} must be an integer cents string`);
    }
    return fromCents(value);
  }
  throw new Error(`${field} must be provided as integer cents`);
}

export function formatDollars(amount: MoneyCents): string {
  const cents = BigInt(toCents(amount));
  const sign = cents < 0 ? "-" : "";
  const abs = cents < 0 ? -cents : cents;
  const dollars = abs / 100n;
  const remainder = abs % 100n;
  return `${sign}${dollars}.${remainder.toString().padStart(2, "0")}`;
}
