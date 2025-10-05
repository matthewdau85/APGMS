import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { mockPayroll, mockSales, mockBasHistory } from "../utils/mockData";
import { BASHistory } from "../types/tax";
import { AdapterEvent, AdapterMode, AdapterModes, AdapterName } from "../simulator/types";
import { SimulatorClient } from "../../libs/simulatorClient";

export const AppContext = createContext<any>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [vaultBalance, setVaultBalance] = useState(10000);
  const [businessBalance, setBusinessBalance] = useState(50000);
  const [payroll, setPayroll] = useState(mockPayroll);
  const [sales, setSales] = useState(mockSales);
  const [basHistory, setBasHistory] = useState<BASHistory[]>(mockBasHistory);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [adapterModes, setAdapterModes] = useState<AdapterModes>({
    bank: "success",
    payto: "success",
    payroll: "success",
    pos: "success",
  });
  const [adapterEvents, setAdapterEvents] = useState<AdapterEvent[]>([]);

  const logAdapterEvent = useCallback(
    (adapter: AdapterName, mode: AdapterMode, payload: unknown, result: { response?: unknown; error?: string }) => {
      setAdapterEvents(prev => {
        const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${adapter}-${Date.now()}`;
        const next: AdapterEvent = {
          id,
          ts: Date.now(),
          adapter,
          mode,
          payload,
          response: result.response,
          error: result.error,
        };
        return [next, ...prev].slice(0, 50);
      });
    },
    []
  );

  const syncModes = useCallback(async () => {
    try {
      const modes = await SimulatorClient.fetchModes();
      if (modes) setAdapterModes(prev => ({ ...prev, ...modes }));
    } catch (err) {
      console.warn("Failed to sync simulator modes", err);
    }
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      syncModes();
    }
  }, [syncModes]);

  const setAdapterMode = useCallback(
    async (adapter: AdapterName, mode: AdapterMode) => {
      setAdapterModes(prev => ({ ...prev, [adapter]: mode }));
      if (adapter === "bank" || adapter === "payto") {
        try {
          const modes = await SimulatorClient.updateMode(adapter, mode);
          if (modes) setAdapterModes(prev => ({ ...prev, ...modes }));
        } catch (err) {
          console.error("Failed to update simulator adapter mode", err);
        }
      }
    },
    []
  );

  const simulatorContext = useMemo(
    () => ({ adapterModes, setAdapterMode, logAdapterEvent, adapterEvents }),
    [adapterModes, setAdapterMode, logAdapterEvent, adapterEvents]
  );

  return (
    <AppContext.Provider value={{
      vaultBalance, setVaultBalance,
      businessBalance, setBusinessBalance,
      payroll, setPayroll,
      sales, setSales,
      basHistory, setBasHistory,
      auditLog, setAuditLog,
      ...simulatorContext,
    }}>
      {children}
    </AppContext.Provider>
  );
}
