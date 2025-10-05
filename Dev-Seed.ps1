[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host 'npm ci --ignore-scripts' -ForegroundColor Cyan
npm ci --ignore-scripts

Write-Host 'node scripts/seed_rpt_local.mjs' -ForegroundColor Cyan
node scripts/seed_rpt_local.mjs
