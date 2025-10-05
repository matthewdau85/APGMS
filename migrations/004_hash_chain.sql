create or replace function ledger_hash_head_fn() returns trigger as $$
declare prev text;
begin
  if TG_OP = 'INSERT' then
    select max(hash_head) into prev from ledger where abn = NEW.abn and coalesce(period_id,-1) = coalesce(NEW.period_id,-1);
    NEW.hash_head := encode(digest(coalesce(prev,'') || json_build_object(
      'direction', NEW.direction,
      'amount_cents', NEW.amount_cents,
      'source', NEW.source,
      'meta', NEW.meta,
      'ts', now()
    )::text, 'sha256'), 'hex');
  end if;
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_ledger_hash_head on ledger;
create trigger trg_ledger_hash_head before insert on ledger
for each row execute function ledger_hash_head_fn();
