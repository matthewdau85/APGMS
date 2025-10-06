import { pool } from "../db/pool";
import { decryptSecret, encryptSecret, EncryptedSecret } from "./secret";

interface MfaRow {
  secret_enc: string;
  status: string;
}

type MfaStatus = "pending" | "active";

function parseEncrypted(secretEnc: string): EncryptedSecret {
  return JSON.parse(secretEnc) as EncryptedSecret;
}

export async function saveMfaSecret(userId: string, secret: string, status: MfaStatus) {
  const encrypted = encryptSecret(secret);
  await pool.query(
    `INSERT INTO user_mfa(user_id, secret_enc, status, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id)
     DO UPDATE SET secret_enc = EXCLUDED.secret_enc, status = EXCLUDED.status, updated_at = now()`,
    [userId, JSON.stringify(encrypted), status]
  );
  return encrypted;
}

export async function getMfaSecret(userId: string): Promise<{ secret: string; status: MfaStatus } | null> {
  const { rows } = await pool.query<MfaRow>(
    "SELECT secret_enc, status FROM user_mfa WHERE user_id=$1",
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  const decrypted = decryptSecret(parseEncrypted(row.secret_enc));
  return { secret: decrypted, status: row.status as MfaStatus };
}

export async function updateMfaStatus(userId: string, status: MfaStatus) {
  await pool.query(
    "UPDATE user_mfa SET status=$1, updated_at=now() WHERE user_id=$2",
    [status, userId]
  );
}
