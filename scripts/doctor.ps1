<# ========================================================================
  scripts/doctor.ps1  —  Payments E2E Doctor (PowerShell 5 compatible)

  What it does:
    1) Loads env from repo-root .env.local (won’t overwrite existing session vars)
    2) Health-checks:
       - Payments service:      http://localhost:3001/health  (configurable)
       - App (your Express app): http://localhost:3000/health (optional)
    3) Ensures an ACTIVE RPT exists for the release period (copies latest ACTIVE)
    4) Calls via your APP endpoints:
         GET  /api/balance
         POST /api/deposit      (positive)
         POST /api/release      (negative, once/period)
         GET  /api/ledger
    5) Optional -Cleanup: deletes ledger rows created during this run (by timestamp)
    6) Writes scripts\doctor_report.md

  Usage:
    cd C:\Users\matth\OneDrive\Desktop\apgms-final
    .\scripts\doctor.ps1

    # custom run
    .\scripts\doctor.ps1 -BaseAppUrl http://localhost:3000 `
                         -BaseSvcUrl http://localhost:3001 `
                         -ABN 12345678901 -TaxType GST `
                         -PeriodDeposit 2025Q4 -PeriodRelease 2025Q5 `
                         -AmountDeposit 2500 -AmountRelease -1500 `
                         -Cleanup
========================================================================= #>

[CmdletBinding()]
param(
  [string]$BaseAppUrl     = "http://localhost:3000",
  [string]$BaseSvcUrl     = "http://localhost:3001",

  [string]$ABN            = "12345678901",
  [string]$TaxType        = "GST",
  [string]$PeriodDeposit  = "2025Q4",
  [string]$PeriodRelease  = "2025Q5",

  [int]$AmountDeposit     = 2500,   # positive
  [int]$AmountRelease     = -1500,  # negative

  [switch]$Cleanup
)

###############################################################################
# Globals
###############################################################################
$Script:RepoRoot   = Split-Path -Parent $PSScriptRoot
$Script:StartTime  = Get-Date
$Script:ReportPath = Join-Path $PSScriptRoot "doctor_report.md"
$Script:LogLines   = New-Object System.Collections.Generic.List[string]

###############################################################################
# Helpers
###############################################################################
function Say {
  param([string]$Msg, [ConsoleColor]$Color = [ConsoleColor]::Gray)
  $old = $Host.UI.RawUI.ForegroundColor
  try {
    $Host.UI.RawUI.ForegroundColor = $Color
    Write-Host $Msg
  } finally {
    $Host.UI.RawUI.ForegroundColor = $old
  }
  $Script:LogLines.Add($Msg)
}

function Load-EnvIfNeeded {
  param([string]$RelPath = ".env.local")

  $full = Join-Path $Script:RepoRoot $RelPath
  if (-not (Test-Path $full)) { return }

  $lines = Get-Content -LiteralPath $full
  foreach ($l in $lines) {
    $line = $l.Trim()
    if ($line -eq "" -or $line.StartsWith("#")) { continue }

    # strip optional "export "
    $line = ($line -replace '^\s*export\s+', '')

    $kv = $line -split '=', 2
    if ($kv.Count -ne 2) { continue }

    $k = $kv[0].Trim()
    $v = $kv[1].Trim()

    # strip quotes
    if ($v -match '^"(.*)"$') { $v = $matches[1] }
    elseif ($v -match "^'(.*)'$") { $v = $matches[1] }

    $current = [Environment]::GetEnvironmentVariable($k, 'Process')
    if ([string]::IsNullOrEmpty($current)) {
      [Environment]::SetEnvironmentVariable($k, $v, 'Process')
    }
  }
}

function Invoke-Http {
  param(
    [ValidateSet('GET','POST')] [string]$Method,
    [string]$Url,
    [Hashtable]$Body = $null
  )
  try {
    if ($Method -eq 'GET') {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Get
      return @{ ok=$true; status=$r.StatusCode; body=$r.Content }
    } else {
      if ($Body -ne $null) { $json = $Body | ConvertTo-Json -Depth 8 } else { $json = "{}" }
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -Method Post -Body $json -ContentType "application/json"
      return @{ ok=$true; status=$r.StatusCode; body=$r.Content }
    }
  } catch {
    $resp = $_.Exception.Response
    if ($resp -and $resp -is [System.Net.HttpWebResponse]) {
      try {
        $stream = $resp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $text   = $reader.ReadToEnd()
        return @{ ok=$false; status=[int]$resp.StatusCode; body=$text }
      } catch {
        return @{ ok=$false; status=[int]$resp.StatusCode; body="" }
      }
    }
    return @{ ok=$false; status=0; body=$_.Exception.Message }
  }
}

function Psql {
  param([string]$Sql)
  $env:PGCLIENTENCODING = "UTF8"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Sql)
  $tmp   = [System.IO.Path]::GetTempFileName()
  [System.IO.File]::WriteAllBytes($tmp, $bytes)
  try {
    $out = & psql -h $env:PGHOST -U $env:PGUSER -d $env:PGDATABASE -f $tmp 2>&1
    $success = ($LASTEXITCODE -eq 0)
    return @{ ok=$success; text=($out -join "`n") }
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}

function Psql-Scalar {
  param([string]$Sql)
  $cmd = "psql -h $($env:PGHOST) -U $($env:PGUSER) -d $($env:PGDATABASE) -t -A -c ""$Sql"""
  $out = cmd.exe /c $cmd 2>&1
  $success = ($LASTEXITCODE -eq 0)
  $val = ""
  if ($success) { $val = ($out | Out-String).Trim() }
  return @{ ok=$success; value=$val; raw=($out -join "`n") }
}

###############################################################################
# 0) Load ENV
###############################################################################
Say "== Loading .env.local (repo root) if present ==" "Cyan"
Load-EnvIfNeeded ".env.local"

if (-not $env:PGHOST)     { $env:PGHOST     = "127.0.0.1" }
if (-not $env:PGUSER)     { $env:PGUSER     = "apgms" }
if (-not $env:PGDATABASE) { $env:PGDATABASE = "apgms" }
if (-not $env:PGPORT)     { $env:PGPORT     = "5432" }
Say ("PG: {0}@{1}:{2}/{3}" -f $env:PGUSER,$env:PGHOST,$env:PGPORT,$env:PGDATABASE) "DarkGray"

###############################################################################
# 1) Health checks
###############################################################################
Say "`n== Health checks ==" "Cyan"

$s1 = Invoke-Http -Method GET -Url ("{0}/health" -f $BaseSvcUrl)
if ($s1.ok) {
  Say ("payments service: {0} {1}" -f $s1.status, $s1.body) "Green"
} else {
  Say ("payments service: {0} {1}" -f $s1.status, $s1.body) "Red"
}

$s2 = Invoke-Http -Method GET -Url ("{0}/health" -f $BaseAppUrl)
if ($s2.ok) {
  Say ("app server:       {0} {1}" -f $s2.status, $s2.body) "Green"
} else {
  Say ("app server:       {0} (no health or down)" -f $s2.status) "Yellow"
}

###############################################################################
# 2) Ensure ACTIVE RPT for release period
###############################################################################
Say ("`n== Ensuring ACTIVE RPT for {0} / {1} / {2} ==" -f $ABN,$TaxType,$PeriodRelease) "Cyan"

$chkActive = Psql-Scalar -Sql @"
SELECT id
FROM rpt_tokens
WHERE abn='$ABN' AND tax_type='$TaxType' AND period_id='$PeriodRelease' AND status IN ('active','pending')
ORDER BY id DESC
LIMIT 1;
"@

if ($chkActive.ok -and $chkActive.value -ne "") {
  Say ("RPT already present (id={0})" -f $chkActive.value) "Green"
} else {
  Say "No active/pending RPT found for release period — copying latest ACTIVE…" "Yellow"
  $copySql = @"
INSERT INTO rpt_tokens
  (abn, tax_type, period_id, payload, signature, rates_version, status, created_at,
   payload_c14n, payload_sha256, nonce, expires_at)
SELECT
  abn, tax_type, '$PeriodRelease', payload, signature, rates_version, 'active', now(),
  payload_c14n, payload_sha256, nonce || '-doctor', now() + interval '7 days'
FROM rpt_tokens
WHERE abn='$ABN' AND tax_type='$TaxType' AND status='active'
ORDER BY id DESC
LIMIT 1;
"@
  $ins = Psql -Sql $copySql
  if ($ins.ok) {
    Say "Inserted new ACTIVE RPT for target period." "Green"
  } else {
    Say "Failed to insert ACTIVE RPT for target period:" "Red"
    Say $ins.text "Red"
  }
}

###############################################################################
# 3) E2E via your APP
###############################################################################
Say "`n== Running E2E via your APP ==" "Cyan"

# Balance (before)
$balBeforeUrl = ("{0}/api/balance?abn={1}&taxType={2}&periodId={3}" -f $BaseAppUrl,$ABN,$TaxType,$PeriodDeposit)
$balBefore = Invoke-Http -Method GET -Url $balBeforeUrl
if ($balBefore.ok) {
  Say ("balance BEFORE deposit ({0}): {1} {2}" -f $PeriodDeposit, $balBefore.status, $balBefore.body) "Green"
} else {
  Say ("balance BEFORE deposit ({0}): {1} {2}" -f $PeriodDeposit, $balBefore.status, $balBefore.body) "Yellow"
}

# Deposit
$depBody = @{ abn=$ABN; taxType=$TaxType; periodId=$PeriodDeposit; amountCents=$AmountDeposit }
$dep = Invoke-Http -Method POST -Url ("{0}/api/deposit" -f $BaseAppUrl) -Body $depBody
if ($dep.ok) {
  Say ("deposit: {0} {1}" -f $dep.status, $dep.body) "Green"
} else {
  Say ("deposit: {0} {1}" -f $dep.status, $dep.body) "Red"
}

# Balance (after deposit)
$balAfterDep = Invoke-Http -Method GET -Url $balBeforeUrl
if ($balAfterDep.ok) {
  Say ("balance AFTER deposit ({0}): {1} {2}" -f $PeriodDeposit, $balAfterDep.status, $balAfterDep.body) "Green"
} else {
  Say ("balance AFTER deposit ({0}): {1} {2}" -f $PeriodDeposit, $balAfterDep.status, $balAfterDep.body) "Yellow"
}

# Release
$relBody = @{ abn=$ABN; taxType=$TaxType; periodId=$PeriodRelease; amountCents=$AmountRelease }
$rel = Invoke-Http -Method POST -Url ("{0}/api/release" -f $BaseAppUrl) -Body $relBody
if ($rel.ok) {
  Say ("release: {0} {1}" -f $rel.status, $rel.body) "Green"
} else {
  Say ("release: {0} {1}" -f $rel.status, $rel.body) "Red"
}

# Balance (after release)
$balAfterRelUrl = ("{0}/api/balance?abn={1}&taxType={2}&periodId={3}" -f $BaseAppUrl,$ABN,$TaxType,$PeriodRelease)
$balAfterRel = Invoke-Http -Method GET -Url $balAfterRelUrl
if ($balAfterRel.ok) {
  Say ("balance AFTER release ({0}): {1} {2}" -f $PeriodRelease, $balAfterRel.status, $balAfterRel.body) "Green"
} else {
  Say ("balance AFTER release ({0}): {1} {2}" -f $PeriodRelease, $balAfterRel.status, $balAfterRel.body) "Yellow"
}

# Ledger (release period)
$ledgerRelUrl = ("{0}/api/ledger?abn={1}&taxType={2}&periodId={3}" -f $BaseAppUrl,$ABN,$TaxType,$PeriodRelease)
$ledgerRel = Invoke-Http -Method GET -Url $ledgerRelUrl
if ($ledgerRel.ok) {
  Say ("ledger ({0}): {1} {2}" -f $PeriodRelease, $ledgerRel.status, $ledgerRel.body) "Green"
} else {
  Say ("ledger ({0}): {1} {2}" -f $PeriodRelease, $ledgerRel.status, $ledgerRel.body) "Yellow"
}

###############################################################################
# 4) Cleanup (optional)
###############################################################################
if ($Cleanup.IsPresent) {
  Say "`n== Cleanup (rows created during this run) ==" "Cyan"
  $tsIso = $Script:StartTime.ToString("yyyy-MM-dd HH:mm:ssK")

  $delSql = @"
DELETE FROM owa_ledger
WHERE abn='$ABN' AND tax_type='$TaxType'
  AND period_id IN ('$PeriodDeposit', '$PeriodRelease')
  AND created_at >= '$tsIso'::timestamptz;
"@
  $del = Psql -Sql $delSql
  if ($del.ok) {
    Say ("Cleanup: removed rows created since {0} for periods {1}, {2}." -f $tsIso,$PeriodDeposit,$PeriodRelease) "Green"
  } else {
    Say "Cleanup failed:" "Red"
    Say $del.text "Red"
  }
} else {
  Say "`n(No cleanup requested; pass -Cleanup to remove rows created during this run.)" "DarkGray"
}

###############################################################################
# 5) Report
###############################################################################
$md = @()
$md += "# Payments Doctor Report"
$md += ""
$md += "* Date: $([DateTime]::Now.ToString('u'))"
$md += "* App: $BaseAppUrl"
$md += "* Service: $BaseSvcUrl"
$md += "* ABN/Tax/Periods: $ABN / $TaxType / Deposit=$PeriodDeposit / Release=$PeriodRelease"
$md += "* Amounts: Deposit=$AmountDeposit, Release=$AmountRelease"
$md += ""
$md += "## Console Log"
$md += "```"
$md += ($Script:LogLines -join "`n")
$md += "```"
$md += ""

[IO.File]::WriteAllLines($Script:ReportPath, $md, [Text.UTF8Encoding]::new($false))
Say ("`nReport written to {0}" -f $Script:ReportPath) "Cyan"
