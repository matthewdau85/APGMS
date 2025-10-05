import { Pool } from "pg";

const pool = new Pool();

export async function registerNonceOnce(nonce: string, expEpochSeconds: number): Promise<void> {
  const expiresAt = new Date(expEpochSeconds * 1000);
  const insert = await pool.query(
    "insert into rpt_jti(jti, exp) values ($1, $2) on conflict do nothing",
    [nonce, expiresAt]
  );
  if (insert.rowCount === 1) {
    return;
  }
  const existing = await pool.query("select exp from rpt_jti where jti = $1", [nonce]);
  const currentExp: Date | undefined = existing.rows[0]?.exp;
  if (currentExp && currentExp > new Date()) {
    throw new Error("RPT_REPLAY_DETECTED");
  }
  await pool.query("update rpt_jti set exp = $2 where jti = $1", [nonce, expiresAt]);
}
