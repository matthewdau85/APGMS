export type PaygwInput = {
  employeeName: string;
  grossIncome: number;
  taxWithheld: number;
  period: "weekly" | "fortnightly" | "monthly" | "quarterly";
  deductions?: number;
};

export type GstInput = {
  saleAmount: number;
  exempt?: boolean;
};

export type TaxReport = {
  paygwLiability: number;
  gstPayable: number;
  totalPayable: number;
  discrepancies?: string[];
  complianceStatus: "OK" | "WARNING" | "ALERT";
};

export type BASHistory = {
  period: Date;
  paygwPaid: number;
  gstPaid: number;
  status: "On Time" | "Late" | "Partial";
  daysLate: number;
  penalties: number;
};

export type PaymentPlanType = {
  totalAmount: number;
  installments: number;
  frequency: "weekly" | "fortnightly" | "monthly";
  startDate: Date;
  atoApproved: boolean;
};

export type RatesVersionSummary = {
  id: string;
  name: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  checksum?: string;
  gstRateBasisPoints: number;
};
