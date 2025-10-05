import type { Request } from "express";
import { Pool } from "pg";
import {
  createExpressIdempotencyMiddleware,
  derivePayoutKey,
  installFetchIdempotencyPropagation,
} from "../../libs/idempotency/express.js";

const pool = new Pool();
installFetchIdempotencyPropagation();

function semanticKey(req: Request): string | undefined {
  if (!req?.method || !req.body) return undefined;
  const method = req.method.toUpperCase();
  if (method !== "POST" && method !== "PUT" && method !== "PATCH" && method !== "DELETE") {
    return undefined;
  }
  const path = (req.path || req.originalUrl || "").toLowerCase();
  if (path.includes("payato") || path.endsWith("/pay") || path.endsWith("/release")) {
    return derivePayoutKey(req.body) ?? undefined;
  }
  return undefined;
}

export function idempotency() {
  return createExpressIdempotencyMiddleware({
    pool,
    deriveKey: semanticKey,
  });
}
