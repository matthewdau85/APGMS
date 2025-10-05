# phase1_readiness.ps1  (Windows PowerShell 5.1???compatible)

Set-StrictMode -Version 2
$ErrorActionPreference = 'Continue'

function Add-Line([string]$s) {
  $script:lines += $s
}

$lines = @()
$missing = $false
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$report = Join-Path $repoRoot 'phase1_report.txt'

Push-Location $repoRoot
try {
  Add-Line "APGMS Phase 1 - Readiness Report"
  Add-Line ("Generated: {0}" -f (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"))
  Add-Line ("Repo Root: {0}" -f $repoRoot)
  Add-Line ("Shell: {0}" -f $PSVersionTable.PSVersion.ToString())
  Add-Line ""

  # --- Git info (safe on machines without git) ---
  $gitShort = ''
  $gitBranch = ''
  try {
    if (Get-Command git -ErrorAction SilentlyContinue) {
      $gitShort  = (git rev-parse --short HEAD 2>$null).Trim()
      $gitBranch = (git rev-parse --abbrev-ref HEAD 2>$null).Trim()
    }
  } catch {}
  if ([string]::IsNullOrWhiteSpace($gitShort))  { $gitShort = 'unknown' }
  if ([string]::IsNullOrWhiteSpace($gitBranch)) { $gitBranch = 'unknown' }
  Add-Line ("Git HEAD: {0}" -f $gitShort)
  Add-Line ("Git Branch: {0}" -f $gitBranch)
  Add-Line ""

  # --- Files that should exist ---
  $pathsToCheck = @(
    'apps/services/tax-engine/app/__init__.py',
    'apps/services/tax-engine/app/main.py',
    'apps/services/tax-engine/app/tax_rules.py',
    'apps/services/event-normalizer/app/__init__.py',
    'apps/services/event-normalizer/app/main.py',
    'libs/json/payroll_event.v1.json',
    'pytest.ini',
    'docker-compose.yml'
  )
  Add-Line "Required files:"
  foreach ($p in $pathsToCheck) {
    $full = Join-Path $repoRoot $p
    if (Test-Path $full) { Add-Line ("  OK   {0}" -f $p) }
    else                 { Add-Line ("  MISS {0}" -f $p) ; $missing = $true }
  }
  Add-Line ""

  # --- tax_rules.py content checks ---
  $taxRulesPath = Join-Path $repoRoot 'apps/services/tax-engine/app/tax_rules.py'
  if (Test-Path $taxRulesPath) {
    $tr = Get-Content $taxRulesPath -Raw
    $hasGST   = $tr -match 'def\s+gst_line_tax\s*\('
    $hasPAYGW = $tr -match 'def\s+paygw_weekly\s*\('
    Add-Line "tax_rules.py:"
    Add-Line ("  gst_line_tax(): {0}" -f ($(if($hasGST){"FOUND"}else{"MISSING"})))
    Add-Line ("  paygw_weekly(): {0}" -f ($(if($hasPAYGW){"FOUND"}else{"MISSING"})))
    Add-Line ""
  }

  # --- Schema checks ---
  $schemaPath = Join-Path $repoRoot 'libs/json/payroll_event.v1.json'
  if (Test-Path $schemaPath) {
    try {
      $schema = Get-Content $schemaPath -Raw | ConvertFrom-Json
      $required = @($schema.required)
      $hasTFN = $false
      foreach ($r in $required) { if ($r -eq 'employee_tax_file_number') { $hasTFN = $true } }
      Add-Line "Schema: libs/json/payroll_event.v1.json"
      Add-Line ("  'employee_tax_file_number' required: {0}" -f ($(if($hasTFN){"YES"}else{"NO"})))
      Add-Line ("  Required keys: {0}" -f ($required -join ', '))
      Add-Line ""
    } catch {
      Add-Line "Schema: FAILED to parse JSON."
      Add-Line ("Error: {0}" -f $_.Exception.Message)
      Add-Line ""
    }
  }

  # --- pytest run (quiet) ---
  Add-Line "Pytest:"
  $pytestOutput = ''
  $pytestExit = 0
  try {
    $pytestOutput = & pytest -q 2>&1
    $pytestExit = $LASTEXITCODE
  } catch {
    $pytestExit = 999
    $pytestOutput = $_ | Out-String
  }
  Add-Line ("  Exit Code: {0}" -f $pytestExit)
  if ($pytestOutput) {
    $tail = ($pytestOutput -split "`r?`n") | Select-Object -Last 15
    Add-Line "  Last lines:"
    foreach($ln in $tail){ Add-Line ("    {0}" -f $ln) }
  } else {
    Add-Line "  (no output)"
  }
  Add-Line ""

  # --- Docker quick sanity ---
  Add-Line "Docker:"
  $dockerOK = $false
  try {
    $dv = & docker --version 2>$null
    if ($LASTEXITCODE -eq 0) { $dockerOK = $true }
  } catch {}
  Add-Line ("  docker present: {0}" -f ($(if($dockerOK){"YES"}else{"NO"})))

  $composeOK = $false
  if ($dockerOK) {
    try {
      $dcp = & docker compose version 2>$null
      if ($LASTEXITCODE -eq 0) { $composeOK = $true }
    } catch {}
  }
  Add-Line ("  docker compose present: {0}" -f ($(if($composeOK){"YES"}else{"NO"})))
  if ($composeOK) {
    try {
      $psOut = & docker compose ps 2>&1
      Add-Line "  compose ps:"
      foreach($ln in ($psOut -split "`r?`n")) { Add-Line ("    {0}" -f $ln) }
    } catch {
      Add-Line "  compose ps: ERROR"
    }
  }
  Add-Line ""

  # --- Summary heuristic for ???ready??? ---
  $ready = $true
  if ($missing) { $ready = $false }
  if ($pytestExit -ne 0) { $ready = $false }
  Add-Line ("READINESS: {0}" -f ($(if($ready){"PASS"}else{"NEEDS-ATTENTION"})))

} finally {
  Pop-Location
  $lines | Out-File -FilePath $report -Encoding ASCII
  Write-Host ("Wrote report: {0}" -f $report)
}
