import { createHmac, randomBytes } from "crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      const index = (value >>> (bits - 5)) & 0x1f;
      bits -= 5;
      output += BASE32_ALPHABET[index];
    }
  }

  if (bits > 0) {
    const index = (value << (5 - bits)) & 0x1f;
    output += BASE32_ALPHABET[index];
  }

  return output;
}

function base32Decode(input: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  const normalized = input.replace(/=+$/g, "").toUpperCase();

  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error("Invalid base32 character");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

export function generateTotpSecret(length = 20): string {
  const secret = randomBytes(length);
  return base32Encode(secret);
}

function hmacSha1(key: Buffer, counter: number): Buffer {
  const buffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i -= 1) {
    buffer[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  return createHmac("sha1", key).update(buffer).digest();
}

export function totp(secretBase32: string, timestamp = Date.now(), periodSeconds = 30, digits = 6): string {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(timestamp / 1000 / periodSeconds);
  const hmac = hmacSha1(key, counter);

  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const otp = binary % 10 ** digits;
  return otp.toString().padStart(digits, "0");
}

export function verifyTotp(secretBase32: string, token: string, window = 1, periodSeconds = 30, digits = 6): boolean {
  const sanitized = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(sanitized)) {
    return false;
  }

  const now = Date.now();
  for (let offset = -window; offset <= window; offset += 1) {
    const time = now + offset * periodSeconds * 1000;
    if (totp(secretBase32, time, periodSeconds, digits) === sanitized) {
      return true;
    }
  }
  return false;
}

export function otpauthUrl(secret: string, label: string, issuer: string, periodSeconds = 30): string {
  const encodedLabel = encodeURIComponent(label);
  const encodedIssuer = encodeURIComponent(issuer);
  return `otpauth://totp/${encodedLabel}?secret=${secret}&issuer=${encodedIssuer}&period=${periodSeconds}`;
}
