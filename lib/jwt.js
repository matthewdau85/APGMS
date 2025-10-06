const crypto = require('crypto');

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function decodeBase64url(input) {
  input = input.replace(/-/g, '+').replace(/_/g, '/');
  while (input.length % 4) {
    input += '=';
  }
  return Buffer.from(input, 'base64').toString('utf8');
}

function parseDuration(str) {
  if (typeof str === 'number') return str;
  const match = /^([0-9]+)([smhd])$/.exec(str);
  if (!match) throw new Error('invalid expiresIn format');
  const value = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case 's':
      return value;
    case 'm':
      return value * 60;
    case 'h':
      return value * 3600;
    case 'd':
      return value * 86400;
    default:
      throw new Error('invalid expiresIn unit');
  }
}

function sign(payload, secret, options = {}) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...payload, iat: now };
  if (options.expiresIn) {
    body.exp = now + parseDuration(options.expiresIn);
  }
  const headerEncoded = base64url(JSON.stringify(header));
  const payloadEncoded = base64url(JSON.stringify(body));
  const data = `${headerEncoded}.${payloadEncoded}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${signature}`;
}

function verify(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid token');
  const [headerB64, payloadB64, sig] = parts;
  const data = `${headerB64}.${payloadB64}`;
  const expectedSig = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    throw new Error('signature mismatch');
  }
  const payload = JSON.parse(decodeBase64url(payloadB64));
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error('token expired');
  }
  return payload;
}

module.exports = {
  sign,
  verify
};
