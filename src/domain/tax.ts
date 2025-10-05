export interface PaygwBracket {
  minCents: number;
  maxCents: number | null;
  baseTaxCents: number;
  rateBasisPoints: number;
}

export interface PenaltyConfig {
  penaltyUnitCents: number;
  unitMultiplier: number;
  daysPerUnit: number;
  maxUnits: number;
  gicDailyRateBasisPoints: number;
  gicCapBasisPoints?: number;
  totalCapBasisPoints?: number;
}

export interface RatesVersion {
  name: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  paygwBrackets: PaygwBracket[];
  gstRateBasisPoints: number;
  penaltyConfig: PenaltyConfig;
  checksum?: string;
}

const registry = new Map<string, RatesVersion>();
let activeVersionId: string | null = null;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
}

export function registerRatesVersion(versionId: string, version: RatesVersion): void {
  if (!versionId) throw new Error("versionId required");
  if (!version) throw new Error("version definition required");
  if (!Array.isArray(version.paygwBrackets) || version.paygwBrackets.length === 0) {
    throw new Error("paygwBrackets must contain at least one bracket");
  }
  version.paygwBrackets.forEach((bracket, idx) => {
    if (idx > 0 && bracket.minCents < version.paygwBrackets[idx - 1].minCents) {
      throw new Error("paygwBrackets must be sorted by minCents");
    }
    assertFinite(bracket.minCents, `paygw bracket ${idx} minCents`);
    if (bracket.maxCents !== null) {
      assertFinite(bracket.maxCents, `paygw bracket ${idx} maxCents`);
    }
    assertFinite(bracket.baseTaxCents, `paygw bracket ${idx} baseTaxCents`);
    assertFinite(bracket.rateBasisPoints, `paygw bracket ${idx} rateBasisPoints`);
  });
  registry.set(versionId, {
    ...version,
    paygwBrackets: version.paygwBrackets.map(b => ({ ...b })),
    penaltyConfig: { ...version.penaltyConfig },
  });
}

export function listRatesVersions(): Array<{ id: string } & RatesVersion> {
  return Array.from(registry.entries()).map(([id, version]) => ({ id, ...version }));
}

export function setActiveRatesVersion(versionId: string): void {
  if (!registry.has(versionId)) {
    throw new Error(`rates version ${versionId} is not registered`);
  }
  activeVersionId = versionId;
}

export function getActiveRatesVersionId(): string | null {
  return activeVersionId;
}

export function getRatesVersion(versionId: string): RatesVersion {
  const version = registry.get(versionId);
  if (!version) {
    throw new Error(`rates version ${versionId} is not registered`);
  }
  return {
    ...version,
    paygwBrackets: version.paygwBrackets.map(b => ({ ...b })),
    penaltyConfig: { ...version.penaltyConfig },
  };
}

function resolveVersionId(versionId?: string | null): string {
  const resolved = versionId ?? activeVersionId;
  if (!resolved) {
    throw new Error("no active rates version set");
  }
  if (!registry.has(resolved)) {
    throw new Error(`rates version ${resolved} is not registered`);
  }
  return resolved;
}

export function calcPAYGW(incomeCents: number, versionId?: string | null): number {
  if (!Number.isFinite(incomeCents) || incomeCents <= 0) {
    return 0;
  }
  const resolved = resolveVersionId(versionId);
  const { paygwBrackets } = registry.get(resolved)!;
  let left = 0;
  let right = paygwBrackets.length - 1;
  let bracket = paygwBrackets[right];

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    const current = paygwBrackets[mid];
    const max = current.maxCents ?? Number.MAX_SAFE_INTEGER;
    if (incomeCents < current.minCents) {
      right = mid - 1;
    } else if (incomeCents > max) {
      left = mid + 1;
    } else {
      bracket = current;
      break;
    }
  }

  const taxable = Math.max(0, incomeCents - bracket.minCents);
  const marginal = Math.round((taxable * bracket.rateBasisPoints) / 10000);
  return bracket.baseTaxCents + marginal;
}

export function calcGST(netCents: number, versionId?: string | null): number {
  if (!Number.isFinite(netCents) || netCents <= 0) {
    return 0;
  }
  const resolved = resolveVersionId(versionId);
  const { gstRateBasisPoints } = registry.get(resolved)!;
  return Math.round((netCents * gstRateBasisPoints) / 10000);
}

export function calcPenalty(daysLate: number, amountCents: number, versionId?: string | null): number {
  if (!Number.isFinite(daysLate) || daysLate <= 0) {
    return 0;
  }
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    return 0;
  }
  const resolved = resolveVersionId(versionId);
  const { penaltyConfig } = registry.get(resolved)!;
  const cleanDays = Math.ceil(daysLate);
  const cleanAmount = Math.round(amountCents);

  const blocks = Math.ceil(cleanDays / penaltyConfig.daysPerUnit);
  const rawUnits = blocks * penaltyConfig.unitMultiplier;
  const cappedUnits = Math.min(rawUnits, penaltyConfig.maxUnits);
  const ftlPenalty = cappedUnits * penaltyConfig.penaltyUnitCents;

  const dailyRate = penaltyConfig.gicDailyRateBasisPoints / 10000;
  const rawGic = Math.round(cleanAmount * dailyRate * cleanDays);
  const gicCap = penaltyConfig.gicCapBasisPoints !== undefined
    ? Math.round((cleanAmount * penaltyConfig.gicCapBasisPoints) / 10000)
    : rawGic;
  const gicPenalty = Math.min(rawGic, gicCap);

  let total = ftlPenalty + gicPenalty;
  if (penaltyConfig.totalCapBasisPoints !== undefined) {
    const totalCap = Math.round((cleanAmount * penaltyConfig.totalCapBasisPoints) / 10000);
    total = Math.min(total, totalCap);
  }
  return total;
}
