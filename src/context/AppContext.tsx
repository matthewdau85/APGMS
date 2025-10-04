import React, { createContext, useState } from "react";
import { mockPayroll, mockSales, mockBasHistory } from "../utils/mockData";
import { BASHistory } from "../types/tax";

export const AppContext = createContext<any>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [vaultBalance, setVaultBalance] = useState(10000);
  const [businessBalance, setBusinessBalance] = useState(50000);
  const [payroll, setPayroll] = useState(mockPayroll);
  const [sales, setSales] = useState(mockSales);
  const [basHistory, setBasHistory] = useState<BASHistory[]>(mockBasHistory);
  const [auditLog, setAuditLog] = useState<any[]>([]);

  return (
    <AppContext.Provider value={{
      vaultBalance, setVaultBalance,
      businessBalance, setBusinessBalance,
      payroll, setPayroll,
      sales, setSales,
      basHistory, setBasHistory,
      auditLog, setAuditLog,
    }}>
      {children}
    </AppContext.Provider>
  );
}
