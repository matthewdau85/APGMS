<# ======================================================================
  scripts/run_all_tests.ps1  —  End-to-end Tests (PowerShell 5 compatible)

  Covers:
    • Payments service health (3001 by default)
    • App server health (3000 by default)
    • DB schema sanity checks (tables, key indexes/constraints)
    • Ensure ACTIVE RPT for release period (copy latest ACTIVE if missing)
    • Positive Deposit (+)
    • Release (−) exactly once per period
    • Negative tests:
        - Duplicate release on same period
        - Release on a period with no ACTIVE RPT
    • Read endpoints: balance + ledger (app and service)
    • Optional cleanup of rows created during this run
    • Writes scripts\run_all_tests_report.md

  Usage:
    cd C:\Users\matth\OneDrive\Desktop\apgms-final
    .\scripts\run_all_tests.ps1

    # with options
    .\scripts\run_all_tests.ps1 `
      -BaseAppUrl http://localhost:3000 `
      -BaseSvcUrl http://localhost:3001 `
      -ABN 12345678901 -TaxType GST `
      -DepositPeriod 2025Q4 -ReleasePeriod 2025Q5 `
      -AmountDeposit 2500 -AmountRelease -1500 `
      -NoRptPeriod 2025Q6 `
      -Cleanup
====================================================================== #>

[CmdletBinding()]
param(
  [string]$BaseAppUrl     = "http://localhost:3000",
  [string]$BaseSvcUrl     = "http://localhost:3001",

  [string]$ABN            = "12345678901",
  [string]$TaxType        = "GST",

  [string]$DepositPeriod  = "2025Q4",
  [int]   $AmountDeposit  = 2500,     # positive

  [string]$ReleasePeriod  = "2025Q5",
  [int]   $AmountRelease  = -1500,    # negative

  [string]$NoRptPeriod    = "2025Q6", # used to prove "No active RPT" negative path

  [switch]$Cleanup
)

# -----------------------------------------------------------------------------
# Globals
# -----------------------------------------------------------------------------
$Script:RepoRoot   = Split-Path -Parent $PSScriptRoot
$Script:StartTime  = Get-Date
$Script:ReportPath = Join-Path $PSScriptRoot "run_all_tests_report.md"
$Script:LogLines   = New-Object System.Collections.Generic.List[string]

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
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
    $line = ($line -replace '^\s*export\s+', '')
    $kv   = $line -split '=', 2
    if ($kv.Count -ne 2) { continue }

    $k = $kv[0].Trim()
    $v = $kv[1].Trim()
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

function Json-Pretty {
  param([string]$Text)
  try {
    $o = $Text | ConvertFrom-Json -Depth 8
    return ($o | ConvertTo-Json -Depth 8)
  } catch {
    return $Text
  }
}

# -----------------------------------------------------------------------------
# 0) Load ENV + DB defaults
# -----------------------------------------------------------------------------
Say "== Loading .env.local (repo root) if present ==" "Cyan"
Load-EnvIfNeeded ".env.local"

if (-not $env:PGHOST)     { $env:PGHOST     = "127.0.0.1" }
if (-not $env:PGUSER)     { $env:PGUSER     = "apgms" }
if (-not $env:PGDATABASE) { $env:PGDATABASE = "apgms" }
if (-not $env:PGPORT)     { $env:PGPORT     = "5432" }
Say ("PG: {0}@{1}:{2}/{3}" -f $env:PGUSER,$env:PGHOST,$env:PGPORT,$env:PGDATABASE) "DarkGray"

# -----------------------------------------------------------------------------
# 1) Health checks (service + app)
# -----------------------------------------------------------------------------
Say "`n== Health checks ==" "Cyan"
$s_svc = Invoke-Http -Method GET -Url ("{0}/health" -f $BaseSvcUrl)
if ($s_svc.ok) { Say ("payments service: {0} {1}" -f $s_svc.status,(Json-Pretty $s_svc.body)) "Green" }
else           { Say ("payments service: {0} {1}" -f $s_svc.status,$s_svc.body) "Red" }

$s_app = Invoke-Http -Method GET -Url ("{0}/health" -f $BaseAppUrl)
if ($s_app.ok) { Say ("app server:       {0} {1}" -f $s_app.status,(Json-Pretty $s_app.body)) "Green" }
else           { Say ("app server:       {0} {1}" -f $s_app.status,$s_app.body) "Yellow" }

# -----------------------------------------------------------------------------
# 2) DB schema sanity
# -----------------------------------------------------------------------------
Say "`n== DB schema sanity checks ==" "Cyan"

$tbls = Psql-Scalar -Sql "SELECT string_agg(relname, ',') FROM pg_class WHERE relkind='r' AND relname IN ('rpt_tokens','owa_ledger','evidence_bundles');"
if ($tbls.ok -and $tbls.value) { Say ("tables present: {0}" -f $tbls.value) "Green" } else { Say "tables check failed" "Red" }

$idx_rpt = Psql-Scalar -Sql "SELECT count(*) FROM pg_indexes WHERE tablename='rpt_tokens' AND indexname IN ('ux_rpt_tokens_unique_pending_active','ux_rpt_tokens_nonce','ix_rpt_tokens_lookup','ix_rpt_tokens_expires_at');"
$idx_owa = Psql-Scalar -Sql "SELECT count(*) FROM pg_indexes WHERE tablename='owa_ledger' AND indexname IN ('ux_owa_single_release_per_period','ux_owa_release_uuid','owa_ledger_transfer_uuid_key');"
if ($idx_rpt.ok) { Say ("rpt_tokens indexes found: {0}" -f $idx_rpt.value) "Green" }
if ($idx_owa.ok) { Say ("owa_ledger indexes found: {0}" -f $idx_owa.value) "Green" }

# -----------------------------------------------------------------------------
# 3) Ensure ACTIVE RPT for ReleasePeriod
# -----------------------------------------------------------------------------
Say ("`n== Ensuring ACTIVE RPT for release period {0}/{1}/{2} ==" -f $ABN,$TaxType,$ReleasePeriod) "Cyan"
$haveRpt = Psql-Scalar -Sql @"
SELECT id
FROM rpt_tokens
WHERE abn='$ABN' AND tax_type='$TaxType' AND period_id='$ReleasePeriod' AND status IN ('active','pending')
ORDER BY id DESC LIMIT 1;
"@
if ($haveRpt.ok -and $haveRpt.value -ne "") {
  Say ("RPT exists (id={0})" -f $haveRpt.value) "Green"
} else {
  Say "No ACTIVE/PENDING RPT — copying latest ACTIVE to target period…" "Yellow"
  $ins = Psql -Sql @"
INSERT INTO rpt_tokens
  (abn, tax_type, period_id, payload, signature, rates_version, status, created_at,
   payload_c14n, payload_sha256, nonce, expires_at)
SELECT
  abn, tax_type, '$ReleasePeriod', payload, signature, rates_version, 'active', now(),
  payload_c14n, payload_sha256, nonce || '-e2e', now() + interval '7 days'
FROM rpt_tokens
WHERE abn='$ABN' AND tax_type='$TaxType' AND status='active'
ORDER BY id DESC LIMIT 1;
"@
  if ($ins.ok) { Say "RPT copied." "Green" } else { Say $ins.text "Red" }
}

# -----------------------------------------------------------------------------
# 4) Service-level tests (direct to 3001)
# -----------------------------------------------------------------------------
Say "`n== Payments SERVICE tests (direct) ==" "Cyan"

# balance/ledger (service)
$svcBalUrl = ("{0}/balance?abn={1}&taxType={2}&periodId={3}" -f $BaseSvcUrl,$ABN,$TaxType,$DepositPeriod)
$r = Invoke-Http -Method GET -Url $svcBalUrl
Say ("svc balance({0}): {1} {2}" -f $DepositPeriod,$r.status,(Json-Pretty $r.body)) ($r.ok ? "Green" : "Yellow")

$svcLedUrl = ("{0}/ledger?abn={1}&taxType={2}&periodId={3}" -f $BaseSvcUrl,$ABN,$TaxType,$DepositPeriod)
$r = Invoke-Http -Method GET -Url $svcLedUrl
Say ("svc ledger ({0}): {1} {2}" -f $DepositPeriod,$r.status,(Json-Pretty $r.body)) ($r.ok ? "Green" : "Yellow")

# -----------------------------------------------------------------------------
# 5) App-level tests (through your /api proxy on 3000)
# -----------------------------------------------------------------------------
Say "`n== APP (proxy) tests: deposit (+) ==" "Cyan"
$appBalDepUrl = ("{0}/api/balance?abn={1}&taxType={2}&periodId={3}" -f $BaseAppUrl,$ABN,$TaxType,$DepositPeriod)
$appDepUrl    = ("{0}/api/deposit" -f $BaseAppUrl)

$before = Invoke-Http -Method GET -Url $appBalDepUrl
Say ("balance BEFORE deposit: {0} {1}" -f $before.status,(Json-Pretty $before.body)) ($before.ok ? "Green" : "Yellow")

$depBody = @{ abn=$ABN; taxType=$TaxType; periodId=$DepositPeriod; amountCents=$AmountDeposit }
$dep = Invoke-Http -Method POST -Url $appDepUrl -Body $depBody
Say ("deposit result: {0} {1}" -f $dep.status,(Json-Pretty $dep.body)) ($dep.ok ? "Green" : "Red")

$after = Invoke-Http -Method GET -Url $appBalDepUrl
Say ("balance AFTER  deposit: {0} {1}" -f $after.status,(Json-Pretty $after.body)) ($after.ok ? "Green" : "Yellow")

# -----------------------------------------------------------------------------
# 6) Release tests (once) + duplicate error + no-RPT error
# -----------------------------------------------------------------------------
Say "`n== APP (proxy) tests: release (−) ==" "Cyan"

$appRelUrl = ("{0}/api/release" -f $BaseAppUrl)

# once (should succeed)
$relBody = @{ abn=$ABN; taxType=$TaxType; periodId=$ReleasePeriod; amountCents=$AmountRelease }
$rel1 = Invoke-Http -Method POST -Url $appRelUrl -Body $relBody
Say ("release #1: {0} {1}" -f $rel1.status,(Json-Pretty $rel1.body)) ($rel1.ok ? "Green" : "Red")

# duplicate (should fail with 4xx)
$rel2 = Invoke-Http -Method POST -Url $appRelUrl -Body $relBody
Say ("release #2 (expect 4xx duplicate): {0} {1}" -f $rel2.status,$rel2.body) ((-not $rel2.ok) ? "Green" : "Red")

# no-RPT period (should fail with "No active RPT for period")
$appNoRptUrl = ("{0}/api/release" -f $BaseAppUrl)
$relNoRptBody = @{ abn=$ABN; taxType=$TaxType; periodId=$NoRptPeriod; amountCents=$AmountRelease }
$rel3 = Invoke-Http -Method POST -Url $appNoRptUrl -Body $relNoRptBody
Say ("release (no RPT) expect 4xx: {0} {1}" -f $rel3.status,$rel3.body) ((-not $rel3.ok) ? "Green" : "Red")

# balances + ledger reads (release period)
$appBalRelUrl = ("{0}/api/balance?abn={1}&taxType={2}&periodId={3}" -f $BaseAppUrl,$ABN,$TaxType,$ReleasePeriod)
$balRel = Invoke-Http -Method GET -Url $appBalRelUrl
Say ("balance (release period): {0} {1}" -f $balRel.status,(Json-Pretty $balRel.body)) ($balRel.ok ? "Green" : "Yellow")

$appLedRelUrl = ("{0}/api/ledger?abn={1}&taxType={2}&periodId={3}" -f $BaseAppUrl,$ABN,$TaxType,$ReleasePeriod)
$ledRel = Invoke-Http -Method GET -Url $appLedRelUrl
Say ("ledger  (release period): {0} {1}" -f $ledRel.status,(Json-Pretty $ledRel.body)) ($ledRel.ok ? "Green" : "Yellow")

# -----------------------------------------------------------------------------
# 7) Optional cleanup of rows created in this run
# -----------------------------------------------------------------------------
if ($Cleanup.IsPresent) {
  Say "`n== Cleanup rows created during this run ==" "Cyan"
  $tsIso = $Script:StartTime.ToString("yyyy-MM-dd HH:mm:ssK")
  $delSql = @"
DELETE FROM owa_ledger
WHERE abn='$ABN' AND tax_type='$TaxType'
  AND period_id IN ('$DepositPeriod','$ReleasePeriod','$NoRptPeriod')
  AND created_at >= '$tsIso'::timestamptz;
"@
  $d = Psql -Sql $delSql
  if ($d.ok) { Say "Cleanup OK." "Green" } else { Say $d.text "Red" }
} else {
  Say "`n(No cleanup requested; pass -Cleanup to remove rows inserted during this run.)" "DarkGray"
}

# -----------------------------------------------------------------------------
# 8) Write markdown report
# -----------------------------------------------------------------------------
$md = @()
$md += "# Run-All-Tests Report"
$md += ""
$md += "* Date: $([DateTime]::Now.ToString('u'))"
$md += "* App: $BaseAppUrl"
$md += "* Service: $BaseSvcUrl"
$md += "* ABN/Tax: $ABN / $TaxType"
$md += "* Deposit: $DepositPeriod  (+$AmountDeposit)"
$md += "* Release: $ReleasePeriod  ($AmountRelease)"
$md += "* No-RPT : $NoRptPeriod  (negative test)"
$md += ""
$md += "## Console Output"
$md += "```"
$md += ($Script:LogLines -join "`n")
$md += "```"
$md += ""
[IO.File]::WriteAllLines($Script:ReportPath, $md, [Text.UTF8Encoding]::new($false))
Say ("`nReport written to {0}" -f $Script:ReportPath) "Cyan"
