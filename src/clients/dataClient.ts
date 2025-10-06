import { mockBasHistory, mockPayroll, mockSales } from "../utils/mockData";
import type { BASHistory } from "../types/tax";

type PayrollEntry = typeof mockPayroll[number];
type SalesEntry = typeof mockSales[number];

export interface DemoDataClient {
  getPayroll(): PayrollEntry[];
  getSales(): SalesEntry[];
  getBasHistory(): BASHistory[];
}

class StaticDataClient implements DemoDataClient {
  getPayroll(): PayrollEntry[] {
    return mockPayroll.map(p => ({ ...p }));
  }

  getSales(): SalesEntry[] {
    return mockSales.map(s => ({ ...s }));
  }

  getBasHistory(): BASHistory[] {
    return mockBasHistory.map(item => ({ ...item }));
  }
}

export const demoDataClient: DemoDataClient = new StaticDataClient();
