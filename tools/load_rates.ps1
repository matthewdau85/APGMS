param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$CsvPath,

    [Parameter(Mandatory = $false)]
    [string]$OutputPath,

    [Parameter(Mandatory = $false)]
    [string]$Source
)

$repoRoot = Resolve-Path "$PSScriptRoot/.."
$pythonPath = Join-Path $repoRoot "apps/services/tax-engine"
if (-not $OutputPath -or $OutputPath -eq "") {
    $OutputPath = Join-Path $pythonPath "app/data/rates_versions.json"
}

if (-not (Test-Path $CsvPath)) {
    Write-Error "CSV file not found: $CsvPath"
    exit 1
}

$env:PYTHONPATH = if ($env:PYTHONPATH) { "$pythonPath$([System.IO.Path]::PathSeparator)$env:PYTHONPATH" } else { $pythonPath }

$arguments = @('-m', 'app.rates_loader', $CsvPath, '--output', $OutputPath)
if ($Source) {
    $arguments += @('--source', $Source)
}

Write-Host "Loading rates from $CsvPath to $OutputPath"
& python @arguments
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}
