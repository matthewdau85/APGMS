import type { EvidenceSegment, PaygiQuarterResult, PaygiSummary } from "./types";

class PaygiStore {
  private readonly storage: Map<string, Map<string, PaygiQuarterResult>> = new Map();

  record(abn: string, result: PaygiQuarterResult) {
    const quarters = this.storage.get(abn) ?? new Map<string, PaygiQuarterResult>();
    quarters.set(result.period, result);
    this.storage.set(abn, quarters);
  }

  private orderedQuarters(abn: string, year?: string): PaygiQuarterResult[] {
    const quarters = this.storage.get(abn);
    if (!quarters) {
      return [];
    }
    return Array.from(quarters.values())
      .filter((item) => (year ? item.period.startsWith(year) : true))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  private buildSegments(records: PaygiQuarterResult[]): EvidenceSegment[] {
    const segments: EvidenceSegment[] = [];
    let current: EvidenceSegment | null = null;

    for (const quarter of records) {
      if (!current || current.method !== quarter.method) {
        current = {
          method: quarter.method,
          from: quarter.period,
          to: quarter.period,
          quarters: [quarter.period],
          evidence: quarter.evidence ? [quarter.evidence] : [],
        };
        segments.push(current);
      } else {
        current.to = quarter.period;
        current.quarters.push(quarter.period);
        if (quarter.evidence) {
          current.evidence.push(quarter.evidence);
        }
      }
    }

    return segments;
  }

  summary(abn: string, year?: string): PaygiSummary {
    const quarters = this.orderedQuarters(abn, year);
    const notices = quarters.reduce<Record<string, number>>((acc, quarter) => {
      if (typeof quarter.noticeAmount === "number") {
        acc[quarter.period] = quarter.noticeAmount;
      }
      return acc;
    }, {});

    return {
      quarters,
      segments: this.buildSegments(quarters),
      notices,
    };
  }
}

export const paygiStore = new PaygiStore();
