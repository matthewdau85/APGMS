import { payrollEventSchema, posEventSchema } from "./schemas";
import { IngestHeaders, IngestKind, AnyIngestPayload } from "./types";
import { storeIngestEvent, pushToDlq } from "./storage";
import { verifySignature } from "./hmac";
import { runRecon } from "../recon/service";

export class IngestValidationError extends Error {
  constructor(public issues: any) {
    super("Validation failed");
  }
}

export class IngestSignatureError extends Error {
  constructor(public reason: string) {
    super("Signature invalid");
  }
}

export interface ProcessOptions {
  skipSignature?: boolean;
  recordSignature?: string;
}

export interface ProcessResult {
  eventId?: number;
  payload: AnyIngestPayload;
  reconSummary?: Awaited<ReturnType<typeof runRecon>>;
}

function selectSchema(kind: IngestKind) {
  return kind === "stp" ? payrollEventSchema : posEventSchema;
}

export async function processIngest(
  kind: IngestKind,
  body: unknown,
  rawBody: string,
  headers: IngestHeaders,
  options?: ProcessOptions
): Promise<ProcessResult> {
  const schema = selectSchema(kind);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new IngestValidationError(parsed.error);
  }
  const payload = parsed.data;

  let hmacValid = true;
  if (!options?.skipSignature) {
    const verification = await verifySignature({
      tenantId: payload.tenantId,
      rawBody,
      signature: headers.signature,
      timestamp: headers.timestamp,
    });
    if (!verification.valid) {
      hmacValid = false;
      await storeIngestEvent({
        tenantId: payload.tenantId,
        taxType: payload.taxType,
        periodId: payload.periodId,
        sourceId: payload.sourceId,
        payload,
        rawPayload: body,
        signature: headers.signature,
        hmacValid,
        endpoint: kind,
      });
      throw new IngestSignatureError(verification.reason ?? "SIGNATURE_INVALID");
    }
  }

  const eventId = await storeIngestEvent({
    tenantId: payload.tenantId,
    taxType: payload.taxType,
    periodId: payload.periodId,
    sourceId: payload.sourceId,
    payload,
    rawPayload: body,
    signature: headers.signature,
    hmacValid,
    endpoint: kind,
  });

  const reconSummary = await runRecon(payload.tenantId, payload.taxType, payload.periodId);
  return { eventId, payload, reconSummary };
}

export async function handleUnexpectedError(
  kind: IngestKind,
  error: Error,
  body: any,
  headers: IngestHeaders
) {
  await pushToDlq(kind, error.message || "UNEXPECTED_ERROR", body, headers, body?.tenantId);
}
