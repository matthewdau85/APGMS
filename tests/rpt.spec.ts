import assert from "assert";
import path from "path";
import { fileURLToPath } from "url";
import { getActiveKid, signJWS } from "../src/rpt/kms";
import { merkleRootHex } from "../src/crypto/merkle";
import { RptPayloadV01 } from "../src/rpt/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.env.RPT_KEYSTORE_PATH = path.resolve(__dirname, "fixtures", "rpt_keys.json");

async function testJwsGolden() {
  const kid = await getActiveKid();
  const payload: RptPayloadV01 = {
    rpt_id: "rpt-test-token",
    abn: "12345678901",
    bas_period: "2025-09",
    totals: { paygw_cents: 0, gst_cents: 123456 },
    evidence_merkle_root: "abc123",
    rates_version: "baseline",
    anomaly_score: 0.15,
    iat: 1_701_000_000,
    exp: 1_701_000_900,
    nonce: "1f2d3c4b-5566-7788-99aa-bbccddeeff00",
    kid,
  };
  const jws = await signJWS(payload, kid);
  const expected = "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCIsImtpZCI6InJwdC10ZXN0LTEifQ.eyJycHRfaWQiOiJycHQtdGVzdC10b2tlbiIsImFibiI6IjEyMzQ1Njc4OTAxIiwiYmFzX3BlcmlvZCI6IjIwMjUtMDkiLCJ0b3RhbHMiOnsicGF5Z3dfY2VudHMiOjAsImdzdF9jZW50cyI6MTIzNDU2fSwiZXZpZGVuY2VfbWVya2xlX3Jvb3QiOiJhYmMxMjMiLCJyYXRlc192ZXJzaW9uIjoiYmFzZWxpbmUiLCJhbm9tYWx5X3Njb3JlIjowLjE1LCJpYXQiOjE3MDEwMDAwMDAsImV4cCI6MTcwMTAwMDkwMCwibm9uY2UiOiIxZjJkM2M0Yi01NTY2LTc3ODgtOTlhYS1iYmNjZGRlZWZmMDAiLCJraWQiOiJycHQtdGVzdC0xIn0.lYyu5uW1gY-_ukP5yClXiA5digjpleWRh5Qh87hpYt3Q_EZXu7tULmDHRrVJgEJ313ioE2xaTKZMyj5cL8kLDg";
  assert.strictEqual(jws, expected, "JWS golden vector changed");
}

function testMerkleGolden() {
  const leaves = ["first", "second", "third"];
  const root = merkleRootHex(leaves);
  const expected = "b5393433547eaa8364599202544dba4b04a85bab96d6e8676ae5d235949f1e43";
  assert.strictEqual(root, expected, "Merkle root golden mismatch");
}

(async () => {
  await testJwsGolden();
  testMerkleGolden();
  console.log("RPT golden vectors ok");
})();
