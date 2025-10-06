import { Router } from "express";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { z } from "zod";

const pool = new Pool();

const idSchema = z.string().uuid();

const payRequestSchema = z
  .object({
    abn: z.string().trim().min(1),
    period: z.string().trim().min(1),
    amountCents: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).optional(),
  })
  .describe("PayRequest");

const paymentStatusSchema = z
  .enum(["blocked", "succeeded", "failed"])
  .describe("PaymentStatus");

const ledgerEntrySchema = z
  .object({
    id: idSchema,
    direction: z.enum(["DEBIT", "CREDIT"]),
    amountCents: z.number().int(),
    note: z.string().optional(),
    createdAt: z.string().datetime(),
  })
  .describe("LedgerEntry");

const paymentResponseSchema = z
  .object({
    id: idSchema,
    abn: z.string(),
    period: z.string(),
    amountCents: z.number().int(),
    status: paymentStatusSchema,
    traceId: idSchema,
    idempotencyKey: z.string().nullish(),
    createdAt: z.string().datetime(),
    ledgerEntries: z.array(ledgerEntrySchema),
  })
  .describe("PaymentResponse");

type PayRequest = z.infer<typeof payRequestSchema>;
type PaymentResponse = z.infer<typeof paymentResponseSchema>;

const ensureSchema = (() => {
  let promise: Promise<void> | null = null;
  return () => {
    if (!promise) {
      promise = (async () => {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS payment_attempts (
            id UUID PRIMARY KEY,
            abn TEXT NOT NULL,
            period TEXT NOT NULL,
            amount_cents BIGINT NOT NULL,
            status TEXT NOT NULL,
            trace_id UUID NOT NULL,
            idempotency_key TEXT UNIQUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `);
        await pool.query(`
          CREATE TABLE IF NOT EXISTS payment_ledger_entries (
            id UUID PRIMARY KEY,
            payment_id UUID NOT NULL REFERENCES payment_attempts(id) ON DELETE CASCADE,
            direction TEXT NOT NULL,
            amount_cents BIGINT NOT NULL,
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `);
      })();
    }
    return promise;
  };
})();

const killSwitchEnabled = () =>
  ["1", "true", "on", "yes"].includes(
    String(process.env.PAYMENTS_KILL_SWITCH || "").trim().toLowerCase(),
  );

async function findPaymentById(id: string): Promise<PaymentResponse | null> {
  await ensureSchema();
  const attempt = await pool.query(
    `SELECT id, abn, period, amount_cents, status, trace_id, idempotency_key, created_at
     FROM payment_attempts WHERE id=$1`,
    [id],
  );
  if (!attempt.rowCount) return null;
  const entryRows = await pool.query(
    `SELECT id, direction, amount_cents, note, created_at
     FROM payment_ledger_entries
     WHERE payment_id=$1
     ORDER BY created_at ASC`,
    [id],
  );

  const row = attempt.rows[0];
  return {
    id: row.id,
    abn: row.abn,
    period: row.period,
    amountCents: Number(row.amount_cents),
    status: row.status,
    traceId: row.trace_id,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at.toISOString(),
    ledgerEntries: entryRows.rows.map((r) => ({
      id: r.id,
      direction: r.direction,
      amountCents: Number(r.amount_cents),
      note: r.note ?? undefined,
      createdAt: r.created_at.toISOString(),
    })),
  } as PaymentResponse;
}

async function findPaymentByIdempotency(key: string) {
  await ensureSchema();
  const { rows } = await pool.query<{
    id: string;
  }>(`SELECT id FROM payment_attempts WHERE idempotency_key=$1`, [key]);
  if (!rows.length) return null;
  return findPaymentById(rows[0].id);
}

async function createPaymentAttempt(
  payload: PayRequest,
): Promise<{ payment: PaymentResponse; reused: boolean }> {
  await ensureSchema();

  if (payload.idempotencyKey) {
    const existing = await findPaymentByIdempotency(payload.idempotencyKey);
    if (existing) return { payment: existing, reused: true };
  }

  const engaged = killSwitchEnabled();
  const id = randomUUID();
  const traceId = randomUUID();
  const status: z.infer<typeof paymentStatusSchema> = engaged ? "blocked" : "succeeded";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO payment_attempts (id, abn, period, amount_cents, status, trace_id, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        payload.abn,
        payload.period,
        payload.amountCents,
        status,
        traceId,
        payload.idempotencyKey ?? null,
      ],
    );

    if (!engaged) {
      await client.query(
        `INSERT INTO payment_ledger_entries (id, payment_id, direction, amount_cents, note)
         VALUES ($1,$2,$3,$4,$5)`,
        [randomUUID(), id, "DEBIT", payload.amountCents, "Payout initiated"],
      );
    }

    await client.query("COMMIT");
  } catch (error: any) {
    await client.query("ROLLBACK");

    if (payload.idempotencyKey && error?.code === "23505") {
      const existing = await findPaymentByIdempotency(payload.idempotencyKey);
      if (existing) return { payment: existing, reused: true };
    }

    throw error;
  } finally {
    client.release();
  }

  const attempt = await findPaymentById(id);
  if (!attempt) throw new Error("Payment attempt not recorded");
  return { payment: attempt, reused: false };
}

export const paymentsApi = Router();

paymentsApi.get("/payments/openapi.json", (_req, res) => {
  res.json(paymentsOpenApiDocument);
});

paymentsApi.post("/payments/pay", async (req, res) => {
  const parsed = payRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }

  try {
    const { payment, reused } = await createPaymentAttempt(parsed.data);
    const statusCode = reused ? 200 : 201;
    return res.status(statusCode).json(payment);
  } catch (error) {
    return res.status(500).json({ error: "Payment failed", detail: String((error as Error).message) });
  }
});

paymentsApi.get("/payments/:id", async (req, res) => {
  const parsed = idSchema.safeParse(req.params.id);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payment id" });
  }

  const payment = await findPaymentById(parsed.data);
  if (!payment) return res.status(404).json({ error: "Payment not found" });
  return res.json(payment);
});

paymentsApi.post("/payments/refund", (_req, res) => {
  res.status(501).json({ error: "Not implemented" });
});

export const paymentsOpenApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Payments API",
    version: "1.0.0",
  },
  servers: [{ url: "/api" }],
  paths: {
    "/payments/pay": {
      post: {
        summary: "Create a payout",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PayRequest" },
            },
          },
        },
        responses: {
          "201": {
            description: "Payout created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaymentResponse" },
              },
            },
          },
          "200": {
            description: "Idempotent replay",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaymentResponse" },
              },
            },
          },
        },
      },
    },
    "/payments/{id}": {
      get: {
        summary: "Get payment",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
        responses: {
          "200": {
            description: "Payment details",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/PaymentResponse" },
              },
            },
          },
          "404": { description: "Not found" },
        },
      },
    },
    "/payments/refund": {
      post: {
        summary: "Refund placeholder",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/PayRequest" },
            },
          },
        },
        responses: {
          "501": { description: "Refund not implemented" },
        },
      },
    },
    "/payments/openapi.json": {
      get: {
        summary: "Payments OpenAPI document",
        responses: {
          "200": {
            description: "Payments OpenAPI",
            content: {
              "application/json": { schema: { type: "object" } },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      PayRequest: {
        type: "object",
        required: ["abn", "period", "amountCents"],
        properties: {
          abn: { type: "string" },
          period: { type: "string" },
          amountCents: { type: "integer", minimum: 1 },
          idempotencyKey: { type: "string" },
        },
      },
      PaymentStatus: {
        type: "string",
        enum: ["blocked", "succeeded", "failed"],
      },
      LedgerEntry: {
        type: "object",
        required: ["id", "direction", "amountCents", "createdAt"],
        properties: {
          id: { type: "string", format: "uuid" },
          direction: { type: "string", enum: ["DEBIT", "CREDIT"] },
          amountCents: { type: "integer" },
          note: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      PaymentResponse: {
        type: "object",
        required: [
          "id",
          "abn",
          "period",
          "amountCents",
          "status",
          "traceId",
          "createdAt",
          "ledgerEntries",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          abn: { type: "string" },
          period: { type: "string" },
          amountCents: { type: "integer" },
          status: { $ref: "#/components/schemas/PaymentStatus" },
          traceId: { type: "string", format: "uuid" },
          idempotencyKey: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          ledgerEntries: {
            type: "array",
            items: { $ref: "#/components/schemas/LedgerEntry" },
          },
        },
      },
    },
  },
} as const;

export type { PayRequest, PaymentResponse };
