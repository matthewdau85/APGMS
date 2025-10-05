export type PeriodRecord = Record<string, any>;

export interface StatusInfo {
  bool: boolean | null;
  label: string | null;
}

export interface ComplianceSummary {
  lodgments: StatusInfo;
  payments: StatusInfo;
  complianceScore: number | null;
  complianceLabel: string | null;
  lastBAS: string | null;
  nextDue: string | null;
  outstandingLodgments: string[];
  outstandingAmounts: string[];
}

export const DEFAULT_ABN = "12345678901";

export function getPeriodList(data: any): PeriodRecord[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as PeriodRecord[];
  if (Array.isArray(data?.periods)) return data.periods as PeriodRecord[];
  if (Array.isArray(data?.data)) return data.data as PeriodRecord[];
  if (Array.isArray(data?.items)) return data.items as PeriodRecord[];
  return [];
}

export function getPeriodSortValue(period: PeriodRecord): number {
  const due = parseDateValue(period.due_at ?? period.due_date ?? period.dueOn ?? period.next_due);
  if (due != null) return due;
  const end = parseDateValue(period.end_at ?? period.end_date ?? period.period_end);
  if (end != null) return end;
  const key = parsePeriodKey(period.period_id ?? period.periodId ?? period.id);
  return key ?? 0;
}

export function buildComplianceSummary(
  periodsData: any,
  balanceData: any,
  gateData: any,
  periodList: PeriodRecord[]
): ComplianceSummary {
  const summarySource = periodsData?.summary ?? periodsData?.overview ?? periodsData?.compliance ?? periodsData;
  const balanceSource = balanceData?.summary ?? balanceData?.data ?? balanceData;
  const gateSource = gateData ?? {};

  const outstandingLodgments = collectStrings(
    summarySource?.outstanding_lodgments,
    summarySource?.outstandingLodgments,
    summarySource?.lodgments_overdue,
    summarySource?.lodgments?.outstanding
  );

  if (outstandingLodgments.length === 0) {
    const pending = periodList
      .filter(item => interpretStatusValue(item.lodgment_status ?? item.lodged ?? item.state ?? item.lodgmentState).bool === false)
      .map(item => formatPeriodLabel(item));
    outstandingLodgments.push(...pending);
  }

  const outstandingAmounts = collectAmounts(
    summarySource?.outstanding_amounts,
    summarySource?.outstandingAmounts,
    summarySource?.payments?.outstanding,
    balanceSource?.outstanding,
    balanceSource?.outstanding_amounts,
    balanceSource?.outstandingAmounts
  );

  const lodgmentCandidate = summarySource?.lodgments_up_to_date ?? summarySource?.lodgment_status ?? gateSource?.lodgments_up_to_date ?? gateSource?.lodgment_status;
  const paymentCandidate = summarySource?.payments_up_to_date ?? summarySource?.payments_status ?? balanceSource?.payments_up_to_date ?? balanceSource?.payments_status ?? gateSource?.payments_up_to_date;

  const lodgments = interpretStatusValue(lodgmentCandidate);
  const payments = interpretStatusValue(paymentCandidate);

  if (lodgments.bool == null) {
    if (outstandingLodgments.length > 0) lodgments.bool = false;
    else if (periodList.length > 0) lodgments.bool = true;
  }
  if (!lodgments.label) {
    if (lodgments.bool === true) lodgments.label = "Up to date ✅";
    if (lodgments.bool === false) lodgments.label = "Outstanding";
  }

  if (payments.bool == null) {
    if (outstandingAmounts.length > 0) payments.bool = false;
    else if (balanceSource) payments.bool = true;
  }
  if (!payments.label) {
    if (payments.bool === true) payments.label = "All paid ✅";
    if (payments.bool === false) payments.label = "Outstanding";
  }

  const complianceScore = parseComplianceNumber(
    summarySource?.overall_compliance ?? summarySource?.compliance_score ?? gateSource?.compliance_score ?? balanceSource?.overall_compliance
  );

  const complianceLabel = pickFirstString(
    summarySource?.compliance_label,
    summarySource?.overall_status,
    gateSource?.status,
    gateSource?.message,
    balanceSource?.status
  );

  const lastBAS = pickFirstString(
    summarySource?.last_lodged,
    summarySource?.last_bas,
    summarySource?.lastBAS,
    summarySource?.lastLodged,
    formatDateCandidate(findLatestLodgedDate(periodList))
  );

  const nextDue = pickFirstString(
    summarySource?.next_due,
    summarySource?.nextDue,
    summarySource?.next_due_date,
    summarySource?.upcoming_due,
    formatDateCandidate(findNextDueDate(periodList))
  );

  return {
    lodgments,
    payments,
    complianceScore,
    complianceLabel,
    lastBAS,
    nextDue,
    outstandingLodgments: Array.from(new Set(outstandingLodgments)),
    outstandingAmounts: Array.from(new Set(outstandingAmounts))
  };
}

export function statusClass(status: boolean | null): string {
  if (status === true) return "text-green-600";
  if (status === false) return "text-red-600";
  return "text-gray-500";
}

export function formatAmountCandidate(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return formatCurrency(value);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    if (obj.amount_cents != null) {
      const num = Number(obj.amount_cents);
      if (Number.isFinite(num)) return formatCurrency(num / 100);
    }
    if (obj.amount != null) {
      const num = Number(obj.amount);
      if (Number.isFinite(num)) return formatCurrency(num);
    }
    if (obj.value != null) {
      const formatted = formatAmountCandidate(obj.value);
      if (formatted) return formatted;
    }
    if (typeof obj.label === "string") return obj.label;
  }
  return null;
}

export function formatDateCandidate(timestamp: number | null): string | null {
  if (timestamp == null) return null;
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-AU", { year: "numeric", month: "short", day: "numeric" });
}

export function findLatestLodgedDate(periodList: PeriodRecord[]): number | null {
  let latest: number | null = null;
  periodList.forEach(item => {
    const candidate = parseDateValue(item.lodged_at ?? item.lodgedAt ?? item.lodged_on ?? item.lodgment_date);
    if (candidate != null && (latest == null || candidate > latest)) {
      latest = candidate;
    }
  });
  return latest;
}

export function findNextDueDate(periodList: PeriodRecord[]): number | null {
  const now = Date.now();
  let nextFuture: number | null = null;
  let latest: number | null = null;
  periodList.forEach(item => {
    const due = parseDateValue(item.next_due ?? item.due_at ?? item.due_date ?? item.dueOn);
    if (due == null) return;
    if (due >= now && (nextFuture == null || due < nextFuture)) {
      nextFuture = due;
    }
    if (latest == null || due > latest) {
      latest = due;
    }
  });
  return nextFuture ?? latest;
}

export function interpretStatusValue(value: unknown): StatusInfo {
  const info: StatusInfo = { bool: null, label: null };
  if (value == null) return info;
  if (typeof value === "boolean") {
    info.bool = value;
    info.label = value ? "Up to date ✅" : "Needs attention ❌";
    return info;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return info;
    info.label = trimmed;
    const lower = trimmed.toLowerCase();
    const goodTokens = ["up to date", "complete", "ok", "paid", "current", "released", "ready", "clear", "passed"];
    const badTokens = ["overdue", "outstanding", "due", "late", "blocked", "failed", "missing", "pending", "hold"];
    if (goodTokens.some(token => lower.includes(token))) info.bool = true;
    else if (badTokens.some(token => lower.includes(token))) info.bool = false;
    return info;
  }
  if (typeof value === "number") {
    info.label = value === 0 ? "No outstanding" : String(value);
    if (value === 0) info.bool = true;
    if (value > 0) info.bool = false;
    return info;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    if (obj.value != null) return interpretStatusValue(obj.value);
    if (obj.status != null) return interpretStatusValue(obj.status);
    if (obj.state != null) return interpretStatusValue(obj.state);
  }
  return info;
}

export function parseComplianceNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.\-]/g, "");
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : null;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    if (obj.value != null) return parseComplianceNumber(obj.value);
    if (obj.score != null) return parseComplianceNumber(obj.score);
  }
  return null;
}

export function pickFirstString(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function formatPeriodLabel(period: PeriodRecord): string {
  const label = period.label ?? period.name ?? period.title ?? period.period_id ?? period.periodId ?? period.id;
  return typeof label === "string" ? label : String(label ?? "");
}

function collectStrings(...candidates: unknown[]): string[] {
  const values: string[] = [];
  candidates.forEach(candidate => {
    if (!candidate) return;
    if (Array.isArray(candidate)) {
      candidate.forEach(item => {
        const formatted = formatMaybeString(item);
        if (formatted) values.push(formatted);
      });
      return;
    }
    const formatted = formatMaybeString(candidate);
    if (formatted) values.push(formatted);
  });
  return values;
}

function collectAmounts(...candidates: unknown[]): string[] {
  const values: string[] = [];
  candidates.forEach(candidate => {
    if (!candidate) return;
    if (Array.isArray(candidate)) {
      candidate.forEach(item => {
        const formatted = formatAmountCandidate(item);
        if (formatted) values.push(formatted);
      });
      return;
    }
    const formatted = formatAmountCandidate(candidate);
    if (formatted) values.push(formatted);
  });
  return values;
}

function formatMaybeString(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const obj = value as Record<string, any>;
    if (typeof obj.label === "string") return obj.label;
    if (typeof obj.name === "string") return obj.name;
    if (typeof obj.period === "string") return obj.period;
    if (typeof obj.period_id === "string") return obj.period_id;
  }
  return null;
}

function parsePeriodKey(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ts = Date.parse(trimmed);
  if (!Number.isNaN(ts)) return ts;
  const compact = trimmed.replace(/[^0-9]/g, "");
  if (compact.length >= 6) {
    const year = Number(compact.slice(0, 4));
    const month = Number(compact.slice(4, 6));
    if (!Number.isNaN(year) && !Number.isNaN(month)) {
      return Date.UTC(year, Math.max(0, month - 1));
    }
  }
  return null;
}

function parseDateValue(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const ts = Date.parse(trimmed);
    return Number.isNaN(ts) ? null : ts;
  }
  return null;
}

function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "";
  const formatter = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
  return formatter.format(value);
}
