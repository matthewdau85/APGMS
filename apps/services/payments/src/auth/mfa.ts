import crypto from "crypto";
import { signJwt, JwtClaims } from "../middleware/auth.js";

interface MfaRecord {
  secret: string;
  active: boolean;
  activatedAt?: number;
}

const userMfa = new Map<string, MfaRecord>();

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function randomSecret(bytes = 20) {
  const raw = crypto.randomBytes(bytes);
  let output = "";
  for (const byte of raw) {
    output += BASE32_ALPHABET[byte & 31];
  }
  return output;
}

function base32ToBuffer(secret: string) {
  let bits = "";
  for (const char of secret.toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const chunks = bits.match(/.{1,8}/g) ?? [];
  const bytes = chunks
    .filter((chunk) => chunk.length === 8)
    .map((chunk) => Number.parseInt(chunk, 2));
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number) {
  const buffer = Buffer.alloc(8);
  let tmp = counter;
  for (let i = 7; i >= 0; i -= 1) {
    buffer[i] = tmp & 0xff;
    tmp = Math.floor(tmp / 256);
  }
  const key = base32ToBuffer(secret);
  const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

function verifyTotp(secret: string, token: string, window = 1) {
  const ts = Date.now();
  for (let errorWindow = -window; errorWindow <= window; errorWindow += 1) {
    const counter = Math.floor(ts / 1000 / 30) + errorWindow;
    if (hotp(secret, counter) === token) return true;
  }
  return false;
}

export function beginSetup(userId: string) {
  const secret = randomSecret();
  userMfa.set(userId, { secret, active: false });
  const otpauth = `otpauth://totp/APGMS:${encodeURIComponent(userId)}?secret=${secret}&issuer=APGMS`;
  return { secret, otpauth };
}

export function activate(userId: string, token: string) {
  const entry = userMfa.get(userId);
  if (!entry) throw new Error("SETUP_REQUIRED");
  if (!verifyTotp(entry.secret, token)) throw new Error("TOKEN_INVALID");
  entry.active = true;
  entry.activatedAt = Date.now();
  return { ok: true };
}

export function challenge(userId: string, claims: JwtClaims, token: string) {
  const entry = userMfa.get(userId);
  if (!entry || !entry.active) throw new Error("MFA_NOT_ACTIVE");
  if (!verifyTotp(entry.secret, token)) throw new Error("TOKEN_INVALID");
  const nextClaims: JwtClaims = {
    ...claims,
    mfa: true,
  };
  return { token: signJwt(nextClaims, 300) };
}

export function isActive(userId: string) {
  return userMfa.get(userId)?.active ?? false;
}

export function resetAll() {
  userMfa.clear();
}
