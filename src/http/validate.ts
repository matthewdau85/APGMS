import { NextFunction, Request, Response } from "express";
import { z } from "zod";

export const abnSchema = z
  .string()
  .regex(/^\d{11}$/u, "ABN must be 11 digits");

export const closeAndIssueSchema = z.object({
  abn: abnSchema,
  taxType: z.string().min(1, "taxType is required"),
  periodId: z.string().min(1, "periodId is required"),
  thresholds: z
    .object({
      epsilon_cents: z.number().nonnegative().optional(),
      variance_ratio: z.number().min(0).max(1).optional(),
      dup_rate: z.number().min(0).max(1).optional(),
      gap_minutes: z.number().int().nonnegative().optional(),
      delta_vs_baseline: z.number().min(0).max(1).optional(),
    })
    .partial()
    .optional(),
});

export const payAtoSchema = z.object({
  abn: abnSchema,
  taxType: z.string().min(1),
  periodId: z.string().min(1),
  rail: z.enum(["EFT", "BPAY"]),
});

export const paytoSweepSchema = z.object({
  abn: abnSchema,
  amount_cents: z.number().int().positive(),
  reference: z.string().min(1),
});

export const settlementWebhookSchema = z.object({
  csv: z.string().min(1),
});

export const evidenceQuerySchema = z.object({
  abn: abnSchema,
  taxType: z.string().min(1),
  periodId: z.string().min(1),
});

export type CloseAndIssueBody = z.infer<typeof closeAndIssueSchema>;
export type PayAtoBody = z.infer<typeof payAtoSchema>;
export type PaytoSweepBody = z.infer<typeof paytoSweepSchema>;
export type SettlementWebhookBody = z.infer<typeof settlementWebhookSchema>;
export type EvidenceQuery = z.infer<typeof evidenceQuerySchema>;

type AnyZod = z.ZodTypeAny;

function formatZodError(error: z.ZodError) {
  return {
    message: "Validation failed",
    issues: error.errors.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export const validateBody = <T extends AnyZod>(schema: T) =>
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json(formatZodError(parsed.error));
    }
    req.body = parsed.data;
    return next();
  };

export const validateQuery = <T extends AnyZod>(schema: T) =>
  (req: Request, res: Response, next: NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json(formatZodError(parsed.error));
    }
    req.query = parsed.data;
    return next();
  };

