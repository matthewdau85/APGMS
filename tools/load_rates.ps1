param(
  [Parameter(Mandatory=$true)][string]$PaygwCsv,
  [Parameter(Mandatory=$true)][string]$GstCsv,
  [Parameter(Mandatory=$true)][string]$VersionName,
  [Parameter(Mandatory=$true)][string]$EffectiveFrom,
  [string]$EffectiveTo,
  [string]$VersionId,
  [string]$PenaltyConfig
)

$python = if ($env:PYTHON) { $env:PYTHON } elseif ($env:PYTHON3) { $env:PYTHON3 } else { "python3" }
$script = Join-Path $PSScriptRoot "load_rates.py"

$arguments = @(
  $script,
  "--paygw-csv", $PaygwCsv,
  "--gst-csv", $GstCsv,
  "--version-name", $VersionName,
  "--effective-from", $EffectiveFrom
)
if ($EffectiveTo) { $arguments += @("--effective-to", $EffectiveTo) }
if ($VersionId) { $arguments += @("--version-id", $VersionId) }
if ($PenaltyConfig) { $arguments += @("--penalty-config", $PenaltyConfig) }

& $python @arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
