export function parsePeriodId(periodId: string): Date {
  const quarterMatch = periodId.match(/^(\d{4})Q([1-4])$/);
  if (quarterMatch) {
    const year = Number(quarterMatch[1]);
    const quarter = Number(quarterMatch[2]);
    const month = quarter * 3; // end month of quarter (1-indexed)
    return new Date(Date.UTC(year, month, 0));
  }
  const monthMatch = periodId.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = Number(monthMatch[1]);
    const month = Number(monthMatch[2]);
    return new Date(Date.UTC(year, month, 0));
  }
  const ts = Date.parse(periodId);
  if (!Number.isNaN(ts)) {
    return new Date(ts);
  }
  return new Date();
}

export function formatPeriod(periodId: string): string {
  const date = parsePeriodId(periodId);
  return new Intl.DateTimeFormat("en-AU", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function computeNextDueDate(periodId: string): Date {
  const periodEnd = parsePeriodId(periodId);
  const due = new Date(periodEnd.getTime());
  due.setMonth(due.getMonth() + 1);
  due.setDate(due.getDate() + 28);
  return due;
}
