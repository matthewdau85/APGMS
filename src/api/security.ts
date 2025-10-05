import { encryptTransportPayload, computeTotp } from "../utils/transportEncryption";

export interface SecurityConfig {
  tenantId: string;
  mfaEnabled: boolean;
  encryptionEnforced: boolean;
  transportKey: string;
  tlsActive: boolean;
  demoTotpSecret?: string;
}

async function handleResponse(res: Response) {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "REQUEST_FAILED");
  }
  return data;
}

export async function fetchSecurityConfig(): Promise<SecurityConfig> {
  const res = await fetch("/auth/security/config");
  return handleResponse(res);
}

interface ToggleParams {
  config: SecurityConfig;
  actor: string;
  role: string;
  code?: string;
}

export async function toggleMfa(enable: boolean, params: ToggleParams): Promise<SecurityConfig> {
  const { config, actor, role } = params;
  const code = params.code || (config.demoTotpSecret ? await computeTotp(config.demoTotpSecret) : undefined);
  if (!code) {
    throw new Error("MFA_CODE_REQUIRED");
  }
  const encrypted = await encryptTransportPayload(config.transportKey, {
    action: "toggleMfa",
    enable,
    code
  });
  const res = await fetch("/auth/security/mfa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor, role, ...encrypted })
  });
  return handleResponse(res);
}

export async function toggleEncryption(enforce: boolean, params: ToggleParams): Promise<SecurityConfig> {
  const { config, actor, role } = params;
  const code = params.code || (config.demoTotpSecret ? await computeTotp(config.demoTotpSecret) : undefined);
  if (!code) {
    throw new Error("MFA_CODE_REQUIRED");
  }
  const encrypted = await encryptTransportPayload(config.transportKey, {
    action: "toggleEncryption",
    enforce,
    code
  });
  const res = await fetch("/auth/security/encryption", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor, role, ...encrypted })
  });
  return handleResponse(res);
}

export interface AuditEvent {
  event_time: string;
  action: string;
  actor: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  prev_hash: string | null;
  terminal_hash: string;
}

export async function fetchSecurityAudit(): Promise<{ events: AuditEvent[] }> {
  const res = await fetch("/audit/security");
  return handleResponse(res);
}
