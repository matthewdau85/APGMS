# Run APGMS API locally

## Migrate (Postgres must be running)
$env:DATABASE_URL="postgres://apgms:apgms@127.0.0.1:5432/apgms"
psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U apgms -d apgms -p 5432 -f ".\migrations\001_apgms_core.sql"
psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -U apgms -d apgms -p 5432 -f ".\migrations\002_apgms_patent_core.sql"

## Dev mode
npm run dev

## Build + start
npm run build
npm start

## Health check
curl http://127.0.0.1:8080/healthz

## Tests
npm test
