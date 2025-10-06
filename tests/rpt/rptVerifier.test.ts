import { strict as assert } from "assert";
import nacl from "tweetnacl";
import { signRptPayload, RptPayload, resetRptSignerForTests } from "../../src/crypto/rptSigner";
import { verifySignedRpt, resetRptVerifierCache } from "../../src/crypto/rptVerifier";

const dayMs = 24 * 60 * 60 * 1000;

interface KeyMaterial {
  kid: string;
  secretB64: string;
  publicB64: string;
}

function makeKey(kid: string): KeyMaterial {
  const pair = nacl.sign.keyPair();
  return {
    kid,
    secretB64: Buffer.from(pair.secretKey).toString("base64"),
    publicB64: Buffer.from(pair.publicKey).toString("base64"),
  };
}

function basePayload(overrides: Partial<RptPayload> = {}): RptPayload {
  return {
    entity_id: overrides.entity_id ?? "53004085616",
    period_id: overrides.period_id ?? "2024Q4",
    tax_type: overrides.tax_type ?? "GST",
    amount_cents: overrides.amount_cents ?? 12345,
    merkle_root: overrides.merkle_root ?? "abc123",
    running_balance_hash: overrides.running_balance_hash ?? "def456",
    anomaly_vector: overrides.anomaly_vector ?? {},
    thresholds: overrides.thresholds ?? { epsilon_cents: 50 },
    rail_id: overrides.rail_id ?? "EFT",
    reference: overrides.reference ?? "REF123",
    expiry_ts:
      overrides.expiry_ts ?? new Date(Date.now() + 2 * dayMs).toISOString(),
    nonce: overrides.nonce ?? "nonce-1",
    rates_version: overrides.rates_version ?? "baseline",
  };
}

function configureEnv(current: KeyMaterial, opts?: { old?: KeyMaterial; graceDays?: number }) {
  process.env.FEATURE_KMS = ""; // local mode for tests
  process.env.RPT_ED25519_SECRET_BASE64 = current.secretB64;
  process.env.RPT_LOCAL_KEY_ID = current.kid;
  process.env.RPT_KMS_KEY_ID = current.kid;
  process.env.RPT_PUBLIC_BASE64 = current.publicB64;
  if (opts?.old) {
    process.env.RPT_LOCAL_KEY_ID_OLD = opts.old.kid;
    process.env.RPT_KMS_KEY_ID_OLD = opts.old.kid;
    process.env.RPT_PUBLIC_BASE64_OLD = opts.old.publicB64;
  } else {
    delete process.env.RPT_LOCAL_KEY_ID_OLD;
    delete process.env.RPT_KMS_KEY_ID_OLD;
    delete process.env.RPT_PUBLIC_BASE64_OLD;
  }
  process.env.RPT_ROTATION_GRACE_DAYS = String(opts?.graceDays ?? 14);
  resetRptSignerForTests();
  resetRptVerifierCache();
}

async function testCurrentKey() {
  const current = makeKey("kms-current");
  configureEnv(current);
  const signed = await signRptPayload(basePayload());
  const verification = await verifySignedRpt({ token: signed.token, signature: signed.signature });
  assert.equal(verification.valid, true, "current key should verify");
  assert.equal(verification.kid, current.kid);
}

async function testOldKeyWithinGrace() {
  const oldKey = makeKey("kms-old");
  configureEnv(oldKey, { graceDays: 14 });
  const issuedAt = new Date(Date.now() - 2 * dayMs).toISOString();
  const signedOld = await signRptPayload(basePayload(), { issuedAt });

  const current = makeKey("kms-current");
  configureEnv(current, { old: oldKey, graceDays: 14 });
  const verification = await verifySignedRpt({ token: signedOld.token, signature: signedOld.signature });
  assert.equal(verification.valid, true, "old key should pass inside grace");
  assert.equal(verification.keyType, "old");
}

async function testOldKeyAfterGrace() {
  const oldKey = makeKey("kms-old");
  configureEnv(oldKey, { graceDays: 14 });
  const issuedAt = new Date(Date.now() - 30 * dayMs).toISOString();
  const signedOld = await signRptPayload(
    basePayload({ expiry_ts: new Date(Date.now() + 60 * dayMs).toISOString() }),
    { issuedAt }
  );

  const current = makeKey("kms-current");
  configureEnv(current, { old: oldKey, graceDays: 14 });
  const future = new Date(Date.now() + dayMs);
  const verification = await verifySignedRpt({ token: signedOld.token, signature: signedOld.signature }, future);
  assert.equal(verification.valid, false, "old key beyond grace should fail");
  assert.equal(verification.reason, "GRACE_EXCEEDED");
}

async function testRotationFlow() {
  const oldKey = makeKey("kms-old");
  configureEnv(oldKey, { graceDays: 10 });
  const issuedAt = new Date(Date.now() - 3 * dayMs).toISOString();
  const signedOld = await signRptPayload(
    basePayload({ nonce: "rotation-nonce", expiry_ts: new Date(Date.now() + 60 * dayMs).toISOString() }),
    { issuedAt }
  );

  const newKey = makeKey("kms-new");
  configureEnv(newKey, { old: oldKey, graceDays: 10 });
  const signedNew = await signRptPayload(
    basePayload({ nonce: "new-nonce", expiry_ts: new Date(Date.now() + 60 * dayMs).toISOString() })
  );

  const withinGrace = await verifySignedRpt({ token: signedOld.token, signature: signedOld.signature });
  assert.equal(withinGrace.valid, true, "old token should verify during grace");

  const afterGraceDate = new Date(Date.parse(signedOld.token.issuedAt) + 11 * dayMs);
  const afterGrace = await verifySignedRpt({ token: signedOld.token, signature: signedOld.signature }, afterGraceDate);
  assert.equal(afterGrace.valid, false, "old token should fail after grace");
  assert.equal(afterGrace.reason, "GRACE_EXCEEDED");

  const newResult = await verifySignedRpt({ token: signedNew.token, signature: signedNew.signature });
  assert.equal(newResult.valid, true, "new token should always verify");
  assert.equal(newResult.kid, newKey.kid);
}

(async () => {
  await testCurrentKey();
  await testOldKeyWithinGrace();
  await testOldKeyAfterGrace();
  await testRotationFlow();
  console.log("rptVerifier tests passed");
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
