import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";
import { getDefaultIdempotencyStore, IdempotencyStore, EnsureOptions } from "./store";

export type ExpressIdempotencyOptions = {
  store?: IdempotencyStore;
  ttlSecs?: number;
  mode?: "ingress" | "downstream";
  deriveKey?: (req: Request) => string | null;
};

type IdempotencyLocals = {
  key: string;
  traceId: string;
  wasCreated: boolean;
  ttlSecs: number;
};

const ENABLED = (process.env.PROTO_ENABLE_IDEMPOTENCY || "").toLowerCase() === "true";
const DEFAULT_TTL = Number(process.env.PROTO_IDEMPOTENCY_TTL_SECS || "86400");

const SEMANTIC_BUILDERS: Array<(req: Request) => string | null> = [
  (req) => {
    const body = (req as any).body || {};
    const abn = body.abn || body.ABN;
    const period = body.periodId || body.period || body.period_id;
    const amount = body.amountCents ?? body.amount_cents;
    if (abn && period && typeof amount !== "undefined") {
      return `ABN:${abn}:BAS:${period}:PAYMENT:${amount}`;
    }
    return null;
  },
];

function deriveSemanticKey(req: Request, custom?: (req: Request) => string | null): string | null {
  if (custom) {
    const result = custom(req);
    if (result) return result;
  }
  for (const builder of SEMANTIC_BUILDERS) {
    const key = builder(req);
    if (key) return key;
  }
  return null;
}

export function createExpressIdempotencyMiddleware(options: ExpressIdempotencyOptions = {}) {
  const store = options.store ?? getDefaultIdempotencyStore();
  const ttlSecs = options.ttlSecs ?? store.defaultTtlSecs ?? DEFAULT_TTL;
  const mode = options.mode ?? "ingress";

  return async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
    if (!ENABLED) return next();

    const incomingKey = req.header("Idempotency-Key")?.trim();
    const key = incomingKey || deriveSemanticKey(req, options.deriveKey) || randomUUID();
    const traceId = req.header("X-Trace-Id")?.trim() || randomUUID();

    (req as any).idempotencyKey = key;
    (req as any).traceId = traceId;
    (req.headers as any)["idempotency-key"] = key;
    (req.headers as any)["x-trace-id"] = traceId;
    res.setHeader("Idempotency-Key", key);
    res.setHeader("X-Trace-Id", traceId);

    const ensureOpts: EnsureOptions = { ttlSecs, allowExistingPending: mode === "downstream" };
    const result = await store.ensure(key, ensureOpts);

    if (result.outcome === "replay") {
      const cached = result.cached;
      if (cached.headers) {
        for (const [header, value] of Object.entries(cached.headers)) {
          if (!header) continue;
          res.setHeader(header, value);
        }
      }
      res.status(cached.statusCode);
      if ((cached.contentType || "").includes("application/json")) {
        return res.json(cached.body);
      }
      return res.send(cached.body);
    }

    if (result.outcome === "failed") {
      return res.status(409).json({
        error: "IDEMPOTENCY_FAILED",
        failure_cause: result.failureCause,
      });
    }

    if (result.outcome === "in_progress") {
      return res.status(409).json({
        error: "IDEMPOTENCY_IN_PROGRESS",
      });
    }

    const locals: IdempotencyLocals = {
      key,
      traceId,
      wasCreated: result.wasCreated,
      ttlSecs,
    };
    (res.locals as any).idempotency = locals;

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    let bodyPayload: any;
    let contentType: string | null = null;

    res.json = function patchedJson(body: any) {
      bodyPayload = body;
      contentType = "application/json";
      return originalJson(body);
    } as Response["json"];

    res.send = function patchedSend(body: any) {
      bodyPayload = body;
      if (!contentType) {
        const header = res.getHeader("content-type");
        contentType = header ? String(header) : null;
      }
      return originalSend(body);
    } as Response["send"];

    res.on("finish", () => {
      // Only the request that we allowed through should persist results.
      if (!bodyPayload && res.statusCode < 400) {
        bodyPayload = null;
      }
      if (res.statusCode < 400) {
        store
          .markApplied(key, {
            statusCode: res.statusCode,
            body: bodyPayload,
            headers: res.getHeaders() as Record<string, string | number | string[]>,
            contentType,
            ttlSecs,
          })
          .catch((err) => {
            console.error("[idempotency] failed to persist applied state", err);
          });
      } else if (res.statusCode >= 400) {
        const failure = bodyPayload && typeof bodyPayload === "object" && bodyPayload.error
          ? String(bodyPayload.error)
          : `HTTP_${res.statusCode}`;
        store.markFailed(key, failure).catch((err) => {
          console.error("[idempotency] failed to persist failure state", err);
        });
      }
    });

    return next();
  };
}

export function isIdempotencyEnabled() {
  return ENABLED;
}
