import crypto from "crypto";
import { Pool } from "pg";

const pool = new Pool();

const TOTP_STEP_SECONDS = 30;
const TOTP_WINDOW = 1; // allow +/-1 step
const SECRET_BYTES = 20;

let ensured = false;
async function ensureTable() {
  if (ensured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_mfa (
      user_id TEXT PRIMARY KEY,
      secret TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      activated_at TIMESTAMPTZ
    )
  `);
  ensured = true;
}

function hexToBase32(hex: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = hex
    .split("")
    .map((char) => parseInt(char, 16).toString(2).padStart(4, "0"))
    .join("");
  const chunks = bits.match(/.{1,5}/g) || [];
  return chunks
    .map((chunk) => alphabet[parseInt(chunk.padEnd(5, "0"), 2)])
    .join("");
}

function hotp(secret: Buffer, counter: number) {
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = crypto.createHmac("sha1", secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

function totp(secret: Buffer, timestamp: number) {
  const counter = Math.floor(timestamp / 1000 / TOTP_STEP_SECONDS);
  return hotp(secret, counter);
}

function verifyTotp(secretHex: string, code: string) {
  const secret = Buffer.from(secretHex, "hex");
  const now = Date.now();
  for (let i = -TOTP_WINDOW; i <= TOTP_WINDOW; i++) {
    const ts = now + i * TOTP_STEP_SECONDS * 1000;
    if (totp(secret, ts) === code) {
      return true;
    }
  }
  return false;
}

export async function setupMfa(userId: string) {
  await ensureTable();
  const secret = crypto.randomBytes(SECRET_BYTES).toString("hex");
  await pool.query(
    `INSERT INTO user_mfa (user_id, secret, status, created_at, activated_at)
     VALUES ($1,$2,'pending',now(),NULL)
     ON CONFLICT (user_id) DO UPDATE
       SET secret=EXCLUDED.secret, status='pending', created_at=now(), activated_at=NULL`,
    [userId, secret]
  );
  const base32 = hexToBase32(secret);
  const issuer = encodeURIComponent(process.env.MFA_ISSUER || "APGMS");
  const account = encodeURIComponent(userId);
  const otpauth = `otpauth://totp/${issuer}:${account}?secret=${base32}&issuer=${issuer}`;
  return { secret, otpauth };
}

export async function activateMfa(userId: string, code: string) {
  await ensureTable();
  const { rows } = await pool.query(`SELECT secret, status FROM user_mfa WHERE user_id=$1`, [userId]);
  if (!rows.length) {
    throw new Error("MFA_NOT_INITIALIZED");
  }
  const row = rows[0];
  if (!verifyTotp(row.secret, code)) {
    throw new Error("MFA_CODE_INVALID");
  }
  await pool.query(`UPDATE user_mfa SET status='active', activated_at=now() WHERE user_id=$1`, [userId]);
}

export async function hasActiveMfa(userId: string) {
  await ensureTable();
  const { rows } = await pool.query(`SELECT status FROM user_mfa WHERE user_id=$1`, [userId]);
  return rows.some((r) => r.status === "active");
}

export async function verifyMfaChallenge(userId: string, code: string) {
  await ensureTable();
  const { rows } = await pool.query(`SELECT secret, status FROM user_mfa WHERE user_id=$1`, [userId]);
  if (!rows.length || rows[0].status !== "active") {
    throw new Error("MFA_NOT_ACTIVE");
  }
  if (!verifyTotp(rows[0].secret, code)) {
    throw new Error("MFA_CODE_INVALID");
  }
}
