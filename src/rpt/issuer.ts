import { PoolClient } from "pg";
import crypto from "crypto";

interface IssueParams {
  abn: string;
  periodId: number | string;
  head: string;
}

export async function issueRPT(client: PoolClient, params: IssueParams): Promise<{ token: string }> {
  const token = crypto.randomUUID();
  await client.query(
    `insert into rpt_tokens (abn, period_id, token, hash_head, issued_at)
       values ($1, $2, $3, $4, now())
     on conflict (abn, period_id) do update
       set token = excluded.token, hash_head = excluded.hash_head, issued_at = excluded.issued_at`,
    [params.abn, params.periodId, token, params.head]
  );
  return { token };
}
