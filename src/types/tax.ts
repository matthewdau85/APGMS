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
  classification?: GstSupplyCategory;
};

export type GstSupplyCategory = "taxable" | "gst_free" | "input_taxed" | "export";

export type GstEventClassification =
  | "taxable"
  | "gst_free"
  | "input_taxed"
  | "adjustment"
  | "mixed";

export type AccountingBasis = "cash" | "accrual";

export type BasLabel =
  | "G1"
  | "G2"
  | "G3"
  | "G4"
  | "G5"
  | "G6"
  | "G7"
  | "G8"
  | "G9"
  | "G10"
  | "G11"
  | "G12"
  | "G13"
  | "G14";

export type BasLabelTotals = Record<BasLabel, number>;

export type ReportingPeriod = {
  start: Date | string;
  end: Date | string;
  basis: AccountingBasis;
};

export type PurchaseCredit = {
  reference: string;
  creditDate: Date | string;
  amount: number;
  gstAmount: number;
  reason?: string;
};

export type AdjustmentNote = {
  reference: string;
  date: Date | string;
  amount: number;
  gstAmount: number;
  direction: "increasing" | "decreasing";
  target: "sales" | "purchases";
  reason?: string;
};

export type GstComponent = {
  category: GstSupplyCategory;
  amount: number;
  gstAmount?: number;
  description?: string;
  capital?: boolean;
  forInputTaxedSales?: boolean;
  importation?: boolean;
};

export type GstTransactionBase = {
  id: string;
  issueDate: Date | string;
  paymentDate?: Date | string;
  components: GstComponent[];
  purchaseCredits?: PurchaseCredit[];
};

export type GstSale = GstTransactionBase & {
  kind: "sale";
};

export type GstPurchase = GstTransactionBase & {
  kind: "purchase";
  claimable: boolean;
};

export type GstAdjustment = {
  kind: "adjustment";
  note: AdjustmentNote;
};

export type GstEvent = GstSale | GstPurchase | GstAdjustment;

export type BasSummary = {
  period: ReportingPeriod;
  basis: AccountingBasis;
  labels: BasLabelTotals;
  gstCollected: number;
  gstCredits: number;
  netAmount: number;
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
