import type { Pool, PoolClient } from "pg";
import { pool } from "../db/pool";
import { encryptSecret, decryptSecret, SecretEnvelope } from "../auth/secretVault";

export interface MfaSecretRow {
  user_id: string;
  backend: string;
  secret_ciphertext: string;
  secret_iv: string | null;
  secret_tag: string | null;
  kms_key_id: string | null;
  created_at: Date;
  activated_at: Date | null;
  updated_at: Date;
}

export async function upsertSecret(userId: string, secret: string, client?: Pool | PoolClient) {
  const envelope = await encryptSecret(secret);
  const runner = client ?? pool;
  await runner.query(
    `INSERT INTO mfa_secrets (user_id, backend, secret_ciphertext, secret_iv, secret_tag, kms_key_id, activated_at)
     VALUES ($1,$2,$3,$4,$5,$6,NULL)
     ON CONFLICT (user_id)
     DO UPDATE SET backend = EXCLUDED.backend,
                   secret_ciphertext = EXCLUDED.secret_ciphertext,
                   secret_iv = EXCLUDED.secret_iv,
                   secret_tag = EXCLUDED.secret_tag,
                   kms_key_id = EXCLUDED.kms_key_id,
                   activated_at = NULL,
                   updated_at = now()` ,
    [
      userId,
      envelope.backend,
      envelope.ciphertext,
      envelope.iv ?? null,
      envelope.tag ?? null,
      envelope.kmsKeyId ?? null,
    ]
  );
  return envelope;
}

export async function loadSecret(userId: string) {
  const { rows } = await pool.query<MfaSecretRow>(
    `SELECT * FROM mfa_secrets WHERE user_id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  const envelope: SecretEnvelope = {
    backend: row.backend === "aws" ? "aws" : "local",
    ciphertext: row.secret_ciphertext,
    iv: row.secret_iv ?? undefined,
    tag: row.secret_tag ?? undefined,
    kmsKeyId: row.kms_key_id ?? undefined,
  };
  const secret = await decryptSecret(envelope);
  return { row, secret };
}

export async function markActivated(userId: string, client?: Pool | PoolClient) {
  const runner = client ?? pool;
  await runner.query(
    `UPDATE mfa_secrets SET activated_at = now(), updated_at = now() WHERE user_id = $1`,
    [userId]
  );
}
