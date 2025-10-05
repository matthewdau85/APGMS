[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host 'python -m pytest tests/golden' -ForegroundColor Cyan
python -m pytest tests/golden

Write-Host 'Opening http://localhost:8080 in your default browser...' -ForegroundColor Green
Start-Process 'http://localhost:8080'
