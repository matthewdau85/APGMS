export interface StpEvent {
  employee_id_hash: string;
  period: string;
  gross: number;
  tax_withheld: number;
  allowances?: number;
  stsl_flags?: string[];
}

export interface PosEvent {
  txn_id: string;
  dt: string;
  net: number;
  gst: number;
  category: string;
  source: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function ensureArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return undefined;
  if (!value.every((item) => typeof item === "string")) return undefined;
  return value as string[];
}

export function parseStpEvent(input: unknown): { success: true; data: StpEvent } | { success: false; errors: string[] } {
  const errors: string[] = [];
  const candidate = input as Partial<StpEvent>;
  if (!isString(candidate.employee_id_hash) || candidate.employee_id_hash.length < 6) {
    errors.push("employee_id_hash must be a string of length >= 6");
  }
  if (!isString(candidate.period) || candidate.period.length < 4) {
    errors.push("period must be a non-empty string");
  }
  if (!isFiniteNumber(candidate.gross)) {
    errors.push("gross must be numeric");
  }
  if (!isFiniteNumber(candidate.tax_withheld)) {
    errors.push("tax_withheld must be numeric");
  }
  let allowances = 0;
  if (candidate.allowances !== undefined) {
    if (!isFiniteNumber(candidate.allowances)) {
      errors.push("allowances must be numeric when provided");
    } else {
      allowances = candidate.allowances;
    }
  }
  const stsl_flags = ensureArray(candidate.stsl_flags) ?? [];
  if (candidate.stsl_flags !== undefined && stsl_flags.length === 0 && (candidate.stsl_flags as unknown[]).length > 0) {
    errors.push("stsl_flags must be an array of strings");
  }
  if (errors.length > 0) {
    return { success: false, errors };
  }
  return {
    success: true,
    data: {
      employee_id_hash: candidate.employee_id_hash!,
      period: candidate.period!,
      gross: candidate.gross!,
      tax_withheld: candidate.tax_withheld!,
      allowances,
      stsl_flags,
    },
  };
}

export function parsePosEvent(input: unknown): { success: true; data: PosEvent } | { success: false; errors: string[] } {
  const errors: string[] = [];
  const candidate = input as Partial<PosEvent>;
  if (!isString(candidate.txn_id) || candidate.txn_id.length < 4) {
    errors.push("txn_id must be a string of length >= 4");
  }
  if (!isString(candidate.dt)) {
    errors.push("dt must be an ISO date string");
  }
  if (!isFiniteNumber(candidate.net)) {
    errors.push("net must be numeric");
  }
  if (!isFiniteNumber(candidate.gst)) {
    errors.push("gst must be numeric");
  }
  if (!isString(candidate.category) || candidate.category.length < 2) {
    errors.push("category must be a string");
  }
  if (!isString(candidate.source) || candidate.source.length < 2) {
    errors.push("source must be a string");
  }
  if (errors.length > 0) {
    return { success: false, errors };
  }
  return {
    success: true,
    data: {
      txn_id: candidate.txn_id!,
      dt: candidate.dt!,
      net: candidate.net!,
      gst: candidate.gst!,
      category: candidate.category!,
      source: candidate.source!,
    },
  };
}
