/* eslint-disable */
/**
 * This file is generated from portal-api/openapi.json.
 * It mirrors the shape produced by openapi-typescript for the subset of endpoints we use.
 */

export interface paths {
  "/readyz": {
    get: {
      responses: {
        200: components["schemas"]["ReadyzResponse"];
      };
    };
  };
  "/metrics": {
    get: {
      responses: {
        200: string;
      };
    };
  };
  "/dashboard/yesterday": {
    get: {
      responses: {
        200: components["schemas"]["DashboardYesterdayResponse"];
      };
    };
  };
  "/normalize": {
    post: {
      requestBody: {
        content: {
          "application/json": Record<string, unknown>;
        };
      };
      responses: {
        200: components["schemas"]["NormalizeResponse"];
      };
    };
  };
  "/connections": {
    get: {
      responses: {
        200: components["schemas"]["Connection"][];
      };
    };
  };
  "/connections/start": {
    post: {
      requestBody: {
        content: {
          "application/json": components["schemas"]["ConnStart"];
        };
      };
      responses: {
        200: components["schemas"]["ConnectionStartResponse"];
      };
    };
  };
  "/connections/{conn_id}": {
    delete: {
      parameters: {
        path: {
          conn_id: number;
        };
      };
      responses: {
        200: {
          ok: boolean;
        };
      };
    };
  };
  "/transactions": {
    get: {
      parameters: {
        query: {
          q?: string;
          source?: string;
        };
      };
      responses: {
        200: components["schemas"]["TransactionsResponse"];
        422: components["schemas"]["HTTPValidationError"];
      };
    };
  };
  "/ato/status": {
    get: {
      responses: {
        200: components["schemas"]["AtoStatusResponse"];
      };
    };
  };
  "/bas/validate": {
    post: {
      responses: {
        200: components["schemas"]["BasMessage"];
      };
    };
  };
  "/bas/lodge": {
    post: {
      responses: {
        200: components["schemas"]["BasMessage"];
      };
    };
  };
  "/bas/preview": {
    get: {
      responses: {
        200: components["schemas"]["BasPreviewResponse"];
      };
    };
  };
  "/settings": {
    get: {
      responses: {
        200: components["schemas"]["SettingsPayload"];
      };
    };
    post: {
      requestBody: {
        content: {
          "application/json": components["schemas"]["SettingsPayload"];
        };
      };
      responses: {
        200: components["schemas"]["SaveSettingsResponse"];
      };
    };
  };
}

export interface components {
  schemas: {
    ReadyzResponse: {
      ok: boolean;
      ts: number;
    };
    DashboardYesterdayResponse: {
      jobs: number;
      success_rate: number;
      top_errors: string[];
    };
    NormalizeResponse: {
      received: boolean;
      size: number;
    };
    ConnStart: {
      type: string;
      provider: string;
    };
    Connection: {
      id: number;
      type: string;
      provider: string;
      status: string;
    };
    ConnectionStartResponse: {
      url: string;
    };
    Transaction: {
      date: string;
      source: string;
      description: string;
      amount: number;
      category: string;
    };
    TransactionsResponse: {
      items: components["schemas"]["Transaction"][];
      sources: string[];
    };
    AtoStatusResponse: {
      status: string;
    };
    BasMessage: {
      ok: boolean;
      message: string;
    };
    BasPreviewResponse: {
      period: string;
      GSTPayable: number;
      PAYGW: number;
      Total: number;
    };
    SettingsPayload: {
      retentionMonths: number;
      piiMask: boolean;
    };
    SaveSettingsResponse: {
      ok: boolean;
      settings: components["schemas"]["SettingsPayload"];
    };
    HTTPValidationError: {
      detail?: components["schemas"]["ValidationError"][];
    };
    ValidationError: {
      loc: (string | number)[];
      msg: string;
      type: string;
    };
  };
}

export type operations = never;

