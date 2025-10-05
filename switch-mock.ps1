$root = Split-Path -Parent $MyInvocation.MyCommand.Definition
$tsxCmd = Join-Path $root "node_modules/.bin/tsx.cmd"
if (-not (Test-Path $tsxCmd)) {
  $tsxCmd = Join-Path $root "node_modules/.bin/tsx"
}
& $tsxCmd tools/switch-mode.ts mock
