/* eslint-disable */
// This file was generated from openapi.json by a custom script.
// It provides minimal typings for the endpoints used by the console.

export interface components {
  schemas: {
    ATOStatus: {
      status: string;
    };
    BalanceResponse: {
      abn: string;
      taxType: string;
      periodId: string;
      balance_cents: number;
      has_release: boolean;
    };
    BasPreview: {
      period: string;
      GSTPayable: number;
      PAYGW: number;
      Total: number;
    };
    BusinessProfile: {
      abn: string;
      name: string;
      trading: string;
      contact: string;
    };
    ConnStart: {
      type: string;
      provider: string;
    };
    Connection: {
      id?: number | null;
      type: string;
      provider: string;
      state?: string | null;
      created_at: number;
    };
    DashboardYesterday: {
      jobs: number;
      success_rate: number;
      top_errors: string[];
    };
    DepositRequest: {
      abn: string;
      taxType: string;
      periodId: string;
      amountCents: number;
    };
    DepositResponse: {
      ok: boolean;
      ledger_id: number;
      balance_after_cents: number;
    };
    EvidenceLedgerDelta: {
      ts?: string | null;
      amount_cents?: number | null;
      hash_after?: string | null;
      bank_receipt_hash?: string | null;
    };
    EvidenceBundle: {
      bas_labels: Record<string, string | null | undefined>;
      rpt_payload?: Record<string, unknown> | string | null;
      rpt_signature?: string | null;
      owa_ledger_deltas: components["schemas"]["EvidenceLedgerDelta"][];
      bank_receipt_hash?: string | null;
      anomaly_thresholds: Record<string, number | string | null | undefined>;
      discrepancy_log: Record<string, unknown>[];
    };
    HTTPValidationError: {
      detail?: components["schemas"]["ValidationError"][];
    };
    LedgerRow: {
      id: number;
      amount_cents: number;
      balance_after_cents: number;
      rpt_verified?: boolean | null;
      release_uuid?: string | null;
      bank_receipt_id?: string | null;
      created_at: string;
    };
    LedgerResponse: {
      abn: string;
      taxType: string;
      periodId: string;
      rows: components["schemas"]["LedgerRow"][];
    };
    MessageResponse: {
      ok: boolean;
      message: string;
    };
    ReleaseRequest: {
      abn: string;
      taxType: string;
      periodId: string;
      amountCents: number;
    };
    ReleaseResponse: {
      ok: boolean;
      ledger_id: number;
      transfer_uuid: string;
      release_uuid: string;
      balance_after_cents: number;
      rpt_ref?: {
        rpt_id?: number | null;
        kid?: string | null;
        payload_sha256?: string | null;
      };
    };
    Settings: {
      retentionMonths: number;
      piiMask: boolean;
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
    ValidationError: {
      loc: (string | number)[];
      msg: string;
      type: string;
    };
  };
}

export interface paths {
  "/health": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              ok: boolean;
            };
          };
        };
      };
    };
  };
  "/api/balance": {
    get: {
      parameters: {
        query: {
          abn: string;
          taxType: string;
          periodId: string;
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["BalanceResponse"];
          };
        };
      };
    };
  };
  "/api/ledger": {
    get: {
      parameters: {
        query: {
          abn: string;
          taxType: string;
          periodId: string;
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["LedgerResponse"];
          };
        };
      };
    };
  };
  "/api/evidence": {
    get: {
      parameters: {
        query: {
          abn: string;
          taxType: string;
          periodId: string;
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["EvidenceBundle"];
          };
        };
      };
    };
  };
  "/api/deposit": {
    post: {
      requestBody: {
        content: {
          "application/json": components["schemas"]["DepositRequest"];
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["DepositResponse"];
          };
        };
      };
    };
  };
  "/api/release": {
    post: {
      requestBody: {
        content: {
          "application/json": components["schemas"]["ReleaseRequest"];
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["ReleaseResponse"];
          };
        };
      };
    };
  };
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
  "/bas/validate": {
    post: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["MessageResponse"];
          };
        };
      };
    };
  };
  "/bas/lodge": {
    post: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["MessageResponse"];
          };
        };
      };
    };
  };
  "/settings": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["Settings"];
          };
        };
      };
    };
    post: {
      requestBody: {
        content: {
          "application/json": components["schemas"]["Settings"];
        };
      };
      responses: {
        200: {
          content: {
            "application/json": unknown;
          };
        };
      };
    };
  };
  "/profile": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["BusinessProfile"];
          };
        };
      };
    };
    post: {
      requestBody: {
        content: {
          "application/json": components["schemas"]["BusinessProfile"];
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["BusinessProfile"];
          };
        };
      };
    };
  };
  "/connections": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["Connection"][];
          };
        };
      };
    };
    post: {
      requestBody: {
        content: {
          "application/json": components["schemas"]["ConnStart"];
        };
      };
      responses: {
        200: {
          content: {
            "application/json": {
              url: string;
            };
          };
        };
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
          content: {
            "application/json": unknown;
          };
        };
      };
    };
  };
  "/transactions": {
    get: {
      parameters?: {
        query?: {
          q?: string;
          source?: string;
        };
      };
      responses: {
        200: {
          content: {
            "application/json": components["schemas"]["TransactionsResponse"];
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
            "application/json": components["schemas"]["ATOStatus"];
          };
        };
      };
    };
  };
  "/normalize": {
    post: {
      requestBody?: {
        content: {
          "application/json": Record<string, unknown>;
        };
      };
      responses: {
        200: {
          content: {
            "application/json": {
              received: boolean;
              size: number;
            };
          };
        };
      };
    };
  };
  "/readyz": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": {
              ok: boolean;
              ts: number;
            };
          };
        };
      };
    };
  };
  "/metrics": {
    get: {
      responses: {
        200: {
          content: {
            "text/plain": string;
          };
        };
      };
    };
  };
  "/openapi.json": {
    get: {
      responses: {
        200: {
          content: {
            "application/json": any;
          };
        };
      };
    };
  };
}

export type PathKeys = keyof paths;
