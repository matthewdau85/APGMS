import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const openapiPath = path.join(repoRoot, "openapi.json");
const targetPath = path.join(repoRoot, "src", "api", "types.ts");

const spec = JSON.parse(readFileSync(openapiPath, "utf8"));
const schemas = spec?.components?.schemas ?? {};
const requiredSchemas = [
  "ATOStatus",
  "BalanceResponse",
  "BasPreview",
  "BusinessProfile",
  "ConnStart",
  "Connection",
  "DashboardYesterday",
  "DepositRequest",
  "DepositResponse",
  "EvidenceBundle",
  "EvidenceLedgerDelta",
  "HTTPValidationError",
  "LedgerResponse",
  "LedgerRow",
  "MessageResponse",
  "ReleaseRequest",
  "ReleaseResponse",
  "Settings",
  "Transaction",
  "TransactionsResponse",
  "ValidationError",
];

for (const name of requiredSchemas) {
  if (!schemas[name]) {
    throw new Error(`Missing schema ${name} in openapi.json`);
  }
}

const template = readFileSync(path.join(repoRoot, "src", "api", "types.ts"), "utf8");
writeFileSync(targetPath, template);
console.log(`Types written to ${targetPath}`);
