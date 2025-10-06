import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidence, importRecon, simulateRelease } from "../../src/sim/parity";
import { sha256Hex } from "../../src/crypto/merkle";

test("simulation release -> recon -> evidence keeps provider_ref stable", () => {
  const idempotencyKey = "sim-release-key";
  const manifestSource = "rules-manifest-v1";
  const manifestSha = sha256Hex(manifestSource);

  const release = simulateRelease({
    idempotencyKey,
    amountCents: 12345,
    abn: "12345678901",
    taxType: "GST",
    periodId: "2025-09",
    rail: "EFT"
  });

  assert.equal(release.provider_ref, idempotencyKey, "release provider_ref should equal idempotency key");
  assert.ok(release.bank_receipt_hash.startsWith("bank:"));

  const recon = importRecon(release, manifestSha);
  assert.equal(recon.provider_ref, idempotencyKey, "recon provider_ref must match release");
  assert.equal(recon.manifest_sha256, manifestSha);

  const evidence = buildEvidence(recon, release);
  assert.equal(evidence.provider_ref, idempotencyKey, "evidence provider_ref must match recon");
  assert.equal(evidence.rules.manifest_sha256, manifestSha);
  assert.ok(evidence.rules.narrative.includes(idempotencyKey));
});
