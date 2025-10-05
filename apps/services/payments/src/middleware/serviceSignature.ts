import type { NextFunction, Request, Response } from 'express';
import { canonicalPath, verifySignature } from '../../../../libs/serviceSignature';

const HEADER = 'x-service-signature';

function getSecret() {
  const secret = process.env.SERVICE_SIGNING_KEY;
  if (!secret) {
    throw new Error('SERVICE_SIGNING_KEY missing');
  }
  return secret;
}

export function serviceSignatureGate(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return next();
  }
  const provided = req.header(HEADER);
  if (!provided) {
    return res.status(401).json({ error: 'SERVICE_SIGNATURE_REQUIRED' });
  }
  const secret = getSecret();
  const pathWithQuery = canonicalPath(req.originalUrl);
  const body = (req as any).rawBody ?? '';
  if (!verifySignature(provided, req.method, pathWithQuery, body, secret)) {
    return res.status(401).json({ error: 'INVALID_SERVICE_SIGNATURE' });
  }
  return next();
}
