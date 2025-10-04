[CmdletBinding()]
param(
  [string]$Subject = 'apgms.tx.calculate',
  [string]$Json    = '{"ping":"ok","amount":123.45"}'
)

$ErrorActionPreference = 'Stop'

function Ok($m){ Write-Host "[  OK  ] $m" -ForegroundColor Green }
function Err($m){ Write-Host "[ ERR  ] $m" -ForegroundColor Red }
function Info($m){ Write-Host "[ INFO ] $m" -ForegroundColor Cyan }

$repo = (Get-Location).Path
Info "Repo root: $repo"

Info "Ensuring NATS / normalizer / tax-engine are up..."
& docker compose up -d nats normalizer tax-engine | Out-Null

# quick probe helpers
function Probe($url){ try { (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 5).StatusCode -eq 200 } catch { $false } }

if (Probe 'http://127.0.0.1:8222/healthz') { Ok "NATS (monitoring) healthy (200)" } else { Err "NATS monitoring not 200" }
if (Probe 'http://127.0.0.1:8001/healthz') { Ok "normalizer healthy (200)" } else { Err "normalizer not 200" }
if (Probe 'http://127.0.0.1:8002/healthz') { Ok "tax-engine healthy (200)" } else { Err "tax-engine not 200" }

# discover network
$cid = docker compose ps -q nats
$net = (docker inspect $cid | ConvertFrom-Json)[0].NetworkSettings.Networks.PSObject.Properties.Name | Select-Object -First 1
Ok "Using Docker network: $net"

# temp payload
$tmp = New-TemporaryFile
$Json | Set-Content -Encoding UTF8 -NoNewline $tmp
Ok "Temp payload: $($tmp.FullName)"

Info "Publishing to NATS subject: $Subject"
$cmd = @(
  'run','--rm','--network', $net,
  '--entrypoint','/bin/sh','synadia/nats-box:latest',
  '-lc', 'MSG=$(cat /tmp/payload.json); /usr/local/bin/nats --server nats://nats:4222 pub "'+$Subject+'" "$MSG"',
  '-v', "$($tmp.FullName):/tmp/payload.json:ro"
)
& docker @cmd
$code = $LASTEXITCODE
Remove-Item $tmp -Force

if ($code -ne 0) {
  Err "nats publish failed with exit code $code. Subject might be wrong or NATS not reachable."
  exit 1
}
Ok "Publish completed."

Info "Tailing logs for 25s (normalizer & tax-engine)..."
& docker compose logs --since=30s -f normalizer tax-engine --timestamps --tail=200 --no-log-prefix | ForEach-Object -Begin { $sw=[Diagnostics.Stopwatch]::StartNew() } -Process {
  $_
  if ($sw.Elapsed.TotalSeconds -ge 25) { $host.UI.RawUI.FlushInputBuffer(); [Environment]::Exit(0) }
}
