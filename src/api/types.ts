export interface components {
  schemas: {
    BasLabels: {
      W1: number;
      W2: number;
      G1: number;
      "1A": number;
      "1B": number;
    };
    PeriodSummary: {
      id: string;
      abn: string;
      taxType: "GST" | "PAYGW";
      periodLabel: string;
      lodgmentsUpToDate: boolean;
      paymentsUpToDate: boolean;
      complianceScore: number;
      lastBasLodgedAt: string;
      nextDueAt: string;
      outstandingLodgments: string[];
      outstandingAmounts: string[];
      bas: components["schemas"]["BasLabels"];
    };
  };
}

export interface paths {
  "/api/v1/periods": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              periods: components["schemas"]["PeriodSummary"][];
            };
          };
        };
      };
    };
  };
  "/api/v1/periods/{periodId}": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["PeriodSummary"];
          };
        };
        404: {
          content: {
            "application/json": {
              error: string;
              message?: string;
            };
          };
        };
      };
    };
  };
}
