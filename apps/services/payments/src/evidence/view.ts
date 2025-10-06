import type { RulesManifest } from "./rulesManifest.js";

export type EvidencePeriod = {
  abn: string;
  taxType: string;
  periodId: string;
  narrative: string | null;
  runningBalanceHash: string | null;
};

export type EvidenceRelease = {
  provider_ref: string;
  amount_cents: number;
  provider_paid_at: string | null;
  hash_after: string | null;
};

export type EvidenceApproval = {
  actor: string;
  note: string | null;
  approved_at: string;
};

export type EvidenceView = {
  abn: string;
  taxType: string;
  periodId: string;
  running_hash: string | null;
  narrative: string | null;
  rules: { manifest_sha256: string; version: string };
  settlement: { provider_ref: string; amount: number; paidAt: string | null } | null;
  approvals: EvidenceApproval[];
};

export function buildEvidenceView(
  period: EvidencePeriod,
  release: EvidenceRelease | null,
  approvals: EvidenceApproval[],
  manifest: RulesManifest,
): EvidenceView {
  return {
    abn: period.abn,
    taxType: period.taxType,
    periodId: period.periodId,
    running_hash: period.runningBalanceHash || release?.hash_after || null,
    narrative: period.narrative,
    rules: { manifest_sha256: manifest.manifest_sha256, version: manifest.version },
    settlement: release
      ? {
          provider_ref: release.provider_ref,
          amount: Math.abs(release.amount_cents),
          paidAt: release.provider_paid_at,
        }
      : null,
    approvals,
  };
}

