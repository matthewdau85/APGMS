create table if not exists audit_events(
  id bigserial primary key,
  ts timestamptz not null default now(),
  actor text,
  action text not null,
  target text,
  ip text,
  details jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text
);

create or replace function audit_hash_fn() returns trigger as $$
declare prev text;
begin
  select hash into prev from audit_events order by id desc limit 1;
  new.prev_hash := coalesce(prev,'');
  new.hash := encode(digest(new.prev_hash || coalesce(new.actor,'') || new.action || coalesce(new.target,'') || new.ts::text, 'sha256'),'hex');
  return new;
end; $$ language plpgsql;

drop trigger if exists trg_audit_hash on audit_events;
create trigger trg_audit_hash before insert on audit_events for each row execute function audit_hash_fn();
