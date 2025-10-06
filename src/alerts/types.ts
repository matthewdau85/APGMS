// src/alerts/types.ts
export type AlertCode = "OVERDUE_BAS" | "OWA_SHORTFALL" | "RECON_ANOMALY";

export type AlertSeverity = "info" | "warning" | "critical";

export interface DashboardAlert {
  id: number;
  abn: string;
  taxType: string | null;
  periodId: string | null;
  code: AlertCode;
  message: string;
  severity: AlertSeverity;
  detectedAt: string;
  details: Record<string, unknown>;
}
