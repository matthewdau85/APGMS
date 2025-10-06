import type { NextFunction, Request, RequestHandler, Response } from 'express';
import nacl from 'tweetnacl';

export type AssuranceLevel = 'aal1' | 'aal2' | 'aal3';

export interface StepUpRequirement {
  requiredLevel: AssuranceLevel;
  maxAgeSeconds?: number;
  methods?: string[];
}

export interface ApprovalEvidence {
  approver: string;
  method: string;
  verifiedAt: string;
  roles?: string[];
}

export interface AuthContext {
  subject: string;
  roles: string[];
  assuranceLevel: AssuranceLevel;
  mfaMethods: string[];
  mfaLastVerifiedAt?: string;
  stepUp?: {
    level: AssuranceLevel;
    method: string;
    verifiedAt: string;
  };
  approvals?: ApprovalEvidence[];
  sessionIssuedAt?: string;
}

export interface AccessPolicy {
  anyRoles?: string[];
  allRoles?: string[];
  minAssurance?: AssuranceLevel;
  stepUp?: StepUpRequirement;
  requireApprover?: boolean;
  approverRoles?: string[];
  disallowSubjectRoles?: string[];
}

const assuranceRank: Record<AssuranceLevel, number> = { aal1: 1, aal2: 2, aal3: 3 };

let cachedPublicKey: Uint8Array | null = null;

function decodeBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(padLength);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function loadAuthContextPublicKey(): Uint8Array {
  if (cachedPublicKey) {
    return cachedPublicKey;
  }

  const base64 = process.env.SESSION_CONTEXT_PUBLIC_KEY_BASE64;
  if (!base64) {
    throw new Error('SESSION_CONTEXT_PUBLIC_KEY_BASE64 must be configured for auth context verification');
  }
  const raw = decodeBase64(base64);
  if (raw.length !== 32) {
    throw new Error(`SESSION_CONTEXT_PUBLIC_KEY_BASE64 must decode to 32 bytes, got ${raw.length}`);
  }
  cachedPublicKey = raw;
  return raw;
}

function parseAuthContext(req: Request): AuthContext | null {
  if ((req as any).authContext) {
    return (req as any).authContext as AuthContext;
  }

  const contextB64 = req.header('x-auth-context');
  const signatureB64 = req.header('x-auth-context-signature');
  if (!contextB64 || !signatureB64) {
    return null;
  }

  const contextBytes = decodeBase64(contextB64);
  const signature = decodeBase64(signatureB64);
  const publicKey = loadAuthContextPublicKey();
  const valid = nacl.sign.detached.verify(contextBytes, signature, publicKey);
  if (!valid) {
    return null;
  }

  const json = Buffer.from(contextBytes).toString('utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Invalid auth context JSON: ${(err as Error).message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Auth context payload must be an object');
  }

  const obj = parsed as Record<string, unknown>;
  const ctx: AuthContext = {
    subject: String(obj.sub || obj.subject || ''),
    roles: Array.isArray(obj.roles) ? obj.roles.map(String) : [],
    assuranceLevel: (obj.assurance_level || obj.aal || 'aal1') as AssuranceLevel,
    mfaMethods: Array.isArray(obj.mfa_methods) ? obj.mfa_methods.map(String) : [],
    mfaLastVerifiedAt: typeof obj.mfa_last_verified_at === 'string' ? obj.mfa_last_verified_at : undefined,
    sessionIssuedAt: typeof obj.session_issued_at === 'string' ? obj.session_issued_at : undefined,
  };

  if (obj.step_up && typeof obj.step_up === 'object') {
    const step = obj.step_up as Record<string, unknown>;
    ctx.stepUp = {
      level: (step.level || step.assurance || 'aal2') as AssuranceLevel,
      method: String(step.method || ''),
      verifiedAt: String(step.verified_at || step.at || ''),
    };
  }

  if (Array.isArray(obj.approvals)) {
    const approvals: ApprovalEvidence[] = [];
    for (const entry of obj.approvals) {
      if (!entry || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const approver = String(rec.approver || rec.subject || '');
      const verifiedAt = String(rec.verified_at || rec.at || '');
      if (!approver || !verifiedAt) continue;
      approvals.push({
        approver,
        method: String(rec.method || ''),
        verifiedAt,
        roles: Array.isArray(rec.roles) ? rec.roles.map(String) : undefined,
      });
    }
    if (approvals.length) {
      ctx.approvals = approvals;
    }
  }

  (req as any).authContext = ctx;
  return ctx;
}

function ensureAuthContext(req: Request, res: Response): AuthContext | null {
  try {
    return parseAuthContext(req);
  } catch (err) {
    console.error('[authz] parse failure', err);
    res.status(401).json({ error: 'AUTH_CONTEXT_INVALID', detail: (err as Error).message });
    return null;
  }
}

function compareAssurance(actual: AssuranceLevel, minimum: AssuranceLevel): boolean {
  return assuranceRank[actual] >= assuranceRank[minimum];
}

function satisfiesStepUp(ctx: AuthContext, requirement: StepUpRequirement): boolean {
  if (!ctx.stepUp) return false;
  if (!compareAssurance(ctx.stepUp.level, requirement.requiredLevel)) return false;
  if (requirement.methods && !requirement.methods.some((method) => method === ctx.stepUp?.method)) {
    return false;
  }
  if (requirement.maxAgeSeconds) {
    const verified = Date.parse(ctx.stepUp.verifiedAt || '');
    if (!Number.isFinite(verified)) return false;
    if (Date.now() - verified > requirement.maxAgeSeconds * 1000) return false;
  }
  return true;
}

function approvalsContain(ctx: AuthContext, roles?: string[]): ApprovalEvidence | null {
  if (!ctx.approvals || ctx.approvals.length === 0) return null;
  return (
    ctx.approvals.find((approval) => {
      if (approval.approver === ctx.subject) return false;
      if (!roles || roles.length === 0) return true;
      const approverRoles = approval.roles || [];
      return roles.every((r) => approverRoles.includes(r));
    }) || null
  );
}

export function requireAccess(policy: AccessPolicy): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const ctx = ensureAuthContext(req, res);
    if (!ctx) return; // response already sent

    if (!ctx.subject) {
      return res.status(401).json({ error: 'AUTH_REQUIRED', detail: 'Missing subject in auth context' });
    }

    if (policy.disallowSubjectRoles) {
      const blocked = policy.disallowSubjectRoles.find((role) => ctx.roles.includes(role));
      if (blocked) {
        return res.status(403).json({ error: 'ROLE_CONFLICT', detail: `Role ${blocked} may not execute this action` });
      }
    }

    if (policy.anyRoles && !policy.anyRoles.some((role) => ctx.roles.includes(role))) {
      return res.status(403).json({ error: 'FORBIDDEN', detail: 'Required role missing' });
    }

    if (policy.allRoles && !policy.allRoles.every((role) => ctx.roles.includes(role))) {
      return res.status(403).json({ error: 'FORBIDDEN', detail: 'All required roles must be present' });
    }

    if (policy.minAssurance && !compareAssurance(ctx.assuranceLevel, policy.minAssurance)) {
      return res.status(403).json({ error: 'MFA_UPGRADE_REQUIRED', detail: `Assurance ${policy.minAssurance} required` });
    }

    if (policy.stepUp && !satisfiesStepUp(ctx, policy.stepUp)) {
      return res.status(403).json({ error: 'STEP_UP_REQUIRED', detail: 'Step-up challenge not satisfied' });
    }

    if (policy.requireApprover) {
      const approval = approvalsContain(ctx, policy.approverRoles);
      if (!approval) {
        return res.status(403).json({ error: 'APPROVER_REQUIRED', detail: 'Dual control approval missing' });
      }
      (req as any).approvalEvidence = approval;
    }

    (req as any).authContext = ctx;
    next();
  };
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    parseAuthContext(req);
  } catch (err) {
    console.warn('[authz] optional auth parse failure', err);
  }
  next();
}

export function resetAuthCache() {
  cachedPublicKey = null;
}
