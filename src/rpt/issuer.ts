import crypto from "crypto";
import type { PoolClient } from "pg";

export async function issueRPT(
  client: PoolClient,
  input: { abn: string; periodId: string | number; head: string }
): Promise<{ token: string }> {
  const token = crypto
    .createHash("sha256")
    .update(`${input.abn}:${input.periodId}:${input.head}:${Date.now()}`)
    .digest("hex");

  await client.query(
    `insert into rpt_tokens (abn, period_id, token, issued_at) values ($1, $2, $3, now())`,
    [input.abn, input.periodId, token]
  );

  return { token };
}
