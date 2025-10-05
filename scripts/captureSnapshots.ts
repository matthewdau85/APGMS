import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { snapshotHash } from "../src/watchdog/monitor";

interface SnapshotConfig {
  baseUrl: string;
  abn: string;
  taxType: string;
  periodId: string;
  fixturesDir: string;
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url.toString()} -> HTTP ${response.status}`);
  }
  return response.json();
}

function buildConfig(): SnapshotConfig {
  const baseUrl =
    process.env.SNAPSHOT_BASE_URL ??
    process.env.WATCHDOG_BASE_URL ??
    "http://localhost:3000";
  const abn = process.env.SNAPSHOT_ABN ?? process.env.WATCHDOG_ABN ?? "12345678901";
  const taxType =
    process.env.SNAPSHOT_TAX_TYPE ?? process.env.WATCHDOG_TAX_TYPE ?? "GST";
  const periodId =
    process.env.SNAPSHOT_PERIOD_ID ?? process.env.WATCHDOG_PERIOD_ID ?? "2025-09";
  const fixturesDir = path.join(process.cwd(), "tests", "fixtures");
  return { baseUrl, abn, taxType, periodId, fixturesDir };
}

async function writeFixture(filename: string, payload: unknown, fixturesDir: string): Promise<void> {
  await mkdir(fixturesDir, { recursive: true });
  const filePath = path.join(fixturesDir, filename);
  const data = `${JSON.stringify(payload, null, 2)}\n`;
  await writeFile(filePath, data, "utf8");
  console.info(`[snapshot] wrote ${path.relative(process.cwd(), filePath)} (${snapshotHash(payload)})`);
}

function buildUrl(baseUrl: string, pathname: string, query: Record<string, string>): URL {
  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  return url;
}

async function main(): Promise<void> {
  const config = buildConfig();
  console.info(
    `[snapshot] Capturing fixtures from ${config.baseUrl} for ${config.abn}/${config.taxType}/${config.periodId}`
  );

  const query = {
    abn: config.abn,
    taxType: config.taxType,
    periodId: config.periodId,
  } satisfies Record<string, string>;

  const ledgerUrl = buildUrl(config.baseUrl, "/api/ledger", query);
  const evidenceUrl = buildUrl(config.baseUrl, "/api/evidence", query);

  const [ledger, evidence] = await Promise.all([
    fetchJson(ledgerUrl),
    fetchJson(evidenceUrl),
  ]);

  await writeFixture("ledger-snapshot.json", ledger, config.fixturesDir);
  await writeFixture("evidence-snapshot.json", evidence, config.fixturesDir);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[snapshot] failed: ${message}`);
  process.exitCode = 1;
});
