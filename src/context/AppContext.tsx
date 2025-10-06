import React, { createContext, useState } from "react";
import { BASHistory } from "../types/tax";

export const AppContext = createContext<any>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [vaultBalance, setVaultBalance] = useState(0);
  const [businessBalance, setBusinessBalance] = useState(0);
  const [payroll, setPayroll] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [basHistory, setBasHistory] = useState<BASHistory[]>([]);
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
