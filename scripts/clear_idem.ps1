param(
    [string]$ConnectionString = $env:DATABASE_URL
)

if (-not $ConnectionString -or $ConnectionString.Trim() -eq "") {
    $user = if ($env:PGUSER) { $env:PGUSER } else { "postgres" }
    $pass = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "postgres" }
    $host = if ($env:PGHOST) { $env:PGHOST } else { "127.0.0.1" }
    $port = if ($env:PGPORT) { $env:PGPORT } else { "5432" }
    $db = if ($env:PGDATABASE) { $env:PGDATABASE } else { "postgres" }
    $ConnectionString = "postgresql://$user:$pass@$host:$port/$db"
}

Write-Host "[clear-idem] Connecting with $ConnectionString"

$sql = @"
with expired as (
  delete from idempotency_keys
   where (first_seen_at + (ttl_secs::text || ' seconds')::interval) < now()
   returning response_hash
)
delete from idempotency_responses r
 where r.hash = any(array(select response_hash from expired where response_hash is not null));
"@

$psqlArgs = @("$ConnectionString", "-v", "ON_ERROR_STOP=1", "-c", $sql)
$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    throw "psql command not found. Please install PostgreSQL client tools."
}

& psql @psqlArgs

if ($LASTEXITCODE -ne 0) {
    throw "Failed to clear idempotency keys (exit $LASTEXITCODE)"
}

Write-Host "[clear-idem] Expired idempotency records purged."
