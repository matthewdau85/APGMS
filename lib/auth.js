const crypto = require('crypto');
const { resolveSecret } = require('./secrets');
const { sign, verify } = require('./jwt');
const { verifyTotp } = require('./totp');
const logger = require('./logger');

let signingKeyPromise;

async function getSigningKey() {
  if (!signingKeyPromise) {
    signingKeyPromise = resolveSecret('JWT_SIGNING_SECRET', 'JWT_SECRET');
  }
  return signingKeyPromise;
}

function verifyPassword(password, storedHash) {
  return new Promise((resolve, reject) => {
    const [saltHex, hashHex] = storedHash.split(':');
    if (!saltHex || !hashHex) return resolve(false);
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    crypto.scrypt(password, salt, expected.length, (err, derived) => {
      if (err) return reject(err);
      if (derived.length !== expected.length) return resolve(false);
      resolve(crypto.timingSafeEqual(derived, expected));
    });
  });
}

async function authenticate(req, res, next) {
  try {
    const header = req.headers['authorization'] || '';
    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
    const token = header.slice(7);
    const secret = await getSigningKey();
    const payload = verify(token, secret);
    req.user = payload;
    if (payload.email || payload.sub) {
      logger.setActor(payload.email || payload.sub);
    }
    return next();
  } catch (err) {
    logger.warn('auth.failure', { message: err.message });
    return res.status(401).json({ error: 'UNAUTHENTICATED' });
  }
}

function requireMfa(req, res, next) {
  if (!req.user?.mfa) {
    return res.status(403).json({ error: 'MFA_REQUIRED' });
  }
  return next();
}

async function issueToken(user, { mfa = false, expiresIn = '1h' } = {}) {
  const secret = await getSigningKey();
  const payload = {
    sub: String(user.id),
    email: user.email,
    role: user.role,
    mfa: Boolean(mfa)
  };
  return sign(payload, secret, { expiresIn });
}

async function verifyTotpForUser(user, token) {
  if (!user.mfa_enabled || !user.totp_secret) return false;
  return verifyTotp({ token, secret: user.totp_secret, window: 1 });
}

module.exports = {
  authenticate,
  requireMfa,
  issueToken,
  verifyPassword,
  verifyTotpForUser
};
