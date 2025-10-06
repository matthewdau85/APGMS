import assert from "assert";
import { computeEntryDigest, computeRunningDigest } from "../../src/audit/appendOnly";

type Fixture = {
  at: Date;
  actor: string;
  action: string;
  payload: Record<string, unknown>;
};

const fixtures: Fixture[] = [
  {
    at: new Date("2025-05-01T08:00:00Z"),
    actor: "rails",
    action: "release",
    payload: { abn: "123", taxType: "PAYGW", periodId: "2025-Q2", amountCents: -150000 },
  },
  {
    at: new Date("2025-05-02T03:30:00Z"),
    actor: "portal",
    action: "download",
    payload: { periodId: "2025-Q2", userId: "ops@example.com" },
  },
  {
    at: new Date("2025-05-04T11:20:00Z"),
    actor: "system",
    action: "notify",
    payload: { periodId: "2025-Q2", channel: "email", template: "lodgement-reminder" },
  },
];

const digests = fixtures.map((entry) => computeEntryDigest(entry));

digests.forEach((digest) => {
  assert.strictEqual(digest.length, 64, "entry digest must be 64 hex characters");
});

let prevHash = "";
const chain = digests.map((digest) => {
  const running = computeRunningDigest(prevHash, digest);
  const prev = prevHash;
  prevHash = running;
  return { digest, running, prev };
});

chain.forEach((link, index) => {
  const expectedPrev = index === 0 ? "" : chain[index - 1].running;
  assert.strictEqual(link.prev, expectedPrev, `link ${index} should reference previous running hash`);
});

const tamperedDigest = computeEntryDigest({
  ...fixtures[1],
  action: "download", // same action
  payload: { periodId: "2025-Q2", userId: "threat@example.com" },
});
assert.notStrictEqual(tamperedDigest, chain[1].digest, "changing payload must change digest");

const tamperedRunning = computeRunningDigest(chain[0].running, tamperedDigest);
assert.notStrictEqual(
  tamperedRunning,
  chain[1].running,
  "running hash should change when a link is tampered"
);

console.log("hash_chain.test.ts passed");
