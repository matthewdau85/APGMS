-- 003_reconciliation_queues.sql
-- Queue tables and materialized views for reconciliation workflows

create table if not exists unreconciled_queue (
  id bigserial primary key,
  period_id integer not null references periods(id) on delete cascade,
  source_system text not null,
  source_record_id text not null,
  state text not null default 'UNRECONCILED',
  detected_at timestamptz not null default now(),
  blocking boolean not null default true,
  metadata jsonb not null default '{}',
  unique (period_id, source_system, source_record_id)
);

create index if not exists idx_unreconciled_period on unreconciled_queue(period_id);
create index if not exists idx_unreconciled_state on unreconciled_queue(state);

create table if not exists reconciliation_dlq (
  id bigserial primary key,
  period_id integer references periods(id) on delete set null,
  source_system text not null,
  source_record_id text,
  failure_reason text not null,
  last_error_at timestamptz not null default now(),
  retry_after timestamptz,
  blocking boolean not null default false,
  metadata jsonb not null default '{}'
);

create index if not exists idx_dlq_period on reconciliation_dlq(period_id);
create index if not exists idx_dlq_retry on reconciliation_dlq(retry_after);

create materialized view if not exists queue_anomalies as
with anomaly_source as (
  select
    p.id as period_internal_id,
    p.abn,
    p.tax_type,
    p.period_id,
    p.state as period_state,
    case
      when jsonb_typeof(p.anomaly_vector) = 'array' then p.anomaly_vector
      when jsonb_typeof(p.anomaly_vector -> 'anomalies') = 'array' then p.anomaly_vector -> 'anomalies'
      else '[]'::jsonb
    end as anomalies
  from periods p
), flattened as (
  select
    a.period_internal_id,
    a.abn,
    a.tax_type,
    a.period_id,
    a.period_state,
    jsonb_array_elements(a.anomalies) as anomaly_payload
  from anomaly_source a
)
select
  concat('ANOM-', flattened.period_internal_id, '-', md5(coalesce(flattened.anomaly_payload::text, ''))) as queue_item_id,
  flattened.period_internal_id,
  flattened.abn,
  flattened.tax_type,
  flattened.period_id,
  flattened.period_state,
  flattened.anomaly_payload ->> 'code' as anomaly_code,
  flattened.anomaly_payload ->> 'category' as anomaly_category,
  (flattened.anomaly_payload ->> 'detected_at')::timestamptz as detected_at,
  coalesce((flattened.anomaly_payload ->> 'blocking')::boolean, true) as blocking,
  flattened.anomaly_payload as payload
from flattened;

create index if not exists idx_queue_anomalies_period_state on queue_anomalies(period_state);
create index if not exists idx_queue_anomalies_period on queue_anomalies(period_id);

create materialized view if not exists queue_unreconciled as
select
  u.id as queue_item_id,
  p.abn,
  p.tax_type,
  p.period_id,
  p.state as period_state,
  u.source_system,
  u.source_record_id,
  u.state,
  u.detected_at,
  u.blocking,
  u.metadata
from unreconciled_queue u
join periods p on p.id = u.period_id;

create index if not exists idx_queue_unreconciled_state on queue_unreconciled(state);

create materialized view if not exists queue_dlq as
select
  d.id as queue_item_id,
  p.abn,
  p.tax_type,
  p.period_id,
  p.state as period_state,
  d.source_system,
  d.source_record_id,
  d.failure_reason,
  d.last_error_at,
  d.retry_after,
  d.blocking,
  d.metadata
from reconciliation_dlq d
left join periods p on p.id = d.period_id;

create index if not exists idx_queue_dlq_period_state on queue_dlq(period_state);

