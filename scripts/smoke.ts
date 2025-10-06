import assert from "node:assert";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { setTimeout as wait } from "node:timers/promises";

const DEFAULT_DB = "postgresql://postgres:postgres@127.0.0.1:5432/apgms";
const DATABASE_URL = process.env.DATABASE_URL ?? DEFAULT_DB;
const PORT = Number(process.env.SMOKE_PORT ?? 4010);
const BASE_URL = `http://127.0.0.1:${PORT}`;

const SECRET_BASE64 = process.env.RPT_ED25519_SECRET_BASE64 ??
  "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGKiOPddAnxlf1S2y08ul1yymcJvx2UEhvzdIgBtA9vXA==";
const PUBLIC_BASE64 = process.env.ED25519_PUBLIC_KEY_BASE64 ??
  "iojj3XQJ8ZX9UtstPLpdcspnCb8dlBIb83SIAbQPb1w=";
const PRN = process.env.ATO_PRN ?? "ATO-DEMO-PRN";

const DEMO_ABN = process.env.DEMO_ABN ?? "53004085616";
const DEMO_TAX_TYPE = process.env.DEMO_TAX_TYPE ?? "GST";
const DEMO_PERIOD_ID = process.env.DEMO_PERIOD_ID ?? "2025-09";
const DEPOSIT_CENTS = Number(process.env.DEMO_DEPOSIT_CENTS ?? 125_00);

const tsxBin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tsx.cmd" : "tsx"
);

function spawnServer() {
  const env = {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL,
    RPT_ED25519_SECRET_BASE64: SECRET_BASE64,
    ED25519_PUBLIC_KEY_BASE64: PUBLIC_BASE64,
    ATO_PRN: PRN,
  };

  const child = spawn(tsxBin, ["src/index.ts"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    process.stderr.write(chunk);
  });

  return child;
}

async function waitForHealth(signal: AbortSignal) {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (signal.aborted) throw new Error("Aborted while waiting for health");
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
    } catch {
      // ignore until ready
    }
    await wait(200);
  }
  throw new Error("Server did not become healthy in time");
}

async function postJson(pathname: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${pathname} failed: ${res.status} ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function getBuffer(pathname: string) {
  const res = await fetch(`${BASE_URL}${pathname}`);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GET ${pathname} failed: ${res.status} ${text}`);
  }
  const arr = await res.arrayBuffer();
  return Buffer.from(arr);
}

function extractStoredFile(buffer: Buffer, expectedName: string): Buffer {
  if (buffer.readUInt32LE(0) !== 0x04034b50) {
    throw new Error("ZIP local header signature missing");
  }
  const compSize = buffer.readUInt32LE(18);
  const nameLen = buffer.readUInt16LE(26);
  const extraLen = buffer.readUInt16LE(28);
  const nameStart = 30;
  const dataStart = nameStart + nameLen + extraLen;
  const name = buffer.slice(nameStart, nameStart + nameLen).toString("utf8");
  if (name !== expectedName) {
    throw new Error(`Unexpected zip entry: ${name}`);
  }
  return buffer.slice(dataStart, dataStart + compSize);
}

async function main() {
  const controller = new AbortController();
  const server = spawnServer();

  const onExit = (code: number | null) => {
    if (code !== null && code !== 0) {
      controller.abort();
      throw new Error(`Server exited early with code ${code}`);
    }
  };
  server.on("exit", onExit);

  try {
    await waitForHealth(controller.signal);

    console.log("→ POST /payments/deposit");
    const depositResp = await postJson("/payments/deposit", {
      abn: DEMO_ABN,
      taxType: DEMO_TAX_TYPE,
      periodId: DEMO_PERIOD_ID,
      amountCents: DEPOSIT_CENTS,
    });
    assert.ok(depositResp.ok ?? depositResp.balance_after_cents !== undefined, "deposit response missing ok/balance");

    console.log("→ POST /reconcile/close-and-issue");
    const rptResp = await postJson("/reconcile/close-and-issue", {
      abn: DEMO_ABN,
      taxType: DEMO_TAX_TYPE,
      periodId: DEMO_PERIOD_ID,
    });
    assert.ok(rptResp.signature, "close-and-issue did not return signature");

    console.log("→ POST /payments/release?rail=EFT&dry_run=1");
    const releaseResp = await postJson(`/payments/release?rail=EFT&dry_run=1`, {
      abn: DEMO_ABN,
      taxType: DEMO_TAX_TYPE,
      periodId: DEMO_PERIOD_ID,
      amountCents: -DEPOSIT_CENTS,
    });
    assert.ok(releaseResp.dry_run ?? releaseResp.ok, "release response missing ok/dry_run flag");

    console.log("→ GET /evidence/:periodId/zip");
    const zipBuffer = await getBuffer(`/evidence/${encodeURIComponent(DEMO_PERIOD_ID)}/zip?abn=${encodeURIComponent(DEMO_ABN)}&taxType=${encodeURIComponent(DEMO_TAX_TYPE)}`);
    assert.ok(zipBuffer.length > 0, "zip download empty");

    const evidenceBuf = extractStoredFile(zipBuffer, "evidence.json");
    const evidenceJson = JSON.parse(evidenceBuf.toString("utf8"));
    assert.ok(evidenceJson.rpt, "evidence bundle missing rpt");
    assert.ok(evidenceJson.ledger_hash ?? evidenceJson.ledger?.running_hash, "evidence bundle missing ledger hash");
    assert.strictEqual(evidenceJson.narrative, "Demo run", "narrative mismatch");

    console.log("Smoke test complete ✅");
  } finally {
    controller.abort();
    server.off("exit", onExit);
    server.kill("SIGINT");
    await wait(250);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
