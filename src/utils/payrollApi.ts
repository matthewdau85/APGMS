import { withApiErrorToast } from "./apiClient";

export interface PayrollSummary {
  employees: number;
  totalWages: number;
  superAccrued: number;
}

export const fetchPayrollSummary = withApiErrorToast("Payroll summary", async (): Promise<PayrollSummary> => ({
  employees: 0,
  totalWages: 0,
  superAccrued: 0,
}));
