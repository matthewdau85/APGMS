import React, { createContext, useState } from "react";
import { mockPayroll, mockSales, mockBasHistory } from "../utils/mockData";
import { BASHistory } from "../types/tax";

export type AppMode = "dev" | "stage" | "prod";

type FeatureFlags = Record<string, boolean>;

type KeyMetadata = {
  purpose: string;
  kid: string;
  rotationDue: string;
};

type RuleManifest = {
  id: string;
  revision: string;
  publishedAt: string;
  checksum: string;
  notes?: string;
};

type AppContextShape = {
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
  appMode: AppMode;
  setAppMode: React.Dispatch<React.SetStateAction<AppMode>>;
  featureFlags: FeatureFlags;
  setFeatureFlags: React.Dispatch<React.SetStateAction<FeatureFlags>>;
  ratesVersion: string;
  keyMetadata: KeyMetadata[];
  ruleManifest: RuleManifest;
};

export const AppContext = createContext<AppContextShape>({} as AppContextShape);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [vaultBalance, setVaultBalance] = useState(10000);
  const [businessBalance, setBusinessBalance] = useState(50000);
  const [payroll, setPayroll] = useState(mockPayroll);
  const [sales, setSales] = useState(mockSales);
  const [basHistory, setBasHistory] = useState<BASHistory[]>(mockBasHistory);
  const [auditLog, setAuditLog] = useState<any[]>([]);
  const [appMode, setAppMode] = useState<AppMode>("stage");
  const [featureFlags, setFeatureFlags] = useState<FeatureFlags>({
    FEATURE_SMART_ROUTING: true,
    FEATURE_RISK_SCORING: true,
    FEATURE_SETTLEMENT_BATCHING: false,
    FEATURE_SHADOW_SETTLEMENT: false,
    FEATURE_RULE_MANIFEST_SYNC: true,
    DRY_RUN_PAYMENTS: false,
    DRY_RUN_NOTIFICATIONS: true,
  });
  const [ratesVersion] = useState("2025.09-r1");
  const [keyMetadata] = useState<KeyMetadata[]>([
    {
      purpose: "Primary signing key",
      kid: "kid-live-2024-10",
      rotationDue: "2025-12-31",
    },
    {
      purpose: "Shadow settlement key",
      kid: "kid-shadow-2025-01",
      rotationDue: "2025-08-15",
    },
  ]);
  const [ruleManifest] = useState<RuleManifest>({
    id: "gst-lodgement",
    revision: "2025.10.0",
    publishedAt: "2025-10-01T02:45:00Z",
    checksum: "8b6f2fa4",
    notes: "Latest settlement risk filters synced from rules service.",
  });

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
        appMode,
        setAppMode,
        featureFlags,
        setFeatureFlags,
        ratesVersion,
        keyMetadata,
        ruleManifest,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
