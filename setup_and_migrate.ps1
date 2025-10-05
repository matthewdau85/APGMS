<# =====================================================================
 setup_and_migrate.ps1  (PowerShell 5 compatible)
 - Calls setup_rpt_owa_stack.ps1 to scaffold files
 - Patches scaffolded migrations (001 rpt_tokens, 002 owa_constraints, 003 evidence_bundle)
 - Loads .env.local (DATABASE_URL or PG* vars incl. password)
 - Runs DB migrations with psql (non-interactive)
 ====================================================================== #>

param(
  [string]$RepoRoot = "C:\Users\matth\OneDrive\Desktop\apgms-final",
  [string]$EnvFile  = ".env.local"
)

function Ensure-Dir([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
  }
}

function Load-EnvFile([string]$Path) {
  if (-not (Test-Path $Path)) { throw "Env file not found: $Path" }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line -match '^(#|$)') { return }
    $line = $line -replace '^\s*export\s+', ''  # support "export KEY=VAL"
    $kv = $line -split '=', 2
    if ($kv.Count -ne 2) { return }
    $k = $kv[0].Trim()
    $v = $kv[1].Trim()
    if ($v -match '^"(.*)"$') { $v = $Matches[1] }
    elseif ($v -match "^'(.*)'$") { $v = $Matches[1] }
    $v = $v -replace '\\n', "`n"   # unescape \n
    Set-Item -Path ("Env:{0}" -f $k) -Value $v
  }
}

function Ensure-Psql() {
  $psql = Get-Command psql -ErrorAction SilentlyContinue
  if (-not $psql) { throw "psql not found. Install PostgreSQL client or add psql to PATH." }
}

# Parse connection from env, export PGPASSWORD, return password-less URL
function Build-ConnFromEnv() {
  $conn = @{ user=$null; pass=$null; host=$null; port=$null; db=$null }

  if ($env:DATABASE_URL) {
    $u = [Uri]$env:DATABASE_URL
    $userinfo = $u.UserInfo
    if ($userinfo -and $userinfo.Contains(":")) {
      $parts = $userinfo.Split(":", 2)
      $conn.user = $parts[0]; $conn.pass = $parts[1]
    } else { $conn.user = $userinfo; $conn.pass = "" }
    $conn.host = $u.Host
    if ($u.Port -gt 0) { $conn.port = $u.Port } else { $conn.port = 5432 }
    $conn.db = $u.AbsolutePath.TrimStart('/')
  } else {
    $conn.host = $(if ($env:PGHOST) {$env:PGHOST} else {"127.0.0.1"})
    $conn.port = $(if ($env:PGPORT) {[int]$env:PGPORT} else {5432})
    $conn.user = $env:PGUSER
    $conn.pass = $env:PGPASSWORD
    $conn.db   = $env:PGDATABASE
  }

  if (-not $conn.user) { throw "PGUSER or DATABASE_URL must be set" }
  if (-not $conn.db)   { throw "PGDATABASE or DATABASE_URL must be set" }

  if ($conn.pass -ne $null) { $env:PGPASSWORD = $conn.pass }  # psql reads this

  $url = ("postgres://{0}@{1}:{2}/{3}" -f $conn.user, $conn.host, $conn.port, $conn.db)
  return @{ url=$url; meta=$conn }
}

# psql wrappers (non-interactive)
function Invoke-PsqlCmd([string]$ConnUrl, [string]$Sql, [string]$Desc) {
  Write-Host $Desc -ForegroundColor Cyan
  & psql @("-d", $ConnUrl, "-v", "ON_ERROR_STOP=1", "-c", $Sql)
  if ($LASTEXITCODE -ne 0) { throw "psql failed ($Desc) exit $LASTEXITCODE" }
}
function Invoke-PsqlFile([string]$ConnUrl, [string]$File, [string]$Desc) {
  Write-Host $Desc -ForegroundColor Cyan
  & psql @("-d", $ConnUrl, "-v", "ON_ERROR_STOP=1", "-f", $File)
  if ($LASTEXITCODE -ne 0) { throw "psql failed ($Desc) exit $LASTEXITCODE" }
}

# ----------------- Main -----------------

Set-Location $RepoRoot

# 1) Scaffold files
$setupPath = Join-Path $RepoRoot "setup_rpt_owa_stack.ps1"
if (-not (Test-Path $setupPath)) { throw "setup_rpt_owa_stack.ps1 not found at $setupPath" }
Write-Host "Running scaffold..." -ForegroundColor Cyan
.\setup_rpt_owa_stack.ps1

# >>> PATCH the broken migration that scaffold just wrote (001) <<<
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$fixedPath = Join-Path $RepoRoot 'db\migrations\20251005_001_rpt_tokens.sql'
$fixedSql = @'
-- 20251005_001_rpt_tokens.sql  (fixed: partial uniqueness via UNIQUE INDEX)
BEGIN;

CREATE TABLE IF NOT EXISTS rpt_tokens (
  id               BIGSERIAL PRIMARY KEY,
  abn              TEXT        NOT NULL,
  tax_type         TEXT        NOT NULL,
  period_id        TEXT        NOT NULL,
  key_id           TEXT        NOT NULL,
  payload_json     JSONB       NOT NULL,
  payload_sha256   BYTEA       NOT NULL,
  sig_ed25519      BYTEA       NOT NULL,
  nonce            TEXT        NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status           TEXT        NOT NULL CHECK (status IN ('pending','active','revoked','expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_rpt_tokens_unique_pending_active
  ON rpt_tokens (abn, tax_type, period_id)
  WHERE status IN ('pending','active');

CREATE UNIQUE INDEX IF NOT EXISTS ux_rpt_tokens_nonce
  ON rpt_tokens (nonce);

CREATE INDEX IF NOT EXISTS ix_rpt_tokens_lookup
  ON rpt_tokens (abn, tax_type, period_id);

CREATE INDEX IF NOT EXISTS ix_rpt_tokens_expires_at
  ON rpt_tokens (expires_at);

COMMIT;
'@
[System.IO.File]::WriteAllText($fixedPath, $fixedSql, $utf8NoBom)

# >>> PATCH the owa_constraints migration that scaffold just wrote (002) <<< 
$fixedPath2 = Join-Path $RepoRoot 'db\migrations\20251005_002_owa_constraints.sql'
$fixedSql2 = @'
-- 20251005_002_owa_constraints.sql (superseded by consolidated migrations)
BEGIN;
-- The canonical OWA ledger DDL now lives in migrations/001_apgms_core.sql.
-- This placeholder intentionally performs no additional schema changes so
-- legacy provisioning scripts do not diverge from the authoritative schema.
COMMIT;
'@
[System.IO.File]::WriteAllText($fixedPath2, $fixedSql2, $utf8NoBom)

# >>> PATCH the evidence_bundle migration that scaffold just wrote (003) <<<
$fixedPath3 = Join-Path $RepoRoot 'db\migrations\20251005_003_evidence_bundle.sql'
$fixedSql3 = @'
-- 20251005_003_evidence_bundle.sql (fixed: define rpt_id + content-addressed blobs)
BEGIN;

-- Content-addressed blob store keyed by payload_sha256
CREATE TABLE IF NOT EXISTS evidence_blobs (
  payload_sha256 BYTEA PRIMARY KEY,  -- sha256 of the evidence bundle payload
  content        BYTEA NOT NULL,     -- serialized bundle (JSON/CBOR/etc.)
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evidence bundle header / index for a period
CREATE TABLE IF NOT EXISTS evidence_bundles (
  id                    BIGSERIAL PRIMARY KEY,
  abn                   TEXT        NOT NULL,
  tax_type              TEXT        NOT NULL,
  period_id             TEXT        NOT NULL,

  -- foreign keys
  rpt_id                BIGINT REFERENCES rpt_tokens(id) ON DELETE SET NULL,
  payload_sha256        BYTEA NOT NULL REFERENCES evidence_blobs(payload_sha256) ON DELETE RESTRICT,

  -- core bundle fields
  normalization_checksums JSONB,
  anomaly_vector         JSONB,
  thresholds             JSONB,
  owa_hash_before        BYTEA,
  owa_hash_after         BYTEA,

  -- snapshot of RPT artifacts for immutability
  rpt_payload_json       JSONB,
  rpt_sig_ed25519        BYTEA,
  rpt_payload_sha256     BYTEA,

  -- receipts / chain-of-custody
  bank_receipt_id        TEXT,
  ato_receipt_id         TEXT,

  -- operator notes / overrides
  operator_overrides     JSONB,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One bundle per {abn,tax_type,period_id} is typical; make it unique
CREATE UNIQUE INDEX IF NOT EXISTS ux_evidence_bundle_period
  ON evidence_bundles (abn, tax_type, period_id);

-- Helpful lookups
CREATE INDEX IF NOT EXISTS ix_evidence_bundles_rpt_id
  ON evidence_bundles (rpt_id);

COMMIT;
'@
[System.IO.File]::WriteAllText($fixedPath3, $fixedSql3, $utf8NoBom)

# 2) Load env.local (gets DATABASE_URL or PG* vars incl. password)
$envPath = Join-Path $RepoRoot $EnvFile
Write-Host "Loading environment from $envPath" -ForegroundColor Cyan
Load-EnvFile $envPath

# --- Debug print of what was loaded from .env.local (PS5-safe) ---
Write-Host "Loaded env:" -ForegroundColor DarkGray
Write-Host ("  DATABASE_URL: {0}" -f ($(if ($env:DATABASE_URL) { $env:DATABASE_URL } else { "<unset>" })))
Write-Host ("  PGHOST      : {0}" -f ($(if ($env:PGHOST)       { $env:PGHOST }       else { "<unset>" })))
Write-Host ("  PGPORT      : {0}" -f ($(if ($env:PGPORT)       { $env:PGPORT }       else { "<unset>" })))
Write-Host ("  PGUSER      : {0}" -f ($(if ($env:PGUSER)       { $env:PGUSER }       else { "<unset>" })))
Write-Host ("  PGDATABASE  : {0}" -f ($(if ($env:PGDATABASE)   { $env:PGDATABASE }   else { "<unset>" })))
Write-Host ("  PGPASSWORD  : {0}" -f ($(if ($env:PGPASSWORD)   { "<set>" }            else { "<unset>" })))

# Hard fail if neither PGPASSWORD nor a password inside DATABASE_URL is present
$hasPwdInUrl = $false
if ($env:DATABASE_URL) {
  try {
    $u = [Uri]$env:DATABASE_URL
    if ($u.UserInfo -and $u.UserInfo.Contains(":")) { $hasPwdInUrl = $true }
  } catch { $hasPwdInUrl = $false }
}
if (-not $env:PGPASSWORD -and -not $hasPwdInUrl) {
  throw "No database password found. Set PGPASSWORD in .env.local or include a password in DATABASE_URL."
}

# 3) Ensure psql present
Ensure-Psql

# 4) Build connection (exports PGPASSWORD, returns password-less URL)
$built = Build-ConnFromEnv
$connectionString = $built.url
Write-Host "Using connection (PGPASSWORD from .env.local): $connectionString" -ForegroundColor DarkGray

# 5) Run migrations (with robust error handling)
$ErrorActionPreference = "Stop"

try {
  Invoke-PsqlCmd  $connectionString 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' 'Ensuring pgcrypto'
  Invoke-PsqlFile $connectionString (Join-Path $RepoRoot 'db\migrations\20251005_001_rpt_tokens.sql') 'Migrating rpt_tokens'
  Invoke-PsqlFile $connectionString (Join-Path $RepoRoot 'db\migrations\20251005_002_owa_constraints.sql') 'Migrating owa_constraints'
  Invoke-PsqlFile $connectionString (Join-Path $RepoRoot 'db\migrations\20251005_003_evidence_bundle.sql') 'Migrating evidence_bundle'

} catch {
  $msg = $_.Exception.Message

  if ($msg -match 'password authentication failed|database .* does not exist|role .* does not exist') {
    Write-Warning "Auth/objects missing. Bootstrapping role/database via postgres superuser…"

    # Determine intended app user/db/host/port
    $appUser = $built.meta.user
    $appPass = $built.meta.pass
    $appHost = $built.meta.host
    $appPort = $built.meta.port
    $appDb   = $built.meta.db

    if (-not $appUser -or -not $appDb) {
      throw "Cannot determine app user/database from env."
    }

    # Prompt for superuser password (change name if your superuser differs)
    $pgsu = "postgres"
    $sec = Read-Host -Prompt "Enter password for superuser '$pgsu' (will not echo)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
    $suPass = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $env:PGPASSWORD = $suPass

    # Superuser connection
    $superUrl = ("postgres://{0}@{1}:{2}/{3}" -f $pgsu, $appHost, $appPort, "postgres")

    # Create role/db if missing (idempotent)
    $createRoleSql = "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$appUser') THEN CREATE ROLE ""$appUser"" LOGIN PASSWORD '$appPass'; END IF; END $$;"
    $createDbSql   = "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_database WHERE datname = '$appDb') THEN CREATE DATABASE ""$appDb"" OWNER ""$appUser""; END IF; END $$;"

    Invoke-PsqlCmd  $superUrl $createRoleSql "Ensuring role $appUser"
    Invoke-PsqlCmd  $superUrl $createDbSql   "Ensuring database $appDb"

    # Switch env back to app password; retry migrations
    if ($appPass) { $env:PGPASSWORD = $appPass } else { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    $retryUrl = ("postgres://{0}@{1}:{2}/{3}" -f $appUser, $appHost, $appPort, $appDb)

    Invoke-PsqlCmd  $retryUrl 'CREATE EXTENSION IF NOT EXISTS pgcrypto;' 'Ensuring pgcrypto (retry)'
    Invoke-PsqlFile $retryUrl (Join-Path $RepoRoot 'db\migrations\20251005_001_rpt_tokens.sql') 'Migrating rpt_tokens (retry)'
    Invoke-PsqlFile $retryUrl (Join-Path $RepoRoot 'db\migrations\20251005_002_owa_constraints.sql') 'Migrating owa_constraints (retry)'
    Invoke-PsqlFile $retryUrl (Join-Path $RepoRoot 'db\migrations\20251005_003_evidence_bundle.sql') 'Migrating evidence_bundle (retry)'

  } else {
    throw
  }
}

Write-Host "Migrations complete." -ForegroundColor Green

# 6) Next steps
Write-Host "`nNext steps:" -ForegroundColor Yellow
Write-Host "  cd .\apps\services\payments"
Write-Host "  npm install"
Write-Host "  npm run build"
Write-Host "  npm start"
