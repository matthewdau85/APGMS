import React, { createContext, useState } from "react";
import { demoDataClient } from "../clients/dataClient";
import { BASHistory } from "../types/tax";

type PayrollEntry = ReturnType<typeof demoDataClient.getPayroll>[number];
type SalesEntry = ReturnType<typeof demoDataClient.getSales>[number];

export const AppContext = createContext<any>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [vaultBalance, setVaultBalance] = useState(10000);
  const [businessBalance, setBusinessBalance] = useState(50000);
  const [payroll, setPayroll] = useState<PayrollEntry[]>(demoDataClient.getPayroll());
  const [sales, setSales] = useState<SalesEntry[]>(demoDataClient.getSales());
  const [basHistory, setBasHistory] = useState<BASHistory[]>(demoDataClient.getBasHistory());
  const [auditLog, setAuditLog] = useState<any[]>([]);

  return (
    <AppContext.Provider
      value={{
        vaultBalance,
        setVaultBalance,
        businessBalance,
        setBusinessBalance,
        payroll,
        setPayroll,
        sales,
        setSales,
        basHistory,
        setBasHistory,
        auditLog,
        setAuditLog,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
