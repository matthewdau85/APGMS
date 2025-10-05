import assert from "node:assert/strict";
import * as ed from "tweetnacl";
import { getKmsImplementations } from "@core/ports/kms";
import type { RuntimeMode } from "@core/runtime/mode";

const MODES: RuntimeMode[] = ["mock", "real"];

function compareResults(results: Record<RuntimeMode, { ok: boolean; code?: string }>) {
  const reference = results["mock"];
  for (const mode of MODES) {
    const current = results[mode];
    assert.equal(current.ok, reference.ok, `${mode} verify.ok diverged`);
    assert.equal(current.code ?? null, reference.code ?? null, `${mode} verify.code diverged`);
  }
}

export async function runContractTests() {
  const keyPair = ed.sign.keyPair();
  process.env.ED25519_PUBLIC_KEY_BASE64 = Buffer.from(keyPair.publicKey).toString("base64");

  const payload = new TextEncoder().encode("contract-test-payload");
  const signature = ed.sign.detached(payload, keyPair.secretKey);

  const factories = getKmsImplementations();
  const results: Record<RuntimeMode, { ok: boolean; code?: string }> = {
    mock: { ok: false },
    real: { ok: false },
    shadow: { ok: false },
  } as any;

  for (const mode of MODES) {
    const kms = factories[mode]();
    results[mode] = await kms.verify(payload, signature);
  }

  compareResults(results);

  // Tampered signature should fail across providers
  const badSignature = signature.slice();
  badSignature[0] ^= 0xff;

  const badResults: Record<RuntimeMode, { ok: boolean; code?: string }> = {
    mock: { ok: true },
    real: { ok: true },
    shadow: { ok: true },
  } as any;

  for (const mode of MODES) {
    const kms = factories[mode]();
    badResults[mode] = await kms.verify(payload, badSignature);
    assert.equal(badResults[mode].ok, false, `${mode} should reject invalid signature`);
    assert.ok(badResults[mode].code, `${mode} should provide error code`);
  }

  compareResults(badResults);
}
