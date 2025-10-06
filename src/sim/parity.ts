import { sha256Hex } from "../crypto/merkle";

export interface SimReleaseInput {
  idempotencyKey: string;
  amountCents: number;
  abn: string;
  taxType: string;
  periodId: string;
  rail: "EFT" | "BPAY";
}

export interface SimReleaseEvent {
  provider_ref: string;
  bank_receipt_hash: string;
  amount_cents: number;
  rail: "EFT" | "BPAY";
}

export interface ReconImportRow {
  provider_ref: string;
  amount_cents: number;
  manifest_sha256: string;
  narrative: string;
}

export interface EvidenceSummary {
  provider_ref: string;
  rules: {
    manifest_sha256: string;
    narrative: string;
  };
  bank_receipt_hash: string;
}

export function simulateRelease(input: SimReleaseInput): SimReleaseEvent {
  const provider_ref = input.idempotencyKey;
  const bank_receipt_hash = `bank:${sha256Hex(provider_ref).slice(0, 24)}`;
  return {
    provider_ref,
    bank_receipt_hash,
    amount_cents: input.amountCents,
    rail: input.rail
  };
}

export function importRecon(release: SimReleaseEvent, manifestSha: string): ReconImportRow {
  return {
    provider_ref: release.provider_ref,
    amount_cents: release.amount_cents,
    manifest_sha256: manifestSha,
    narrative: `Recon import for ${release.provider_ref}`
  };
}

export function buildEvidence(recon: ReconImportRow, release: SimReleaseEvent): EvidenceSummary {
  return {
    provider_ref: recon.provider_ref,
    bank_receipt_hash: release.bank_receipt_hash,
    rules: {
      manifest_sha256: recon.manifest_sha256,
      narrative: recon.narrative
    }
  };
}
