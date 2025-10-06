import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const spec = {
  openapi: "3.1.0",
  info: {
    title: "APGMS API",
    version: "1.0.0",
    description: "Public API surface for the APGMS demo services.",
  },
  servers: [{ url: "http://localhost:3000" }],
  components: {
    schemas: {
      ErrorResponse: {
        type: "object",
        properties: {
          error: { type: "string" },
          detail: { type: "string", nullable: true },
        },
        required: ["error"],
        additionalProperties: false,
      },
      CloseIssueRequest: {
        type: "object",
        properties: {
          abn: { type: "string" },
          taxType: { type: "string", enum: ["PAYGW", "GST"] },
          periodId: { type: "string" },
          thresholds: {
            type: "object",
            additionalProperties: { type: "number" },
            nullable: true,
          },
        },
        required: ["abn", "taxType", "periodId"],
        additionalProperties: false,
      },
      RptPayload: {
        type: "object",
        properties: {
          entity_id: { type: "string" },
          period_id: { type: "string" },
          tax_type: { type: "string", enum: ["PAYGW", "GST"] },
          amount_cents: { type: "integer" },
          merkle_root: { type: "string" },
          running_balance_hash: { type: "string" },
          anomaly_vector: {
            type: "object",
            additionalProperties: { type: "number" },
          },
          thresholds: {
            type: "object",
            additionalProperties: { type: "number" },
          },
          rail_id: { type: "string", enum: ["EFT", "BPAY", "PayTo"] },
          reference: { type: "string" },
          expiry_ts: { type: "string", format: "date-time" },
          nonce: { type: "string" },
        },
        required: [
          "entity_id",
          "period_id",
          "tax_type",
          "amount_cents",
          "merkle_root",
          "running_balance_hash",
          "anomaly_vector",
          "thresholds",
          "rail_id",
          "reference",
          "expiry_ts",
          "nonce",
        ],
        additionalProperties: false,
      },
      CloseIssueResponse: {
        type: "object",
        properties: {
          payload: { $ref: "#/components/schemas/RptPayload" },
          signature: { type: "string" },
        },
        required: ["payload", "signature"],
        additionalProperties: false,
      },
      PayRequest: {
        type: "object",
        properties: {
          abn: { type: "string" },
          taxType: { type: "string", enum: ["PAYGW", "GST"] },
          periodId: { type: "string" },
          rail: { type: "string", enum: ["EFT", "BPAY"] },
        },
        required: ["abn", "taxType", "periodId", "rail"],
        additionalProperties: false,
      },
      PayResponse: {
        type: "object",
        properties: {
          transfer_uuid: { type: "string", format: "uuid" },
          bank_receipt_hash: { type: "string" },
          status: { type: "string" },
        },
        required: ["transfer_uuid"],
        additionalProperties: true,
      },
      PaytoSweepRequest: {
        type: "object",
        properties: {
          abn: { type: "string" },
          amount_cents: { type: "integer" },
          reference: { type: "string" },
        },
        required: ["abn", "amount_cents", "reference"],
        additionalProperties: false,
      },
      PaytoSweepResponse: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["OK", "INSUFFICIENT_FUNDS", "BANK_ERROR"] },
          bank_ref: { type: "string", nullable: true },
        },
        required: ["status"],
        additionalProperties: false,
      },
      SettlementWebhookRequest: {
        type: "object",
        properties: {
          csv: { type: "string" },
        },
        required: ["csv"],
        additionalProperties: false,
      },
      SettlementWebhookResponse: {
        type: "object",
        properties: {
          ingested: { type: "integer" },
        },
        required: ["ingested"],
        additionalProperties: false,
      },
      EvidenceDelta: {
        type: "object",
        properties: {
          ts: { type: "string", format: "date-time" },
          amount_cents: { type: "integer" },
          hash_after: { type: "string", nullable: true },
          bank_receipt_hash: { type: "string", nullable: true },
        },
        required: ["ts", "amount_cents"],
        additionalProperties: false,
      },
      EvidenceResponse: {
        type: "object",
        properties: {
          bas_labels: {
            type: "object",
            additionalProperties: true,
          },
          rpt_payload: {
            oneOf: [{ $ref: "#/components/schemas/RptPayload" }, { type: "null" }],
          },
          rpt_signature: { type: "string", nullable: true },
          owa_ledger_deltas: {
            type: "array",
            items: { $ref: "#/components/schemas/EvidenceDelta" },
          },
          bank_receipt_hash: { type: "string", nullable: true },
          anomaly_thresholds: {
            type: "object",
            additionalProperties: { type: "number" },
          },
          discrepancy_log: {
            type: "array",
            items: { type: "object" },
          },
        },
        required: [
          "bas_labels",
          "rpt_payload",
          "rpt_signature",
          "owa_ledger_deltas",
          "bank_receipt_hash",
          "anomaly_thresholds",
          "discrepancy_log",
        ],
        additionalProperties: false,
      },
      BalanceResponse: {
        type: "object",
        properties: {
          abn: { type: "string" },
          taxType: { type: "string" },
          periodId: { type: "string" },
          balance_cents: { type: "integer" },
          has_release: { type: "boolean" },
        },
        required: ["abn", "taxType", "periodId", "balance_cents", "has_release"],
        additionalProperties: false,
      },
      LedgerEntry: {
        type: "object",
        properties: {
          id: { type: "integer" },
          amount_cents: { type: "integer" },
          balance_after_cents: { type: "integer" },
          rpt_verified: { type: "boolean", nullable: true },
          release_uuid: { type: "string", format: "uuid", nullable: true },
          bank_receipt_id: { type: "string", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
        required: ["id", "amount_cents", "balance_after_cents", "created_at"],
        additionalProperties: false,
      },
      LedgerResponse: {
        type: "object",
        properties: {
          abn: { type: "string" },
          taxType: { type: "string" },
          periodId: { type: "string" },
          rows: {
            type: "array",
            items: { $ref: "#/components/schemas/LedgerEntry" },
          },
        },
        required: ["abn", "taxType", "periodId", "rows"],
        additionalProperties: false,
      },
      DepositRequest: {
        type: "object",
        properties: {
          abn: { type: "string" },
          taxType: { type: "string" },
          periodId: { type: "string" },
          amountCents: { type: "integer", minimum: 1 },
        },
        required: ["abn", "taxType", "periodId", "amountCents"],
        additionalProperties: false,
      },
      DepositResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          ledger_id: { type: "integer" },
          balance_after_cents: { type: "integer" },
        },
        required: ["ok", "ledger_id", "balance_after_cents"],
        additionalProperties: false,
      },
      ReleaseRequest: {
        type: "object",
        properties: {
          abn: { type: "string" },
          taxType: { type: "string" },
          periodId: { type: "string" },
          amountCents: { type: "integer" },
        },
        required: ["abn", "taxType", "periodId", "amountCents"],
        additionalProperties: false,
      },
      ReleaseResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          ledger_id: { type: "integer" },
          transfer_uuid: { type: "string", format: "uuid" },
          release_uuid: { type: "string", format: "uuid" },
          balance_after_cents: { type: "integer" },
          rpt_ref: {
            type: "object",
            properties: {
              rpt_id: { type: "integer" },
              kid: { type: "string", nullable: true },
              payload_sha256: { type: "string" },
            },
            required: ["rpt_id", "payload_sha256"],
            additionalProperties: false,
          },
        },
        required: [
          "ok",
          "ledger_id",
          "transfer_uuid",
          "release_uuid",
          "balance_after_cents",
          "rpt_ref",
        ],
        additionalProperties: false,
      },
    },
  },
  paths: {
    "/healthz": {
      get: {
        summary: "Service health",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string" } },
                  required: ["status"],
                },
              },
            },
          },
        },
      },
    },
    "/api/close-issue": {
      post: {
        summary: "Close period and issue an RPT",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/CloseIssueRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "RPT issued",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CloseIssueResponse" },
              },
            },
          },
          "400": {
            description: "Issue failed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/pay": {
      post: {
        summary: "Release funds to the ATO",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PayRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Release accepted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PayResponse" },
              },
            },
          },
          "400": {
            description: "Release failed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/payto/sweep": {
      post: {
        summary: "Debit PayTo mandate",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PaytoSweepRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Sweep result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaytoSweepResponse" },
              },
            },
          },
        },
      },
    },
    "/api/settlement/webhook": {
      post: {
        summary: "Process settlement batch",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SettlementWebhookRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Batch accepted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/SettlementWebhookResponse" },
              },
            },
          },
        },
      },
    },
    "/api/evidence": {
      get: {
        summary: "Retrieve evidence bundle",
        parameters: [
          { name: "abn", in: "query", required: true, schema: { type: "string" } },
          { name: "taxType", in: "query", required: true, schema: { type: "string" } },
          { name: "periodId", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Evidence bundle",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/EvidenceResponse" },
              },
            },
          },
        },
      },
    },
    "/api/balance": {
      get: {
        summary: "Period balance",
        parameters: [
          { name: "abn", in: "query", required: true, schema: { type: "string" } },
          { name: "taxType", in: "query", required: true, schema: { type: "string" } },
          { name: "periodId", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Balance summary",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/BalanceResponse" },
              },
            },
          },
          "400": {
            description: "Bad request",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/ledger": {
      get: {
        summary: "Ledger rows",
        parameters: [
          { name: "abn", in: "query", required: true, schema: { type: "string" } },
          { name: "taxType", in: "query", required: true, schema: { type: "string" } },
          { name: "periodId", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Ledger entries",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/LedgerResponse" },
              },
            },
          },
          "400": {
            description: "Bad request",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/deposit": {
      post: {
        summary: "Record a deposit",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/DepositRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Deposit accepted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/DepositResponse" },
              },
            },
          },
          "400": {
            description: "Deposit failed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
    "/api/release": {
      post: {
        summary: "Release ledger funds",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReleaseRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Release created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ReleaseResponse" },
              },
            },
          },
          "400": {
            description: "Release failed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" },
              },
            },
          },
        },
      },
    },
  },
} as const;

const typesContent = `/* eslint-disable */
// This file is generated by scripts/generate-openapi.ts. Do not edit manually.

export type TaxType = "PAYGW" | "GST";
export type RailType = "EFT" | "BPAY" | "PayTo";

export interface ErrorResponse {
  error: string;
  detail?: string | null;
}

export interface CloseIssueRequest {
  abn: string;
  taxType: TaxType;
  periodId: string;
  thresholds?: Record<string, number> | null;
}

export interface RptPayload {
  entity_id: string;
  period_id: string;
  tax_type: TaxType;
  amount_cents: number;
  merkle_root: string;
  running_balance_hash: string;
  anomaly_vector: Record<string, number>;
  thresholds: Record<string, number>;
  rail_id: RailType;
  reference: string;
  expiry_ts: string;
  nonce: string;
}

export interface CloseIssueResponse {
  payload: RptPayload;
  signature: string;
}

export interface PayRequest {
  abn: string;
  taxType: TaxType;
  periodId: string;
  rail: Exclude<RailType, "PayTo">;
}

export interface PayResponse {
  transfer_uuid: string;
  bank_receipt_hash?: string;
  status?: string;
  [key: string]: unknown;
}

export interface PaytoSweepRequest {
  abn: string;
  amount_cents: number;
  reference: string;
}

export type PaytoSweepStatus = "OK" | "INSUFFICIENT_FUNDS" | "BANK_ERROR";

export interface PaytoSweepResponse {
  status: PaytoSweepStatus;
  bank_ref?: string | null;
}

export interface SettlementWebhookRequest {
  csv: string;
}

export interface SettlementWebhookResponse {
  ingested: number;
}

export interface EvidenceDelta {
  ts: string;
  amount_cents: number;
  hash_after?: string | null;
  bank_receipt_hash?: string | null;
}

export interface EvidenceResponse {
  bas_labels: Record<string, unknown>;
  rpt_payload: RptPayload | null;
  rpt_signature: string | null;
  owa_ledger_deltas: EvidenceDelta[];
  bank_receipt_hash: string | null;
  anomaly_thresholds: Record<string, number>;
  discrepancy_log: Array<Record<string, unknown>>;
}

export interface BalanceResponse {
  abn: string;
  taxType: string;
  periodId: string;
  balance_cents: number;
  has_release: boolean;
}

export interface LedgerEntry {
  id: number;
  amount_cents: number;
  balance_after_cents: number;
  rpt_verified?: boolean | null;
  release_uuid?: string | null;
  bank_receipt_id?: string | null;
  created_at: string;
}

export interface LedgerResponse {
  abn: string;
  taxType: string;
  periodId: string;
  rows: LedgerEntry[];
}

export interface DepositRequest {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
}

export interface DepositResponse {
  ok: boolean;
  ledger_id: number;
  balance_after_cents: number;
}

export interface ReleaseRequest {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
}

export interface ReleaseReference {
  rpt_id: number;
  kid?: string | null;
  payload_sha256: string;
}

export interface ReleaseResponse {
  ok: boolean;
  ledger_id: number;
  transfer_uuid: string;
  release_uuid: string;
  balance_after_cents: number;
  rpt_ref: ReleaseReference;
}

export interface HealthzResponse {
  status: string;
}
`;

async function main() {
  const specPath = path.join(repoRoot, "openapi.json");
  await writeFile(specPath, JSON.stringify(spec, null, 2) + "\n", "utf8");

  const typesPath = path.join(repoRoot, "src", "api", "types.ts");
  await writeFile(typesPath, `${typesContent}\n`, "utf8");
}

main().catch((err) => {
  console.error("Failed to generate OpenAPI assets", err);
  process.exit(1);
});
