import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import nacl from "tweetnacl";
import { generatePack } from "../../scripts/evte/generate_pack";

const AUTH_HEADERS = {
  "X-APGMS-Admin": "true",
  "X-APGMS-MFA": "true"
};

test("proofs API exposes latest pack with signed checksum", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "evte-api-"));
  const date = "2025-10-05";
  const keyPair = nacl.sign.keyPair();
  const originalNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  process.env.EVTE_PACK_ROOT = tmpRoot;
  process.env.PROOFS_SIGNING_KEY_BASE64 = Buffer.from(keyPair.secretKey).toString("base64");
  process.env.PROOFS_SIGNING_KEY_ID = "test-key";
  await generatePack({ date, root: tmpRoot, quiet: true });

  const { app } = await import("../../src/index");
  const server = app.listen(0);
  try {
    const port = (server.address() as AddressInfo).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    const unauthorized = await fetch(`${baseUrl}/api/ops/compliance/proofs`);
    assert.strictEqual(unauthorized.status, 403);

    const indexResp = await fetch(`${baseUrl}/api/ops/compliance/proofs`, { headers: AUTH_HEADERS });
    assert.strictEqual(indexResp.status, 200);
    const indexData: ProofsResponse = await indexResp.json();
    assert.strictEqual(indexData.date, date);
    assert.ok(Array.isArray(indexData.files) && indexData.files.length >= 10);
    assert.ok(indexData.checksum.value.length > 10);
    const signature = Buffer.from(indexData.signedChecksum.signature, "base64");
    const checksumBuffer = Buffer.from(indexData.checksum.value, "hex");
    assert.ok(nacl.sign.detached.verify(checksumBuffer, signature, keyPair.publicKey), "checksum signature invalid");

    const downloadResp = await fetch(`${baseUrl}${indexData.downloadUrl}`, { headers: AUTH_HEADERS });
    assert.strictEqual(downloadResp.status, 200);
    const zipArrayBuffer = await downloadResp.arrayBuffer();
    const zipBuffer = Buffer.from(zipArrayBuffer);
    assert.ok(zipBuffer.length > 0, "zip payload empty");
    assert.ok(zipBuffer.includes(Buffer.from("manifest.json")), "zip missing manifest");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    if (typeof originalNodeEnv === "string") {
      process.env.NODE_ENV = originalNodeEnv;
    } else {
      delete process.env.NODE_ENV;
    }
    delete process.env.EVTE_PACK_ROOT;
    delete process.env.PROOFS_SIGNING_KEY_BASE64;
    delete process.env.PROOFS_SIGNING_KEY_ID;
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

type ProofsResponse = {
  date: string;
  generatedAt: string | null;
  files: { name: string; size: number; sha256: string }[];
  checksum: { algorithm: string; value: string };
  signedChecksum: { algorithm: string; signature: string; keyId?: string };
  metadata?: Record<string, unknown>;
  downloadUrl: string;
};
