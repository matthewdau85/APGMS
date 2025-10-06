import { mtlsAgent } from "../mtls";
import { assertAllowlisted } from "../allowlist";
import { validateAbn, validateEft, EftDetails } from "../validators";

export interface SubmitReleasePayload {
  abn: string;
  taxType: string;
  periodId: string;
  amountCents: number;
  destination: EftDetails;
  metadata?: Record<string, string>;
}

export interface SubmitReleaseResult {
  provider_ref: string;
  submittedAt: string;
}

function providerBaseUrl(): string {
  return process.env.BANKING_PROVIDER_URL || "https://sandbox.bank.example";
}

function buildHeaders(idempotencyKey: string) {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  } as Record<string, string>;
}

export async function submitRelease(payload: SubmitReleasePayload, idempotencyKey: string): Promise<SubmitReleaseResult> {
  const abn = validateAbn(payload.abn);
  const destination = validateEft(payload.destination);
  assertAllowlisted(abn, "EFT", destination);

  const body = {
    abn,
    taxType: payload.taxType,
    periodId: payload.periodId,
    amountCents: payload.amountCents,
    destination,
    metadata: payload.metadata ?? {},
  };

  const submittedAt = new Date().toISOString();
  const dryRun = String(process.env.DRY_RUN || "").toLowerCase() === "true";

  console.info(JSON.stringify({
    event: "banking.release.submit",
    rail: "EFT",
    idempotencyKey,
    dryRun,
    abn,
    periodId: payload.periodId,
    amountCents: payload.amountCents,
  }));

  if (dryRun) {
    return { provider_ref: `dryrun-${idempotencyKey}`, submittedAt };
  }

  const response = await fetch(`${providerBaseUrl()}/eft/releases`, {
    method: "POST",
    headers: buildHeaders(idempotencyKey),
    body: JSON.stringify(body),
    agent: mtlsAgent,
  } as any);

  if (!response.ok) {
    const text = await response.text();
    console.error(JSON.stringify({
      event: "banking.release.error",
      rail: "EFT",
      status: response.status,
      body: text,
    }));
    throw new Error(`BANKING_PROVIDER_${response.status}`);
  }

  const data = await response.json();
  const providerRef = data?.provider_ref || data?.providerRef || data?.receipt_id;
  if (!providerRef) {
    throw new Error("BANKING_PROVIDER_NO_REF");
  }

  console.info(JSON.stringify({
    event: "banking.release.accepted",
    rail: "EFT",
    providerRef,
    submittedAt,
  }));

  return { provider_ref: providerRef, submittedAt };
}
