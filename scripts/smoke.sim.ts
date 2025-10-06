import { URLSearchParams } from "url";

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const abn = process.env.SMOKE_ABN || "12345678901";
const taxType = process.env.SMOKE_TAX_TYPE || "GST";
const periodId = process.env.SMOKE_PERIOD_ID || "2025-09";
const rail = "EFT";
const reference = process.env.SMOKE_REFERENCE || "PRN-123456";
const amountCents = Number(process.env.SMOKE_AMOUNT_CENTS || 150000);
const idemKey = process.env.SMOKE_IDEM_KEY || "SIM-SMOKE-KEY";

async function release() {
  const res = await fetch(`${BASE}/payments/release`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Idempotency-Key": idemKey,
    },
    body: JSON.stringify({ abn, taxType, periodId, amountCents, rail, reference }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`release failed: ${text}`);
  }
  return res.json();
}

async function reconFile() {
  const params = new URLSearchParams();
  const res = await fetch(`${BASE}/sim/rail/recon-file?${params.toString()}`);
  if (!res.ok) throw new Error(`recon export failed: ${res.statusText}`);
  return res.text();
}

async function importRecon(csv: string) {
  const res = await fetch(`${BASE}/settlement/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ csv }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`import failed: ${text}`);
  }
  return res.json();
}

async function fetchEvidence() {
  const params = new URLSearchParams({ abn, taxType, periodId });
  const res = await fetch(`${BASE}/api/evidence?${params.toString()}`);
  if (!res.ok) throw new Error(`evidence failed: ${res.statusText}`);
  return res.json();
}

async function main() {
  const rel = await release();
  console.log("release provider_ref", rel.provider_ref);

  const csv = await reconFile();
  await importRecon(csv);

  const evidence = await fetchEvidence();
  const providerRef = evidence?.settlement?.provider_ref;
  const manifest = evidence?.rules?.manifest_sha256;
  if (!providerRef || !manifest) {
    throw new Error("evidence missing settlement or rules manifest");
  }
  console.log("evidence provider_ref", providerRef);
  console.log("rules manifest sha", manifest);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
