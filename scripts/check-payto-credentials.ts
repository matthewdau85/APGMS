#!/usr/bin/env tsx
import fs from "fs";
import path from "path";

const requiredVars = [
  "PAYTO_BANK_PARTICIPANT_ID",
  "PAYTO_BANK_CLIENT_ID",
  "PAYTO_BANK_CLIENT_SECRET",
  "PAYTO_GATEWAY_URL",
];

const fileVars = [
  "PAYTO_BANK_TLS_CERT",
  "PAYTO_BANK_TLS_KEY",
  "PAYTO_BANK_TLS_CA",
];

function resolveFile(filePath: string) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

const missing: string[] = [];

requiredVars.forEach((name) => {
  if (!process.env[name] || process.env[name]?.trim() === "") {
    missing.push(name);
  }
});

fileVars.forEach((name) => {
  const value = process.env[name];
  if (!value) {
    missing.push(name);
    return;
  }
  const resolved = resolveFile(value);
  if (!fs.existsSync(resolved)) {
    missing.push(`${name} (missing file: ${resolved})`);
  }
});

if (missing.length > 0) {
  console.error("PayTo credential check failed:\n" + missing.map((m) => ` - ${m}`).join("\n"));
  process.exit(1);
}

console.log("PayTo credential check passed. Participant: %s, Gateway: %s", process.env.PAYTO_BANK_PARTICIPANT_ID, process.env.PAYTO_GATEWAY_URL);
