import { Pool } from "pg";

const pool = new Pool();

type ActivityStatus = "SUCCESS" | "FAILED" | "INFO";

export type ActivityDetail = Record<string, any>;

export async function recordActivity(
  actor: string,
  type: string,
  status: ActivityStatus,
  detail: ActivityDetail
) {
  await pool.query(
    "insert into ops_activity(actor,type,status,detail) values ($1,$2,$3,$4)",
    [actor, type, status, detail]
  );
}

export interface ActivityRow {
  id: number;
  ts: string;
  actor: string;
  type: string;
  status: ActivityStatus;
  detail: ActivityDetail;
}

export async function fetchRecentActivity(limit = 50): Promise<ActivityRow[]> {
  const { rows } = await pool.query(
    "select id, ts, actor, type, status, detail from ops_activity order by ts desc limit $1",
    [limit]
  );
  return rows;
}
