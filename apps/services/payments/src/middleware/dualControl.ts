// apps/services/payments/src/middleware/dualControl.ts
import type { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import { Agent } from 'undici';

const bypass = (process.env.IAM_DUAL_CONTROL_BYPASS || '').toLowerCase() === 'true';
const baseUrl = process.env.IAM_BASE_URL || process.env.APGMS_IAM_URL;
const actionId = process.env.IAM_PAYATO_ACTION || 'payments.payAto.release';

let dispatcher: Agent | undefined;

function ensureDispatcher(): Agent | undefined {
  if (dispatcher !== undefined) return dispatcher;

  const disableMtls = (process.env.IAM_DISABLE_MTLS || '').toLowerCase() === 'true';
  if (disableMtls || !baseUrl) {
    dispatcher = undefined;
    return dispatcher;
  }

  const certPath = process.env.IAM_MTLS_CERT || process.env.APGMS_IAM_CLIENT_CERT;
  const keyPath = process.env.IAM_MTLS_KEY || process.env.APGMS_IAM_CLIENT_KEY;
  const caPath = process.env.IAM_MTLS_CA || process.env.APGMS_IAM_CA_CHAIN;

  if (!certPath || !keyPath) {
    throw new Error('IAM mTLS is required but IAM_MTLS_CERT/IAM_MTLS_KEY were not provided');
  }

  dispatcher = new Agent({
    connect: {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
      ca: caPath ? fs.readFileSync(caPath) : undefined,
      rejectUnauthorized: true,
      secureProtocol: 'TLSv1_3_method',
    },
  });

  return dispatcher;
}

async function callIam(token: string, payload: Record<string, unknown>) {
  if (!baseUrl) {
    throw new Error('IAM_BASE_URL is not configured');
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/approvals/verify`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: token,
    },
    body: JSON.stringify(payload),
    dispatcher: ensureDispatcher(),
  });

  if (response.status === 401) {
    return { ok: false, reason: 'unauthorised' };
  }

  if (!response.ok) {
    throw new Error(`IAM approval request failed (${response.status})`);
  }

  const body = (await response.json()) as { mfa?: boolean; dualApproval?: boolean };
  return {
    ok: Boolean(body.mfa) && Boolean(body.dualApproval),
    mfa: Boolean(body.mfa),
    dual: Boolean(body.dualApproval),
  };
}

export async function requireDualApproval(req: Request, res: Response, next: NextFunction) {
  try {
    if (bypass) {
      return next();
    }

    const token = req.headers['authorization'];
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(401).json({ error: 'Authorization header required for dual-control enforcement' });
    }

    const actor = req.headers['x-apgms-actor'] || req.headers['x-user-id'] || req.headers['x-actor'];
    const { abn, taxType, periodId } = req.body || {};

    const payload = {
      action: actionId,
      subject: actor,
      resource: { abn, taxType, periodId },
      enforce: { mfa: true, dualControl: true },
    };

    const result = await callIam(token, payload);
    if (!result.ok) {
      const status = result.reason === 'unauthorised' ? 401 : 403;
      return res.status(status).json({ error: 'Dual-control approval required', detail: result });
    }

    return next();
  } catch (err: any) {
    return res.status(502).json({ error: 'IAM enforcement error', detail: String(err?.message || err) });
  }
}
