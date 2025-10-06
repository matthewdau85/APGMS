import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Ensures every request has a stable request ID for correlating audit events.
 */
export function requestContext(req: Request, res: Response, next: NextFunction) {
  const incoming = (req.header('x-request-id') || '').trim();
  const requestId = incoming && incoming.length >= 16 ? incoming : randomUUID();
  req.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
