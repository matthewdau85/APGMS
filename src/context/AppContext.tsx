import React, { createContext, useState } from "react";

import type { BASHistory } from "../types/tax";

type AppContextValue = {
  vaultBalance: number;
  setVaultBalance: React.Dispatch<React.SetStateAction<number>>;
  businessBalance: number;
  setBusinessBalance: React.Dispatch<React.SetStateAction<number>>;
  payroll: unknown[];
  setPayroll: React.Dispatch<React.SetStateAction<unknown[]>>;
  sales: unknown[];
  setSales: React.Dispatch<React.SetStateAction<unknown[]>>;
  basHistory: BASHistory[];
  setBasHistory: React.Dispatch<React.SetStateAction<BASHistory[]>>;
  auditLog: Array<{ timestamp: number; action: string; user: string }>;
  setAuditLog: React.Dispatch<React.SetStateAction<Array<{ timestamp: number; action: string; user: string }>>>;
};

export const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [vaultBalance, setVaultBalance] = useState(0);
  const [businessBalance, setBusinessBalance] = useState(0);
  const [payroll, setPayroll] = useState<unknown[]>([]);
  const [sales, setSales] = useState<unknown[]>([]);
  const [basHistory, setBasHistory] = useState<BASHistory[]>([]);
  const [auditLog, setAuditLog] = useState<Array<{ timestamp: number; action: string; user: string }>>([]);

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
