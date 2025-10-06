#!/usr/bin/env tsx
import fs from "fs";
import path from "path";
import { selectKmsProvider } from "../../src/crypto/kms";

async function main() {
  const kms = selectKmsProvider();
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.resolve("artifacts", "kms_rotation", timestamp);
  fs.mkdirSync(base, { recursive: true });

  const signing = await kms.getSigningMaterial();
  const publicKeys = await kms.listPublicKeys();

  fs.writeFileSync(
    path.join(base, "signing.json"),
    JSON.stringify({ kid: signing.kid, rates_version: signing.ratesVersion }, null, 2)
  );

  fs.writeFileSync(
    path.join(base, "public_keys.json"),
    JSON.stringify(
      publicKeys.map((pk) => ({
        kid: pk.kid,
        rates_version: pk.ratesVersion,
        public_key_base64: Buffer.from(pk.publicKey).toString("base64"),
      })),
      null,
      2
    )
  );

  console.log(`[rotate] artifacts written to ${base}`);
}

main().catch((err) => {
  console.error("[rotate] failed", err);
  process.exitCode = 1;
});
