import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import { snapshotHash } from "../../src/watchdog/monitor";

const FIXTURES_DIR = path.join(process.cwd(), "tests", "fixtures");

async function loadFixture(name: string): Promise<unknown> {
  const file = path.join(FIXTURES_DIR, name);
  const contents = await readFile(file, "utf8");
  return JSON.parse(contents);
}

test("ledger snapshot hash remains stable", async () => {
  const ledger = await loadFixture("ledger-snapshot.json");
  assert.equal(snapshotHash(ledger), "c2b6ba52942fd314c18589d6d51531306f9a52e5cc53e61fcdfff70666af1a48");
});

test("evidence snapshot hash remains stable", async () => {
  const evidence = await loadFixture("evidence-snapshot.json");
  assert.equal(snapshotHash(evidence), "78946031641f54b1b2b4ace1434c64b3861eb0f51d445df8f195dbd20cf88a7b");
});
