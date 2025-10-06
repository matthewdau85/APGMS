import { z } from "zod";
export const PayrollEvent = z.object({
  abn: z.string().min(1),
  grossCents: z.number().int().nonnegative(),
  paygCents: z.number().int().nonnegative(),
  occurredAt: z.string().datetime()
});
export type PayrollEvent = z.infer<typeof PayrollEvent>;

export const PosEvent = z.object({
  abn: z.string().min(1),
  grossCents: z.number().int().nonnegative(),
  gstCents: z.number().int().nonnegative(),
  occurredAt: z.string().datetime()
});
export type PosEvent = z.infer<typeof PosEvent>;
