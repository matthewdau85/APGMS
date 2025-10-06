// Auto-generated via scripts/client-gen.ts
/* eslint-disable */

export type ConsoleOutstandingAmount = {
  taxType: string;
  amountCents: number;
  description?: string | null;
};

export type ConsoleComplianceSnapshot = {
  lodgmentsUpToDate: boolean;
  paymentsUpToDate: boolean;
  overallCompliance: number;
  lastBasLodged: string;
  nextDueDate: string;
  outstandingLodgments: string[];
  outstandingAmounts: components["schemas"]["ConsoleOutstandingAmount"][];
};

export type ConsoleDashboardResponse = {
  summary: components["schemas"]["ConsoleComplianceSnapshot"];
};

export type ConsoleBasLineItem = {
  code: string;
  label: string;
  amountCents: number;
};

export type ConsoleBasHistoryEntry = {
  period: string;
  paygwPaidCents: number;
  gstPaidCents: number;
  status: "On Time" | "Late" | "Partial";
  daysLate: number;
  penaltiesCents: number;
};

export type ConsoleBasResponse = {
  compliance: components["schemas"]["ConsoleComplianceSnapshot"];
  currentPeriod: {
    period: string;
    lineItems: components["schemas"]["ConsoleBasLineItem"][];
  };
  history: components["schemas"]["ConsoleBasHistoryEntry"][];
};

export type ConsoleAccount = {
  id: string;
  name: string;
  bsb: string;
  accountNumber: string;
  type: string;
};

export type ConsoleTransfer = {
  id: string;
  type: string;
  amountCents: number;
  frequency: "weekly" | "fortnightly" | "monthly";
  nextRun: string;
};

export type ConsoleSettingsResponse = {
  profile: {
    abn: string;
    legalName: string;
    tradingName: string;
    contacts: {
      email: string;
      phone?: string | null;
    };
  };
  accounts: components["schemas"]["ConsoleAccount"][];
  payrollProviders: string[];
  salesChannels: string[];
  transfers: components["schemas"]["ConsoleTransfer"][];
  security: {
    twoFactor: boolean;
    smsAlerts: boolean;
  };
  notifications: {
    emailReminders: boolean;
    smsLodgmentReminders: boolean;
  };
};

export type ConsoleAuditEntry = {
  id: string;
  occurredAt: string;
  actor: string;
  action: string;
};

export type ConsoleAuditResponse = {
  entries: components["schemas"]["ConsoleAuditEntry"][];
};

export interface components {
  schemas: {
    ConsoleOutstandingAmount: ConsoleOutstandingAmount;
    ConsoleComplianceSnapshot: ConsoleComplianceSnapshot;
    ConsoleDashboardResponse: ConsoleDashboardResponse;
    ConsoleBasLineItem: ConsoleBasLineItem;
    ConsoleBasHistoryEntry: ConsoleBasHistoryEntry;
    ConsoleBasResponse: ConsoleBasResponse;
    ConsoleAccount: ConsoleAccount;
    ConsoleTransfer: ConsoleTransfer;
    ConsoleSettingsResponse: ConsoleSettingsResponse;
    ConsoleAuditEntry: ConsoleAuditEntry;
    ConsoleAuditResponse: ConsoleAuditResponse;
  };
  responses: Record<string, never>;
  parameters: Record<string, never>;
  requestBodies: Record<string, never>;
}

export interface paths {
  "/api/console/dashboard": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["ConsoleDashboardResponse"];
          };
        };
      };
    };
  };
  "/api/console/bas": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["ConsoleBasResponse"];
          };
        };
      };
    };
  };
  "/api/console/settings": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["ConsoleSettingsResponse"];
          };
        };
      };
    };
  };
  "/api/console/audit": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["ConsoleAuditResponse"];
          };
        };
      };
    };
  };
}
