import { z } from "zod";
import { PayrollEventPayload, PosEventPayload } from "./types";

const employeeSchema = z.object({
  employeeId: z.string().min(1, "employeeId required"),
  gross: z.number(),
  withholding: z.number().default(0),
});

const payrollTotalsSchema = z.object({
  w1: z.number(),
  w2: z.number(),
  gross: z.number().optional(),
  tax: z.number().optional(),
});

export const payrollEventSchema = z.object({
  tenantId: z.string().min(1, "tenantId required"),
  taxType: z.enum(["PAYGW", "GST"]),
  periodId: z.string().min(1, "periodId required"),
  sourceId: z.string().min(1, "sourceId required"),
  submittedAt: z.string().optional(),
  totals: payrollTotalsSchema,
  employees: z.array(employeeSchema).default([]),
  metadata: z.object({}).optional(),
}).extend({ type: z.literal("STP") }) as unknown as { parse(data: unknown): PayrollEventPayload; safeParse(data: unknown): { success: true; data: PayrollEventPayload } | { success: false; error: any } };

const posTotalsSchema = z.object({
  g1: z.number(),
  g10: z.number(),
  g11: z.number(),
  taxCollected: z.number(),
});

const registerSchema = z.object({
  registerId: z.string().min(1, "registerId required"),
  gross: z.number(),
  taxCollected: z.number(),
});

export const posEventSchema = z.object({
  tenantId: z.string().min(1, "tenantId required"),
  taxType: z.enum(["PAYGW", "GST"]),
  periodId: z.string().min(1, "periodId required"),
  sourceId: z.string().min(1, "sourceId required"),
  submittedAt: z.string().optional(),
  totals: posTotalsSchema,
  registers: z.array(registerSchema).default([]),
  metadata: z.object({}).optional(),
}).extend({ type: z.literal("POS") }) as unknown as { parse(data: unknown): PosEventPayload; safeParse(data: unknown): { success: true; data: PosEventPayload } | { success: false; error: any } };
