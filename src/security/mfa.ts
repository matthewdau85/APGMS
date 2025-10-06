import { Router } from "express";
import { Pool } from "pg";
import { requireJwt, type AuthedRequest, signJwt } from "../http/auth";
import { createHmac, randomBytes } from "crypto";

const pool = new Pool();
const tableSql = `
CREATE TABLE IF NOT EXISTS auth_mfa_secrets (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  secret TEXT NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;
let tableEnsured = false;

async function ensureTable() {
  if (!tableEnsured) {
    await pool.query(tableSql);
    tableEnsured = true;
  }
}

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function fromBase32(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of input.replace(/=+$/g, "").toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret(length = 20): string {
  const buf = randomBytes(length);
  return toBase32(buf).slice(0, length * 8 / 5);
}

function hotp(secret: string, counter: number, digits = 6): string {
  const key = fromBase32(secret);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = code % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

function verifyTotp(secret: string, token: string, window = 1): boolean {
  const step = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -window; offset <= window; offset++) {
    const expected = hotp(secret, step + offset);
    if (expected === token) return true;
  }
  return false;
}

export const mfaRouter = Router();

mfaRouter.post("/setup", requireJwt(), async (req: AuthedRequest, res) => {
  await ensureTable();
  const user = req.auth?.user;
  if (!user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  const secret = generateSecret(20);
  await pool.query(
    `INSERT INTO auth_mfa_secrets (user_id, email, role, secret, verified_at)
     VALUES ($1,$2,$3,$4,NULL)
     ON CONFLICT (user_id)
     DO UPDATE SET email = EXCLUDED.email, role = EXCLUDED.role, secret = EXCLUDED.secret, verified_at = NULL`,
    [user.id, user.email, user.role, secret]
  );
  const otpauth = `otpauth://totp/APGMS:${encodeURIComponent(user.email)}?secret=${secret}&issuer=APGMS`;
  return res.json({
    secret,
    otpauth_url: otpauth
  });
});

mfaRouter.post("/verify", requireJwt(), async (req: AuthedRequest, res) => {
  await ensureTable();
  const user = req.auth?.user;
  if (!user) {
    return res.status(401).json({ error: "UNAUTHENTICATED" });
  }
  const code = (req.body?.code ?? req.body?.token ?? "").toString();
  if (!code) {
    return res.status(400).json({ error: "CODE_REQUIRED" });
  }
  const record = await pool.query("SELECT secret FROM auth_mfa_secrets WHERE user_id=$1", [user.id]);
  if (record.rowCount === 0) {
    return res.status(404).json({ error: "MFA_SETUP_REQUIRED" });
  }
  const secret = record.rows[0].secret as string;
  if (!verifyTotp(secret, code, 1)) {
    return res.status(401).json({ error: "INVALID_TOKEN" });
  }
  await pool.query("UPDATE auth_mfa_secrets SET verified_at = NOW() WHERE user_id=$1", [user.id]);
  const token = signJwt({ ...user, mfa: true });
  return res.json({ token });
});
