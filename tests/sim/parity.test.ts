import assert from "node:assert/strict";
import test from "node:test";

type ReleaseResult = {
  providerRef: string;
  amountCents: number;
  idempotencyKey: string;
};

type EvidenceBundle = {
  settlement: { provider_ref: string };
  rules: { manifest_sha256: string };
  narrative: string;
  gate: { state: string };
};

type ReconRecord = {
  providerRef: string;
  settlementId: string;
};

class Simulator {
  private releases = new Map<string, ReleaseResult>();

  release(idempotencyKey: string, amountCents: number): ReleaseResult {
    const existing = this.releases.get(idempotencyKey);
    if (existing) {
      return existing;
    }
    const providerRef = `SIM-${idempotencyKey.slice(0, 12)}`;
    const result: ReleaseResult = { providerRef, amountCents, idempotencyKey };
    this.releases.set(idempotencyKey, result);
    return result;
  }
}

class ReconImporter {
  private records = new Map<string, ReconRecord>();

  importRelease(release: ReleaseResult, settlementId: string): ReconRecord {
    const record: ReconRecord = {
      providerRef: release.providerRef,
      settlementId,
    };
    this.records.set(release.providerRef, record);
    return record;
  }

  get(providerRef: string): ReconRecord | undefined {
    return this.records.get(providerRef);
  }
}

function buildEvidence(release: ReleaseResult, recon: ReconRecord): EvidenceBundle {
  const manifest = `sha256:${release.providerRef}`;
  return {
    settlement: { provider_ref: recon.providerRef },
    rules: { manifest_sha256: manifest },
    narrative: `Release ${release.providerRef} for ${release.amountCents} cents`,
    gate: { state: "READY" },
  };
}

test("simulator reuse provider_ref for identical idempotency keys", () => {
  const simulator = new Simulator();
  const first = simulator.release("abc-123-idem-key", 100_00);
  const second = simulator.release("abc-123-idem-key", 100_00);
  assert.equal(first.providerRef, second.providerRef);
  assert.equal(first.providerRef, "SIM-abc-123-idem");
});

test("evidence bundle includes manifest and narrative", () => {
  const simulator = new Simulator();
  const recon = new ReconImporter();
  const release = simulator.release("idem-456", 50_00);
  const reconRecord = recon.importRelease(release, "settlement-1");
  const evidence = buildEvidence(release, reconRecord);
  assert.equal(evidence.settlement.provider_ref, release.providerRef);
  assert.ok(evidence.rules.manifest_sha256.startsWith("sha256:"));
  assert.match(evidence.narrative, /Release SIM-/);
});

test("gate state is present for downstream guards", () => {
  const simulator = new Simulator();
  const recon = new ReconImporter();
  const release = simulator.release("idem-789", 75_00);
  const reconRecord = recon.importRelease(release, "settlement-2");
  const evidence = buildEvidence(release, reconRecord);
  assert.equal(evidence.gate.state, "READY");
});

