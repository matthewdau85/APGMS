<# =====================================================================
  test_payments_e2e.ps1  (PowerShell 5+)
  - Assumes payments service is running (PORT 3001 or given BaseUrl)
  - Seeds a unique test period via seed_rpt_local.mjs
  - Deposit + Release flows against the service
  - Verifies duplicate-release is rejected
  - Cleans up DB rows at the end
===================================================================== #>

param(
  [string]$BaseUrl = "http://localhost:3001",

  # DB from env with sane defaults
  [string]$PGHOST = $(if ($env:PGHOST) { $env:PGHOST } else { "127.0.0.1" }),
  [string]$PGUSER = $(if ($env:PGUSER) { $env:PGUSER } else { "apgms" }),
  [string]$PGPASSWORD = $(if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "" }),
  [string]$PGDATABASE = $(if ($env:PGDATABASE) { $env:PGDATABASE } else { "apgms" }),
  [int]$PGPORT = $(if ($env:PGPORT) { [int]$env:PGPORT } else { 5432 })
)

# -------- helpers --------
function Say([string]$msg, [string]$color="Gray") { Write-Host $msg -ForegroundColor $color }
function Fail([string]$msg) { throw $msg }

function Call-Api([string]$method, [string]$url, $bodyObj=$null) {
  try {
    if ($bodyObj -ne $null) {
      $json = $bodyObj | ConvertTo-Json -Compress
      return Invoke-RestMethod -Uri $url -Method $method -ContentType "application/json" -Body $json
    } else {
      return Invoke-RestMethod -Uri $url -Method $method
    }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp.StatusCode) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $text = $sr.ReadToEnd()
      return @{ __error = $true; status = [int]$resp.StatusCode; body = $text }
    }
    return @{ __error = $true; status = 0; body = $_.Exception.Message }
  }
}

function Psql-Exec([string]$sql) {
  $env:PGPASSWORD = $PGPASSWORD
  $args = @(
    "-U", $PGUSER,
    "-h", $PGHOST,
    "-p", $PGPORT,
    "-d", $PGDATABASE,
    "-v", "ON_ERROR_STOP=1",
    "-t", "-A", "-F", "|",
    "-c", $sql
  )
  $out = & psql @args 2>&1
  if ($LASTEXITCODE -ne 0) {
    Fail "psql failed: $out"
  }
  return $out
}

# -------- start --------
Say "== Payments E2E test on $BaseUrl ==" "Cyan"

# 1) Health
$health = Call-Api "GET" ($BaseUrl.TrimEnd('/') + "/health")
if ($health.__error) {
  Say "`nhealth: FAIL status=$($health.status) body=$($health.body)" "Red"
  Say "`n================= E2E TEST REPORT =================" "Yellow"
  "{0,-7} {1,-6} {2}" -f "Step","Result","Detail" | Write-Host
  "{0,-7} {1,-6} {2}" -f "health","FAIL","status=$($health.status) body=$($health.body)" | Write-Host
  "{0,-7} {1,-6} {2}" -f "fatal","FAIL","Service not healthy" | Write-Host
  "{0,-7} {1,-6} {2}" -f "cleanup","PASS","(skipped)" | Write-Host
  Say "`n===================================================" "Yellow"
  exit 1
}
Say "health: PASS $($health | ConvertTo-Json -Compress)" "Green"

# 2) Fresh period & constants
$abn = "12345678901"
$taxType = "GST"
$periodId = "E2E-" + (Get-Date -Format "yyyyMMddHHmmss")

# 3) Seed an active RPT for that period
$repoRoot = Split-Path (Split-Path $PSScriptRoot) -Parent
$seedScript = Join-Path $repoRoot "scripts\seed_rpt_local.mjs"
if (-not (Test-Path $seedScript)) { Fail "seed script not found at $seedScript" }

$prevPERIOD = $env:PERIOD_ID
$env:PERIOD_ID = $periodId
try {
  Say "seeding RPT for period $periodId ..." "DarkGray"
  $nodeOut = & node $seedScript 2>&1
  if ($LASTEXITCODE -ne 0) { Fail "seed_rpt_local.mjs failed: $nodeOut" }
  Say "seed output: $nodeOut" "DarkGray"
} finally {
  if ($prevPERIOD) { $env:PERIOD_ID = $prevPERIOD } else { Remove-Item Env:PERIOD_ID -ErrorAction SilentlyContinue }
}

# 4) Deposit +2500
$dep = Call-Api "POST" ($BaseUrl.TrimEnd('/') + "/deposit") @{ abn=$abn; taxType=$taxType; periodId=$periodId; amountCents=2500 }
$depOk = (-not $dep.__error)

if ($depOk) {
  Say "deposit: PASS $($dep | ConvertTo-Json -Compress)" "Green"
} else {
  Say "deposit: FAIL status=$($dep.status) body=$($dep.body)" "Red"
}

# 5) Release -1500 (should PASS)
$rel = Call-Api "POST" ($BaseUrl.TrimEnd('/') + "/payAto") @{ abn=$abn; taxType=$taxType; periodId=$periodId; amountCents=-1500 }
$relOk = (-not $rel.__error)

if ($relOk) {
  Say "release: PASS $($rel | ConvertTo-Json -Compress)" "Green"
} else {
  Say "release: FAIL status=$($rel.status) body=$($rel.body)" "Red"
}

# 6) Duplicate release (should FAIL by unique index)
$dup = Call-Api "POST" ($BaseUrl.TrimEnd('/') + "/payAto") @{ abn=$abn; taxType=$taxType; periodId=$periodId; amountCents=-500 }
$dupRejected = ($dup.__error -and ($dup.status -ge 400))

if ($dupRejected) {
  Say "duplicate release: PASS (rejected as expected) status=$($dup.status) msg=$($dup.body)" "Green"
} else {
  Say "duplicate release: FAIL (should have been rejected) resp=$($dup | ConvertTo-Json -Compress)" "Red"
}

# 7) Snapshot ledger rows
$selSql = "SELECT id,amount_cents,balance_after_cents,rpt_verified,release_uuid,created_at FROM owa_ledger WHERE abn='$abn' AND tax_type='$taxType' AND period_id='$periodId' ORDER BY id ASC;"
$rows = Psql-Exec $selSql
$rowsClean = ($rows -split "`r?`n") | Where-Object { $_ -and ($_ -notmatch '^\s*$') }

# 8) Cleanup
$env:PGPASSWORD = $PGPASSWORD
$null = Psql-Exec "DELETE FROM evidence_bundles WHERE abn='$abn' AND tax_type='$taxType' AND period_id='$periodId';"
$null = Psql-Exec "DELETE FROM owa_ledger WHERE abn='$abn' AND tax_type='$taxType' AND period_id='$periodId';"
$null = Psql-Exec "DELETE FROM rpt_tokens WHERE abn='$abn' AND tax_type='$taxType' AND period_id='$periodId';"

# 9) Report (PowerShell-safeâ€”no ternaries)
$depResult  = if ($depOk) { "PASS" } else { "FAIL" }
$depDetail  = if ($depOk) { "ledger_id=$($dep.ledger_id)" } else { "status=$($dep.status) body=$($dep.body)" }

$relResult  = if ($relOk) { "PASS" } else { "FAIL" }
$relDetail  = if ($relOk) { "ledger_id=$($rel.ledger_id)" } else { "status=$($rel.status) body=$($rel.body)" }

$dupResult  = if ($dupRejected) { "PASS" } else { "FAIL" }
$dupDetail  = if ($dupRejected) { "rejected" } else { "unexpectedly accepted" }

Say "`n================= E2E TEST REPORT =================" "Yellow"
"{0,-7} {1,-6} {2}" -f "Step","Result","Detail" | Write-Host
"{0,-7} {1,-6} {2}" -f "health","PASS","ok=true" | Write-Host
"{0,-7} {1,-6} {2}" -f "seed","PASS","period=$periodId" | Write-Host
"{0,-7} {1,-6} {2}" -f "deposit",$depResult,$depDetail | Write-Host
"{0,-7} {1,-6} {2}" -f "release",$relResult,$relDetail | Write-Host
"{0,-7} {1,-6} {2}" -f "dupRel",$dupResult,$dupDetail | Write-Host

Say "`nLedger rows for ${periodId}:" "DarkGray"
$rowsClean | ForEach-Object { Write-Host "  $_" }

"{0,-7} {1,-6} {2}" -f "cleanup","PASS","removed rows for period $periodId" | Write-Host
Say "`n===================================================" "Yellow"

