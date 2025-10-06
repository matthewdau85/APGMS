import { query, pool, type Queryable } from "./db";

export interface PayrollEvent {
  id: number;
  source: string;
  event_id: string;
  abn: string;
  tax_type: string;
  period_id: string;
  occurred_at: Date;
  gross_cents: string | null;
  withheld_cents: string | null;
  payload: any;
}

export interface PosEvent {
  id: number;
  source: string;
  event_id: string;
  abn: string;
  period_id: string;
  occurred_at: Date;
  total_cents: string | null;
  gst_cents: string | null;
  payload: any;
}

export async function insertPayrollEvent(
  event: Omit<PayrollEvent, "id">,
  client: Queryable = pool,
): Promise<void> {
  await query(
    `INSERT INTO payroll_events(source,event_id,abn,tax_type,period_id,occurred_at,gross_cents,withheld_cents,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (source,event_id) DO UPDATE
       SET payload=EXCLUDED.payload,
           occurred_at=EXCLUDED.occurred_at,
           gross_cents=EXCLUDED.gross_cents,
           withheld_cents=EXCLUDED.withheld_cents`,
    [
      event.source,
      event.event_id,
      event.abn,
      event.tax_type,
      event.period_id,
      event.occurred_at,
      event.gross_cents,
      event.withheld_cents,
      event.payload,
    ],
    client,
  );
}

export async function insertPosEvent(
  event: Omit<PosEvent, "id">,
  client: Queryable = pool,
): Promise<void> {
  await query(
    `INSERT INTO pos_events(source,event_id,abn,period_id,occurred_at,total_cents,gst_cents,payload)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (source,event_id) DO UPDATE
       SET payload=EXCLUDED.payload,
           occurred_at=EXCLUDED.occurred_at,
           total_cents=EXCLUDED.total_cents,
           gst_cents=EXCLUDED.gst_cents`,
    [
      event.source,
      event.event_id,
      event.abn,
      event.period_id,
      event.occurred_at,
      event.total_cents,
      event.gst_cents,
      event.payload,
    ],
    client,
  );
}

export async function enqueueDlq(
  source: string,
  eventId: string | null,
  payload: unknown,
  error: string,
  client: Queryable = pool,
): Promise<void> {
  await query(
    `INSERT INTO ingestion_dlq(source_system,event_id,payload,error_message)
     VALUES($1,$2,$3,$4)`,
    [source, eventId, payload, error],
    client,
  );
}

export async function payrollTotalsForPeriod(
  abn: string,
  periodId: string,
  client: Queryable = pool,
): Promise<{ gross: bigint; withheld: bigint }> {
  const { rows } = await query<{ gross: string | null; withheld: string | null }>(
    `SELECT SUM(gross_cents) AS gross, SUM(withheld_cents) AS withheld
       FROM payroll_events
       WHERE abn=$1 AND period_id=$2`,
    [abn, periodId],
    client,
  );
  const gross = rows[0]?.gross ?? "0";
  const withheld = rows[0]?.withheld ?? "0";
  return { gross: BigInt(gross), withheld: BigInt(withheld) };
}

export async function posTotalsForPeriod(
  abn: string,
  periodId: string,
  client: Queryable = pool,
): Promise<{ total: bigint; gst: bigint }> {
  const { rows } = await query<{ total: string | null; gst: string | null }>(
    `SELECT SUM(total_cents) AS total, SUM(gst_cents) AS gst
       FROM pos_events
       WHERE abn=$1 AND period_id=$2`,
    [abn, periodId],
    client,
  );
  const total = rows[0]?.total ?? "0";
  const gst = rows[0]?.gst ?? "0";
  return { total: BigInt(total), gst: BigInt(gst) };
}

export interface OrderedEventSummary {
  event_id: string;
  occurred_at: Date;
  amount_cents: string;
}

export async function orderedPayrollEvents(
  abn: string,
  periodId: string,
  client: Queryable = pool,
): Promise<OrderedEventSummary[]> {
  const { rows } = await query<OrderedEventSummary>(
    `SELECT event_id, occurred_at, COALESCE(withheld_cents,'0') AS amount_cents
       FROM payroll_events
       WHERE abn=$1 AND period_id=$2
       ORDER BY occurred_at ASC, event_id ASC`,
    [abn, periodId],
    client,
  );
  return rows;
}

export async function orderedPosEvents(
  abn: string,
  periodId: string,
  client: Queryable = pool,
): Promise<OrderedEventSummary[]> {
  const { rows } = await query<OrderedEventSummary>(
    `SELECT event_id, occurred_at, COALESCE(gst_cents,'0') AS amount_cents
       FROM pos_events
       WHERE abn=$1 AND period_id=$2
       ORDER BY occurred_at ASC, event_id ASC`,
    [abn, periodId],
    client,
  );
  return rows;
}

