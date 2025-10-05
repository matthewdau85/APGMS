import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeStaleness,
  extractEvidenceFreshness,
  extractLedgerFreshness,
} from "../../src/watchdog/monitor";

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures");

async function loadFixture<T = unknown>(name: string): Promise<T> {
  const file = path.join(FIXTURES_DIR, name);
  const contents = await readFile(file, "utf8");
  return JSON.parse(contents) as T;
}

test("extractLedgerFreshness finds the newest ledger entry", async () => {
  const ledger = await loadFixture("ledger-snapshot.json");
  const latest = extractLedgerFreshness(ledger);
  assert.equal(latest, "2025-10-04T20:17:18.796Z");
});

test("extractEvidenceFreshness considers deltas, RPT and metadata", async () => {
  const evidence = await loadFixture("evidence-snapshot.json");
  const latest = extractEvidenceFreshness(evidence);
  assert.equal(latest, "2025-10-04T20:32:18.735Z");
});

test("computeStaleness flags data older than the threshold", async () => {
  const ledger = await loadFixture("ledger-snapshot.json");
  const latest = extractLedgerFreshness(ledger);
  assert.ok(latest);
  const notStale = computeStaleness(latest, 5, new Date("2025-10-04T20:21:18.796Z"));
  assert.equal(notStale.stale, false);
  const stale = computeStaleness(latest, 2, new Date("2025-10-04T20:21:18.796Z"));
  assert.equal(stale.stale, true);
});
