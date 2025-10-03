<#  tools\phase5_publish.ps1

Publishes a JSON message to NATS from a throwaway container and tails logs.
Requires docker + docker compose and your stack running (the script will start them if needed).

Params:
  -Subject:   NATS subject to publish to
  -Json:      JSON payload (single-line string)
  -TailSec:   Seconds of logs to follow after publish
#>

param(
  [string]$Subject   = 'apgms.tx.calculate',
  [string]$Json      = '{"ping":"ok","amount":123.45}',
  [int]   $TailSec   = 25,
  [int]   $ProbeWait = 15
)

# ---------- helpers ----------
function Info([string]$m){ Write-Host "[ INFO ] $m" -ForegroundColor Cyan }
function Ok  ([string]$m){ Write-Host "[  OK  ] $m" -ForegroundColor Green }
function Warn([string]$m){ Write-Host "[ WARN ] $m" -ForegroundColor Yellow }
function Err ([string]$m){ Write-Host "[ ERR  ] $m" -ForegroundColor Red }

function Probe-HttpOk {
  param([string]$Name,[string]$Url,[int]$TimeoutSec=15)
  Info ("Probing {0} at {1}" -f $Name,$Url)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3 -Method Get
      if ($r.StatusCode -eq 200) { Ok ("{0} healthy (200)" -f $Name); return $true }
    } catch { Start-Sleep -Milliseconds 400 }
  }
  Warn ("{0} did not return 200 within {1} s" -f $Name,$TimeoutSec); return $false
}

# ---------- main ----------
$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $RepoRoot
Info ("Repo root: {0}" -f $RepoRoot)

# Ensure services
Info "Ensuring NATS / normalizer / tax-engine are up..."
& docker compose up -d nats normalizer tax-engine | Out-Null

# Probe basic health (best-effort)
$okNats = Probe-HttpOk -Name 'NATS (monitoring)' -Url 'http://127.0.0.1:8222/healthz' -TimeoutSec $ProbeWait
$okNorm = Probe-HttpOk -Name 'normalizer'        -Url 'http://127.0.0.1:8001/healthz' -TimeoutSec $ProbeWait
$okTax  = Probe-HttpOk -Name 'tax-engine'        -Url 'http://127.0.0.1:8002/healthz' -TimeoutSec $ProbeWait
if (-not ($okNats -and $okNorm -and $okTax)) {
  Warn "Some checks failed, but attempting publish anyway so you can inspect logs."
}

# Docker network of the stack
$cidNats = (& docker compose ps -q nats).Trim()
if (-not $cidNats) { throw "Could not find NATS container id." }
$net = ((docker inspect $cidNats | ConvertFrom-Json)[0].NetworkSettings.Networks.PSObject.Properties.Name |
        Select-Object -First 1)
if (-not $net) { throw "Could not determine docker network for the stack." }
Ok ("Using Docker network: {0}" -f $net)

# Temp payload file (mounted read-only into container)
$tmpJson = New-TemporaryFile
$Json | Set-Content -Path $tmpJson -Encoding UTF8 -NoNewline
Ok ("Temp payload: {0}" -f $tmpJson)

try {
  # Compose the shell command executed *inside* nats-box.
  # We avoid backticks/$() and just pipe file -> nats --stdin.
  $inner = "/bin/cat /tmp/payload.json | /usr/local/bin/nats --server nats://nats:4222 pub '{0}' --stdin" -f $Subject
  Info ("Publishing to NATS subject: {0}" -f $Subject)

  $args = @(
    'run','--rm',
    '--network', $net,
    '--entrypoint','/bin/sh',
    '-v', ("{0}:/tmp/payload.json:ro" -f $tmpJson.FullName),
    'synadia/nats-box:latest',
    '-lc', $inner
  )

  $p = Start-Process -FilePath 'docker' -ArgumentList $args -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    throw ("nats publish failed with exit code {0}. Check subject or NATS reachability." -f $p.ExitCode)
  }
  Ok "Publish completed."

  # Tail logs so you can see message flow (adjust seconds via -TailSec)
  Info ("Tailing logs for {0}s (normalizer & tax-engine)..." -f $TailSec)
  & docker compose logs --since ("{0}s" -f $TailSec) normalizer tax-engine
}
finally {
  if (Test-Path $tmpJson) { Remove-Item $tmpJson -Force -ErrorAction SilentlyContinue }
}
