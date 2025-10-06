import type { ExpressIdempotencyOptions } from "../../libs/idempotency/express";
import { createExpressIdempotencyMiddleware, isIdempotencyEnabled } from "../../libs/idempotency/express";

export function idempotency(options: ExpressIdempotencyOptions = {}) {
  return createExpressIdempotencyMiddleware(options);
}

export { isIdempotencyEnabled };
