param(
  [string]$Name,
  [switch]$All
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSCommandPath
$goldenRoot = Join-Path $repoRoot 'goldens'
if (-not (Test-Path $goldenRoot -PathType Container)) {
  throw "Missing goldens directory: $goldenRoot"
}

function Resolve-Python {
  foreach ($cmd in @('python3','python')) {
    try {
      $p = Get-Command $cmd -ErrorAction Stop
      return $p.Source
    } catch {
      continue
    }
  }
  throw "python executable not found"
}

$python = Resolve-Python

if ($All) {
  $targets = Get-ChildItem -Path $goldenRoot -Directory | Sort-Object Name
} elseif ($Name) {
  $dir = Join-Path $goldenRoot $Name
  if (-not (Test-Path $dir -PathType Container)) {
    throw "Golden '$Name' not found under $goldenRoot"
  }
  $targets = ,(Get-Item $dir)
} else {
  throw "Specify --all or --name"
}

$failed = @()
foreach ($t in $targets) {
  $events = Join-Path $t.FullName 'events.json'
  $expected = Join-Path $t.FullName 'expected.json'
  if (-not (Test-Path $events -PathType Leaf)) {
    Write-Error "Missing events.json in $($t.FullName)"
    $failed += $t.Name
    continue
  }
  if (-not (Test-Path $expected -PathType Leaf)) {
    Write-Error "Missing expected.json in $($t.FullName)"
    $failed += $t.Name
    continue
  }

  Write-Host "== Golden: $($t.Name) ==" -ForegroundColor Cyan
  & $python (Join-Path $repoRoot 'tools/golden_eval.py') --events $events --expected $expected | Out-String | Write-Host
  if ($LASTEXITCODE -ne 0) {
    $failed += $t.Name
  } else {
    Write-Host "  ✔ matched" -ForegroundColor Green
  }
}

if ($failed.Count -gt 0) {
  Write-Error ("Golden mismatch: {0}" -f ($failed -join ', '))
  exit 1
}

Write-Host "All golden vectors verified" -ForegroundColor Green
