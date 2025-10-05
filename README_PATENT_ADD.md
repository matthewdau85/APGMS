# APGMS Patent Gate-and-Token Additions

## Quick start
1) Apply migrations in Postgres (run in order):
   psql -h 127.0.0.1 -U postgres -d postgres -f migrations/001_apgms_core.sql
   psql -h 127.0.0.1 -U postgres -d postgres -f migrations/002_apgms_patent_core.sql
   psql -h 127.0.0.1 -U postgres -d postgres -f migrations/002_patent_extensions.sql

2) Build and run the services:
   docker compose -f docker-compose.patent.yml build
   docker compose -f docker-compose.patent.yml up -d

3) Happy path (manual):
   # 3.1 move gate to RPT-Issued (after your recon pass)
   curl -X POST http://localhost:8101/gate/transition -H "content-type: application/json" ^
     -d "{""period_id"":""2024Q4"",""target_state"":""RPT-Issued""}"

   # 3.2 generate an RPT in Python REPL (or via your engine):
   # from libs.rpt.rpt import build
   # rpt = build("2024Q4",100.0,200.0,{"payroll":"abc","pos":"def"},0.1)

   # 3.3 remit (bank-egress)
   curl -X POST http://localhost:8103/egress/remit -H "content-type: application/json" ^
     -d "{""period_id"":""2024Q4"",""rpt"":{""period_id"":""2024Q4"",""paygw_total"":100.0,""gst_total"":200.0,""source_digests"":{""payroll"":""abc"",""pos"":""def""},""anomaly_score"":0.1,""expires_at"":9999999999,""nonce"":""deadbeef"",""signature"":""REPLACE_WITH_REAL_SIGNATURE""}}"

4) Acceptance tests:
   # assuming your venv:
   # pip install -r apps/services/bas-gate/requirements.txt
   # pip install -r apps/services/recon/requirements.txt
   # pip install -r apps/services/bank-egress/requirements.txt
   # pip install -r apps/services/audit/requirements.txt
   # pip install pytest
   pytest -q

Notes:
- Replace the HMAC secret with KMS in production.
- Enforce SoD in your auth layer: role A issues RPT, role B calls egress.

## Canonical schema summary
- `owa_ledger` now exposes both the tax-ledger cent-based fields and the patent credit view via the generated `credit_amount` column alongside `amount_cents`, idempotency hashes (`prev_hash`/`hash_after`) and banking references (`bank_receipt_hash`, `source_ref`, `audit_hash`).
- `audit_log` remains an append-only hash chain (`prev_hash` → `terminal_hash`) while also carrying optional categorical metadata (`category`, `message`) for patent service audit trails. Both patent services and legacy appenders use the same table.
- `rpt_store` is a compatibility view over `rpt_tokens`, so the Python audit bundle code can continue querying `rpt_store` without diverging storage.
