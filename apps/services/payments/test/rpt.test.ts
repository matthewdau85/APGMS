import { canonicalJson, sha256Hex } from "../src/utils/crypto";
import * as ed from "@noble/ed25519";

test("RPT round-trip sign/verify", async () => {
  const payload = { abn:"12345678901", taxType:"PAYGW", periodId:"2025-09", total: 12345 };
  const c14n = canonicalJson(payload);
  const msg = Buffer.from(c14n);
  const sk = Buffer.alloc(32, 7);
  const pk = await ed.getPublicKey(sk);
  const sig = await ed.sign(msg, sk);
  const ok = await ed.verify(sig, msg, pk);
  expect(ok).toBe(true);
  expect(sha256Hex(c14n)).toHaveLength(64);
});