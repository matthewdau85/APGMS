import { createHmac, randomBytes } from "node:crypto";
import { AuthClaims, signJwt } from "../http/auth";

export interface TotpSetup {
  secret: string;
  uri: string;
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

function fromBase32(secret: string): Buffer {
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of secret.toUpperCase().replace(/=+$/, "")) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      continue;
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateOtp(secret: Buffer, counter: number, digits = 6): string {
  const buffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buffer[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const digest = createHmac("sha1", secret).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = (code % 10 ** digits).toString().padStart(digits, "0");
  return otp;
}

export function createTotpSecret(userId: string, issuer = "APGMS"): TotpSetup {
  const secretBytes = randomBytes(20);
  const secret = toBase32(secretBytes);
  const label = encodeURIComponent(`${issuer}:${userId}`);
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
  return { secret, uri };
}

export function verifyTotp(token: string, secret: string): boolean {
  if (!token || !secret) {
    return false;
  }
  const key = fromBase32(secret);
  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / 30);
  for (let offset = -1; offset <= 1; offset += 1) {
    const candidate = generateOtp(key, counter + offset);
    if (candidate === token) {
      return true;
    }
  }
  return false;
}

export function issueStepUpToken(claims: AuthClaims, token: string, secret: string, expiresIn = "10m"): string {
  if (!verifyTotp(token, secret)) {
    throw new Error("INVALID_TOTP");
  }
  return signJwt({ ...claims, mfa: true }, expiresIn);
}
