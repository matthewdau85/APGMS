import React, { createContext, useEffect, useMemo, useState } from "react";
import { mockPayroll, mockSales, mockBasHistory } from "../utils/mockData";
import { BASHistory, RatesVersionSummary } from "../types/tax";
import { DEFAULT_RATES_VERSION_ID } from "../domain/defaultRates";
import { getRatesVersion, setActiveRatesVersion, getActiveRatesVersionId } from "../domain/tax";

export type AppContextState = {
  vaultBalance: number;
  setVaultBalance: React.Dispatch<React.SetStateAction<number>>;
  businessBalance: number;
  setBusinessBalance: React.Dispatch<React.SetStateAction<number>>;
  payroll: typeof mockPayroll;
  setPayroll: React.Dispatch<React.SetStateAction<typeof mockPayroll>>;
  sales: typeof mockSales;
  setSales: React.Dispatch<React.SetStateAction<typeof mockSales>>;
  basHistory: BASHistory[];
  setBasHistory: React.Dispatch<React.SetStateAction<BASHistory[]>>;
  auditLog: any[];
  setAuditLog: React.Dispatch<React.SetStateAction<any[]>>;
  ratesVersion: RatesVersionSummary & { checksum?: string };
  setRatesVersionId: React.Dispatch<React.SetStateAction<string>>;
};

export const AppContext = createContext<AppContextState | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [vaultBalance, setVaultBalance] = useState(10000);
  const [businessBalance, setBusinessBalance] = useState(50000);
  const [payroll, setPayroll] = useState(mockPayroll);
  const [sales, setSales] = useState(mockSales);
  const [basHistory, setBasHistory] = useState<BASHistory[]>(mockBasHistory);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [ratesVersionId, setRatesVersionId] = useState(
    () => getActiveRatesVersionId() ?? DEFAULT_RATES_VERSION_ID
  );

  useEffect(() => {
    setActiveRatesVersion(ratesVersionId);
  }, [ratesVersionId]);

  const ratesVersion = useMemo(() => {
    const version = getRatesVersion(ratesVersionId);
    return {
      id: ratesVersionId,
      name: version.name,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo ?? null,
      checksum: version.checksum,
      gstRateBasisPoints: version.gstRateBasisPoints,
    } satisfies RatesVersionSummary & { checksum?: string };
  }, [ratesVersionId]);

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
        ratesVersion,
        setRatesVersionId,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
