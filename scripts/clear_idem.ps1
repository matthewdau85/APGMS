param(
  [string]$DbHost = "127.0.0.1",
  [string]$DbName = "apgms",
  [string]$DbUser = "apgms",
  [string]$DbPwd  = "apgms_pw",
  [switch]$ExpiredOnly
)

$ErrorActionPreference = "Stop"
$env:PGPASSWORD = $DbPwd

if ($ExpiredOnly) {
  $sql = "DELETE FROM idempotency_keys WHERE first_seen + make_interval(secs => COALESCE(ttl_secs,0)) < now();"
  Write-Host "Deleting expired idempotency keys..." -ForegroundColor Cyan
} else {
  $sql = "TRUNCATE idempotency_keys;"
  Write-Host "Truncating idempotency keys table..." -ForegroundColor Yellow
}

& psql -h $DbHost -U $DbUser -d $DbName -v ON_ERROR_STOP=1 -c $sql
