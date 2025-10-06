import type { Request, Response } from "express";

type PeriodSummary = {
  id: string;
  abn: string;
  taxType: "GST" | "PAYGW";
  periodLabel: string;
  lodgmentsUpToDate: boolean;
  paymentsUpToDate: boolean;
  complianceScore: number;
  lastBasLodgedAt: string;
  nextDueAt: string;
  outstandingLodgments: string[];
  outstandingAmounts: string[];
  bas: {
    W1: number;
    W2: number;
    G1: number;
    "1A": number;
    "1B": number;
  };
};

const periods: Record<string, PeriodSummary> = {
  "2025-Q2": {
    id: "2025-Q2",
    abn: "12345678901",
    taxType: "GST",
    periodLabel: "Q2 FY24-25",
    lodgmentsUpToDate: false,
    paymentsUpToDate: false,
    complianceScore: 65,
    lastBasLodgedAt: "2025-05-29",
    nextDueAt: "2025-07-28",
    outstandingLodgments: ["Q4 FY23-24"],
    outstandingAmounts: ["$1,200 PAYGW", "$400 GST"],
    bas: {
      W1: 750000,
      W2: 185000,
      G1: 2500000,
      "1A": 250000,
      "1B": 45000,
    },
  },
};

export function listPeriods(_req: Request, res: Response) {
  res.json({ periods: Object.values(periods) });
}

export function getPeriod(req: Request, res: Response) {
  const { id } = req.params;
  const period = periods[id];
  if (!period) {
    return res.status(404).json({
      error: "NOT_FOUND",
      message: `Unknown period: ${id}`,
    });
  }
  res.json(period);
}
