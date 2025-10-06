import type { PoolClient } from "pg";
import { normalizeReference } from "./util";

function sqlDateWindow() {
  return "date(settlement_ts) between $2::date - interval '1 day' and $2::date + interval '1 day'";
}

export async function findSettlementMatch(
  client: PoolClient,
  amountCents: number,
  valueDate: string,
  reference: string | null
): Promise<number | null> {
  const amount = Math.abs(Number(amountCents));
  if (!Number.isFinite(amount)) return null;
  if (!valueDate) return null;
  const normalizedRef = normalizeReference(reference);
  if (normalizedRef) {
    const withRef = await client.query<{ id: number }>(
      `select id from settlements
       where status <> 'MATCHED'
         and total_cents = $1 and ${sqlDateWindow()} and reference_normalized = $3
       order by settlement_ts asc
       limit 1`,
      [amount, valueDate, normalizedRef]
    );
    if (withRef.rowCount > 0) return withRef.rows[0].id;
  }
  const fallback = await client.query<{ id: number }>(
    `select id from settlements
     where status <> 'MATCHED' and total_cents = $1 and ${sqlDateWindow()}
     order by settlement_ts asc
     limit 1`,
    [amount, valueDate]
  );
  return fallback.rowCount > 0 ? fallback.rows[0].id : null;
}

export async function replayDlqMatches(client: PoolClient) {
  const { rows } = await client.query<{
    id: number;
    amount_cents: number;
    value_date: string;
    reference_normalized: string | null;
  }>(
    "select id, amount_cents, value_date, reference_normalized from bank_lines where status='DLQ' order by id for update"
  );
  let matched = 0;
  for (const row of rows) {
    const settlementId = await findSettlementMatch(client, row.amount_cents, row.value_date, row.reference_normalized);
    if (settlementId) {
      matched += 1;
      await client.query(
        "update bank_lines set status='MATCHED', settlement_id=$1, dlq_reason=null, replayed_at=now() where id=$2",
        [settlementId, row.id]
      );
      await client.query(
        "update settlements set status='MATCHED', matched_at=now() where id=$1",
        [settlementId]
      );
    }
  }
  return { scanned: rows.length, matched };
}
