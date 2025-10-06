import crypto from "crypto";
import { Pool } from "pg";

const pool = new Pool();

export async function getTenantWebhookSecret(tenantId: string): Promise<string | null> {
  if (!tenantId) return null;
  const { rows } = await pool.query("select secret from tenant_webhook_secrets where tenant_id=$1", [tenantId]);
  if (rows.length > 0) {
    return rows[0].secret as string;
  }
  return await createTenantSecret(tenantId);
}

export async function createTenantSecret(tenantId: string): Promise<string> {
  const secret = crypto.randomBytes(32).toString("hex");
  await pool.query(
    "insert into tenant_webhook_secrets(tenant_id, secret) values ($1,$2) on conflict (tenant_id) do update set secret=excluded.secret",
    [tenantId, secret]
  );
  return secret;
}
