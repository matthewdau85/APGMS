import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { generatePack } from "../../scripts/evte/generate_pack";

const EXPECTED_FILES = [
  "controls_matrix.md",
  "security_controls_matrix.xlsx",
  "PIA.pdf",
  "IR_DR_report.md",
  "AccessReview.csv",
  "Rules_changelog.md",
  "KMS_rotation_log.json",
  "Rails_probe_log.json",
  "SLO_snapshot.json",
  "Test_run_report.json",
  "manifest.json"
];

test("generate_pack produces all required artifacts", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "evte-pack-"));
  try {
    const date = "2025-10-05";
    const result = await generatePack({ date, root: tmpRoot, quiet: true });
    const packDir = result.packDir;
    assert.ok(packDir.endsWith(path.join(tmpRoot, date)));

    for (const fileName of EXPECTED_FILES) {
      const filePath = path.join(packDir, fileName);
      try {
        await fs.access(filePath);
      } catch {
        assert.fail(`Expected artifact missing: ${fileName}`);
      }
    }

    const manifestRaw = await fs.readFile(path.join(packDir, "manifest.json"), "utf8");
    const manifest = JSON.parse(manifestRaw);
    assert.strictEqual(manifest.pack.bundle_sha256, result.bundleSha256);
    assert.deepStrictEqual(
      manifest.pack.files.map((f: any) => f.name).sort(),
      result.files.map(f => f.name).sort()
    );

    const accessRaw = await fs.readFile(path.join(packDir, "AccessReview.csv"), "utf8");
    const [, ...rows] = accessRaw.trim().split(/\r?\n/);
    const now = new Date(`${date}T12:00:00Z`).getTime();
    for (const row of rows) {
      const [timestamp] = row.split(",");
      const delta = Math.abs(now - new Date(timestamp).getTime());
      const days = delta / (1000 * 60 * 60 * 24);
      assert.ok(days <= 30.5, `Access review entry too old: ${timestamp}`);
    }

    const kms = JSON.parse(await fs.readFile(path.join(packDir, "KMS_rotation_log.json"), "utf8"));
    assert.ok(kms.old_key_id && kms.new_key_id, "KMS rotation log missing key ids");

    const testRuns = JSON.parse(await fs.readFile(path.join(packDir, "Test_run_report.json"), "utf8"));
    assert.ok(testRuns.runs.golden && testRuns.runs.boundary && testRuns.runs.e2e, "Test run suites missing");
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});
