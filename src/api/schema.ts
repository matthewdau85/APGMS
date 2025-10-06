/* eslint-disable */
/* prettier-ignore */
export interface paths {
  "/dashboard/yesterday": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["DashboardYesterday"];
          };
        };
      };
    };
  };
  "/bas/preview": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["BasPreview"];
          };
        };
      };
    };
  };
  "/ato/status": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["AtoStatus"];
          };
        };
      };
    };
  };
  [key: string]: unknown;
}

export interface components {
  schemas: {
    DashboardYesterday: {
      jobs: number;
      success_rate: number;
      top_errors: string[];
    };
    BasPreview: {
      period: string;
      GSTPayable: number;
      PAYGW: number;
      Total: number;
    };
    AtoStatus: {
      status: string;
    };
    ConnStart: {
      type: string;
      provider: string;
    };
    Settings: {
      retentionMonths: number;
      piiMask: boolean;
    };
    ValidationError: {
      loc: (string | number)[];
      msg: string;
      type: string;
    };
    HTTPValidationError: {
      detail?: components["schemas"]["ValidationError"][];
    };
    [key: string]: unknown;
  };
}

export interface operations {}

export type external = Record<string, never>;
