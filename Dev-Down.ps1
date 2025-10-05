[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

$composeFiles = @(
    'docker-compose.yml',
    'docker-compose.override.yml',
    'docker-compose.dev.yaml',
    'docker-compose.gui.yaml',
    'docker-compose.metrics.yml'
) | Where-Object { Test-Path $_ }

$arguments = @('compose')
foreach ($file in $composeFiles) {
    $arguments += @('-f', $file)
}
$arguments += @('down', '-v')

Write-Host "docker $($arguments -join ' ')" -ForegroundColor Cyan
& docker @arguments
