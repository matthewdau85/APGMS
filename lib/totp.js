const crypto = require('crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32ToBuffer(secret) {
  const cleaned = secret.toUpperCase().replace(/=+$/, '');
  let bits = '';
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter, digits = 6) {
  const buffer = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buffer[i] = counter & 0xff;
    counter = counter >> 8;
  }
  const hmac = crypto.createHmac('sha1', secret).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = code % 10 ** digits;
  return otp.toString().padStart(digits, '0');
}

function verifyTotp({ token, secret, window = 1, step = 30, digits = 6, timestamp = Date.now() }) {
  if (!token || !secret) return false;
  const secretBuf = base32ToBuffer(secret);
  const counter = Math.floor(timestamp / 1000 / step);
  for (let errorWindow = -window; errorWindow <= window; errorWindow++) {
    const expected = hotp(secretBuf, counter + errorWindow, digits);
    const provided = token.toString();
    if (provided.length !== expected.length) {
      continue;
    }
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided))) {
      return true;
    }
  }
  return false;
}

module.exports = {
  verifyTotp
};
