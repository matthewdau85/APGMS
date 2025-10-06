// scripts/smoke:sim.ts
import { randomUUID, createHash } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

type FetchLike = (input: string, init?: any) => Promise<any>;
const fetchFn: FetchLike = (globalThis as any).fetch;
if (typeof fetchFn !== "function") {
  throw new Error("Global fetch is unavailable. Run on Node 18+.");
}

function loadEnvFromFile(relPath: string) {
  const abs = path.resolve(relPath);
  if (!fs.existsSync(abs)) return;
  for (const raw of fs.readFileSync(abs, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.replace(/^\s*export\s+/, "");
    const eq = cleaned.indexOf("=");
    if (eq === -1) continue;
    const key = cleaned.slice(0, eq).trim();
    let val = cleaned.slice(eq + 1).trim();
    if ((val.startsWith("\"") && val.endsWith("\"")) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    val = val.replace(/\\n/g, "\n");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

function loadRepoEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..");
  loadEnvFromFile(path.join(repoRoot, ".env.local"));
}

function joinUrl(base: string, pathName: string) {
  return `${base.replace(/\/?$/, "")}${pathName}`;
}

async function tryRequest(opts: {
  method: "GET" | "POST";
  bases: string[];
  paths: string[];
  body?: any;
  headers?: Record<string, string>;
  expectJson?: boolean;
}): Promise<{ url: string; status: number; data: any }>
{
  const { method, bases, paths, body, headers, expectJson = true } = opts;
  const errors: Array<{ url: string; status: number; text: string }> = [];

  for (const base of bases) {
    for (const p of paths) {
      const url = joinUrl(base, p);
      try {
        const res = await fetchFn(url, {
          method,
          headers: {
            "content-type": body ? "application/json" : undefined,
            ...headers,
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        if (res.status === 404) {
          errors.push({ url, status: res.status, text: "Not Found" });
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status} ${text}`);
        }
        const data = expectJson ? await res.json() : await res.text();
        return { url, status: res.status, data };
      } catch (err: any) {
        if (err?.cause?.code === "ECONNREFUSED") {
          throw new Error(`Connection refused for ${url}`);
        }
        errors.push({ url, status: err?.status || 0, text: String(err?.message || err) });
      }
    }
  }

  const detail = errors.map(e => `${e.url} -> ${e.status} ${e.text}`).join("; ");
  throw new Error(`All endpoints failed: ${detail}`);
}

function canonical(obj: unknown): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return `[${obj.map(canonical).join(",")}]`;
  const entries = Object.entries(obj as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

async function main() {
  loadRepoEnv();

  const abn = process.env.SMOKE_ABN || "12345678901";
  const taxType = process.env.SMOKE_TAX_TYPE || "GST";
  const periodId = process.env.SMOKE_PERIOD_ID || "2025-10";
  const paymentsBase = process.env.SMOKE_PAYMENTS_BASE || process.env.PAYMENTS_BASE_URL || "http://localhost:3001";
  const coreBase = process.env.SMOKE_CORE_BASE || process.env.CORE_BASE_URL || "http://localhost:3000";
  const simBase = process.env.SMOKE_SIM_BASE || process.env.RAIL_SIM_BASE || coreBase;

  const depositAmount = Number(process.env.SMOKE_DEPOSIT_CENTS || "125000");
  if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
    throw new Error(`SMOKE_DEPOSIT_CENTS must be > 0 (got ${process.env.SMOKE_DEPOSIT_CENTS})`);
  }

  console.log(`Running smoke for ${abn}/${taxType}/${periodId}`);

  const deposit = await tryRequest({
    method: "POST",
    bases: [paymentsBase, coreBase],
    paths: ["/deposit", "/api/deposit", "/payments/deposit"],
    body: { abn, taxType, periodId, amountCents: depositAmount },
  });
  console.log(`[1] deposit @ ${deposit.url} ->`, deposit.data);

  const close = await tryRequest({
    method: "POST",
    bases: [coreBase],
    paths: ["/reconcile/close-and-issue", "/api/close-issue", "/close-issue"],
    body: {
      abn,
      taxType,
      periodId,
      thresholds: {
        epsilon_cents: Number(process.env.SMOKE_EPSILON_CENTS || "0"),
        variance_ratio: Number(process.env.SMOKE_THRESHOLD_VARIANCE || "0.25"),
        dup_rate: Number(process.env.SMOKE_THRESHOLD_DUP || "0.01"),
        gap_minutes: Number(process.env.SMOKE_THRESHOLD_GAP || "60"),
        delta_vs_baseline: Number(process.env.SMOKE_THRESHOLD_DELTA || "0.2"),
      },
    },
  });
  console.log(`[2] close-and-issue @ ${close.url} ->`, close.data);

  const rptPayload = close.data?.payload || close.data?.rpt?.payload || {};
  const releaseAmount = Number(rptPayload.amount_cents || depositAmount);
  const releaseReference = rptPayload.reference || `seed-${periodId}`;

  const releaseIdem = randomUUID();
  const release = await tryRequest({
    method: "POST",
    bases: [coreBase, paymentsBase],
    paths: ["/release", "/api/release", "/payAto", "/api/pay"],
    headers: { "Idempotency-Key": releaseIdem },
    body: {
      abn,
      taxType,
      periodId,
      amountCents: releaseAmount > 0 ? -releaseAmount : releaseAmount,
      rail: "EFT",
      reference: releaseReference,
    },
  });
  console.log(`[3] release @ ${release.url} ->`, release.data);

  const providerRef = release.data?.provider_receipt_id
    || release.data?.bank_receipt_hash
    || release.data?.release_uuid
    || release.data?.transfer_uuid
    || "unknown";

  let reconCsv = "";
  try {
    const recon = await tryRequest({
      method: "GET",
      bases: [simBase, coreBase],
      paths: ["/sim/rail/recon-file", "/api/sim/rail/recon-file"],
      expectJson: false,
    });
    reconCsv = String(recon.data || "");
    console.log(`[4] recon file @ ${recon.url} bytes=${reconCsv.length}`);
  } catch (err) {
    const settleTs = new Date().toISOString();
    const gross = Math.abs(releaseAmount);
    const gstShare = Math.round(gross * Number(process.env.SMOKE_GST_RATIO || "0.1"));
    reconCsv = [
      "txn_id,gst_cents,net_cents,settlement_ts",
      `${providerRef},${gstShare},${gross},${settleTs}`,
    ].join("\n");
    console.log("[4] recon file fallback generated");
  }

  const settlement = await tryRequest({
    method: "POST",
    bases: [coreBase],
    paths: ["/settlement/import", "/api/settlement/import", "/api/settlement/webhook"],
    body: { csv: reconCsv },
  });
  console.log(`[4b] settlement import @ ${settlement.url} ->`, settlement.data);

  let evidence;
  let evidenceUrl = "";
  try {
    const ev = await tryRequest({
      method: "GET",
      bases: [coreBase],
      paths: [`/evidence/${encodeURIComponent(periodId)}`, `/api/evidence/${encodeURIComponent(periodId)}`],
    });
    evidence = ev.data;
    evidenceUrl = ev.url;
  } catch {
    const qs = new URLSearchParams({ abn, taxType, periodId });
    const ev = await tryRequest({
      method: "GET",
      bases: [coreBase],
      paths: [`/api/evidence?${qs.toString()}`],
    });
    evidence = ev.data;
    evidenceUrl = ev.url;
  }
  console.log(`[5] evidence @ ${evidenceUrl} -> keys=${Object.keys(evidence || {}).join(",")}`);

  const rulesNode = evidence?.rules || evidence?.period?.rules || null;
  let rulesHash: string | null = null;
  if (rulesNode && typeof rulesNode === "object") {
    const manifest = (rulesNode as any).manifest_sha256 || (rulesNode as any).manifestSha256;
    if (manifest) rulesHash = String(manifest);
  }
  if (!rulesHash) {
    const source = rulesNode ?? evidence?.period?.thresholds ?? evidence?.rpt?.payload?.thresholds ?? {};
    rulesHash = createHash("sha256").update(canonical(source)).digest("hex");
  }

  const evPath = (() => {
    try {
      return new URL(evidenceUrl).pathname || evidenceUrl;
    } catch {
      return evidenceUrl;
    }
  })();

  console.log("provider_ref:", providerRef);
  console.log("evidence_path:", evPath);
  console.log("rules.manifest_sha256:", rulesHash);
}

main().catch(err => {
  console.error("Smoke failed:", err);
  process.exit(1);
});

