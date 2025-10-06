create index if not exists ix_ledger_abn_period on ledger (abn, period_id);
create index if not exists ix_evidence_abn_period on evidence_bundles (abn, period_id);
create index if not exists ix_periods_abn on periods (abn);
create index if not exists ix_idempotency_key on idempotency (key);
create index if not exists ix_payroll_events_abn on payroll_events (abn);
