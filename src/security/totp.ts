import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(buffer: Buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
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

function base32ToBuffer(secret: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  const normalized = secret.replace(/=+$/, "").toUpperCase();
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
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

function hotp(secret: Buffer, counter: number, digits = 6) {
  const buffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buffer[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = createHmac("sha1", secret).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, "0");
}

export function generateSecret(length = 32) {
  return toBase32(randomBytes(length));
}

export function generateKeyUri(account: string, issuer: string, secret: string) {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function verifyTotp(secret: string, token: string, window = 1) {
  const secretBuffer = base32ToBuffer(secret);
  const timeStep = Math.floor(Date.now() / 1000 / 30);
  const normalized = token.trim();
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const expected = hotp(secretBuffer, timeStep + errorWindow);
    if (timingSafeCompare(expected, normalized)) {
      return true;
    }
  }
  return false;
}

function timingSafeCompare(a: string, b: string) {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}
