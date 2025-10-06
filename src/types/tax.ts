export type PaygwInput = {
  employeeName: string;
  grossIncome: number;
  taxWithheld: number;
  period: "weekly" | "fortnightly" | "monthly" | "quarterly";
  deductions?: number;
  scheduleVersion?: string;
};

export type PaygwCalculation = {
  scheduleVersion: string;
  effectiveFrom: string;
  source: string;
  period: PaygwInput["period"];
  grossIncome: number;
  deductions: number;
  taxableIncomePerPeriod: number;
  annualTaxableIncome: number;
  annualTaxBeforeOffsets: number;
  lowIncomeTaxOffset: number;
  annualTaxAfterOffsets: number;
  recommendedWithholding: number;
  amountAlreadyWithheld: number;
  outstandingLiability: number;
  basLabels: {
    W1: number;
    W2: number;
  };
};

export type GstInput = {
  saleAmount: number;
  exempt?: boolean;
  purchaseAmount?: number;
};

export type GstCalculation = {
  taxableSales: number;
  creditablePurchases: number;
  gstOnSales: number;
  gstOnPurchases: number;
  netGst: number;
  basLabels: {
    G1: number;
    "1A": number;
    "1B": number;
  };
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
