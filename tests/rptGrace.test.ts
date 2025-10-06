import assert from "assert";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import nacl from "tweetnacl";

import { LocalEd25519Provider } from "../src/crypto/providers/localEd25519";
import {
  addKey,
  activateKey,
  retireKey,
  getPublicKeys,
  resetProviderForTests,
  sign,
  verifySignature,
} from "../src/crypto/kms";

function withTempStore(fn: (storePath: string) => Promise<void>) {
  const dir = mkdtempSync(path.join(tmpdir(), "kms-test-"));
  const storePath = path.join(dir, "store.json");
  return fn(storePath).finally(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      // ignore cleanup errors
    }
  });
}

async function unitTestGraceAcceptance() {
  await withTempStore(async (storePath) => {
    const provider = new LocalEd25519Provider({ storePath });
    const initial = await provider.sign(new TextEncoder().encode("baseline"));
    const newKey = await provider.addKey();
    const graceUntil = new Date(Date.now() + 3 * 24 * 3600 * 1000);
    await provider.activateKey(newKey.kid, graceUntil);

    const msgOld = new TextEncoder().encode("old-grace");
    const msgNew = new TextEncoder().encode("new-active");
    const sigOld = await provider.sign(msgOld, initial.kid);
    const sigNew = await provider.sign(msgNew, newKey.kid);

    const keysetDuring = await provider.getPublicKeys();
    assert(keysetDuring.some((k) => k.kid === initial.kid), "old key missing during grace");
    assert(keysetDuring.some((k) => k.kid === newKey.kid), "new key missing during grace");
    assert(nacl.sign.detached.verify(msgOld, sigOld.signature, keysetDuring.find((k) => k.kid === initial.kid)!.publicKey));
    assert(nacl.sign.detached.verify(msgNew, sigNew.signature, keysetDuring.find((k) => k.kid === newKey.kid)!.publicKey));

    await provider.retireKey(initial.kid);
    const after = await provider.getPublicKeys();
    assert(!after.some((k) => k.kid === initial.kid), "old key still present after retirement");
    assert(after.some((k) => k.kid === newKey.kid), "new key missing after retirement");
  });
}

async function integrationTestGraceWindow() {
  await withTempStore(async (storePath) => {
    process.env.LOCAL_KMS_STORE_PATH = storePath;
    process.env.FEATURE_KMS = "true";
    process.env.KMS_PROVIDER = "local";
    await resetProviderForTests();

    const initialMsg = new TextEncoder().encode("integration-old");
    const initialSign = await sign(initialMsg);
    const oldKid = initialSign.kid;

    const newKey = await addKey();
    const graceUntil = new Date(Date.now() + 5 * 24 * 3600 * 1000);
    await activateKey(newKey.kid, graceUntil);

    const duringOldPayload = new TextEncoder().encode("during-grace-old");
    const duringOldSig = await sign(duringOldPayload, oldKid);
    const duringNewPayload = new TextEncoder().encode("during-grace-new");
    const duringNewSig = await sign(duringNewPayload, newKey.kid);

    const keysetDuring = await getPublicKeys();
    const oldKeyRecord = keysetDuring.find((k) => k.kid === oldKid);
    const newKeyRecord = keysetDuring.find((k) => k.kid === newKey.kid);
    assert(oldKeyRecord, "old kid absent during grace");
    assert(newKeyRecord, "new kid absent during grace");
    assert(nacl.sign.detached.verify(duringOldPayload, duringOldSig.signature, oldKeyRecord!.publicKey), "old signature invalid during grace");
    assert(nacl.sign.detached.verify(duringNewPayload, duringNewSig.signature, newKeyRecord!.publicKey), "new signature invalid during grace");

    await retireKey(oldKid);
    const keysetAfter = await getPublicKeys();
    const oldAfter = keysetAfter.find((k) => k.kid === oldKid);
    const newAfter = keysetAfter.find((k) => k.kid === newKey.kid);
    assert(!oldAfter, "old key still available after grace");
    assert(newAfter, "new key missing after grace");
    const okAfter = await verifySignature(duringOldPayload, duringOldSig.signature, oldKid);
    assert(!okAfter, "old signature still verifies after retirement");
  });
}

(async () => {
  await unitTestGraceAcceptance();
  await integrationTestGraceWindow();
  console.log("rptGrace.test.ts passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
