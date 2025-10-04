# Fix-Stack-And-Smoke_v3.ps1
[CmdletBinding()]
param(
  [string]$RepoRoot = (Get-Location).Path,
  [int]$ReadyTimeoutSec = 120
)

$ErrorActionPreference = "Stop"
function OK($m){ Write-Host "OK: $m" -ForegroundColor Green }
function INFO($m){ Write-Host "INFO: $m" -ForegroundColor Gray }
function WARN($m){ Write-Host "WARN: $m" -ForegroundColor Yellow }
function ERR($m){ Write-Host "ERR: $m" -ForegroundColor Red }

function Replace-InFile([string]$Path,[string]$Pattern,[string]$Replacement){
  if(!(Test-Path $Path)){ throw "File not found: $Path" }
  $txt = Get-Content -LiteralPath $Path -Raw
  $new = [regex]::Replace($txt, $Pattern, $Replacement, 'Singleline')
  if($new -ne $txt){
    Set-Content -LiteralPath $Path -Value $new -Encoding UTF8
    OK "Patched $Path"
  } else {
    INFO "No change needed: $Path"
  }
}

function Wait-Healthy([string]$Name,[string]$Url,[int]$TimeoutSec){
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    try {
      $resp = curl.exe -s -S $Url
      if($LASTEXITCODE -eq 0){ OK "$Name ready ($Url)"; return $true }
    } catch {}
    Start-Sleep -Seconds 3
  } while ((Get-Date) -lt $deadline)
  ERR "$Name NOT ready within $TimeoutSec s ($Url)"
  return $false
}

Write-Host "==== Step 1: Disable uvicorn reload in normalizer ===="
$runNorm = Join-Path $RepoRoot "apps/services/event-normalizer/run_normalizer.py"
if(!(Test-Path $runNorm)){ throw "Missing $runNorm" }
# Common patterns: RELOAD=True / RELOAD = True / uvicorn.run(..., reload=True/RELOAD)
Replace-InFile $runNorm '\bRELOAD\s*=\s*True' 'RELOAD = False'
Replace-InFile $runNorm 'reload\s*=\s*True' 'reload=False'

Write-Host "`n==== Step 2: Ensure jinja2 install is cache-safe in tax-engine Dockerfile ===="
$taxRoot = Join-Path $RepoRoot "apps/services/tax-engine"
$taxDockerfile = Join-Path $taxRoot "Dockerfile"
if(!(Test-Path $taxDockerfile)){ throw "Missing $taxDockerfile" }

# Make sure requirements are copied & installed BEFORE copying the rest of the app.
# This busts cache correctly when requirements.txt changes.
$df = Get-Content -LiteralPath $taxDockerfile -Raw

# Insert a COPY requirements.txt + pip install block if not present already
if($df -notmatch '(?m)^\s*COPY\s+requirements\.txt\s+/app/requirements\.txt'){
  $df = $df -replace '(?ms)WORKDIR\s+/app\s*\r?\n',
        "WORKDIR /app`r`nCOPY requirements.txt /app/requirements.txt`r`nRUN python -m pip install --upgrade pip setuptools wheel && pip install -r /app/requirements.txt`r`n"
  Set-Content -LiteralPath $taxDockerfile -Value $df -Encoding UTF8
  OK "Amended Dockerfile to install requirements before copying app"
} else {
  INFO "Dockerfile already copies requirements.txt early"
}

# Ensure requirements.txt exists and includes jinja2
$taxReq = Join-Path $taxRoot "requirements.txt"
if(!(Test-Path $taxReq)){
  @"
fastapi
uvicorn[standard]
pydantic
jinja2
prometheus-client
httpx
orjson
"@ | Set-Content -LiteralPath $taxReq -Encoding UTF8
  OK "Created requirements.txt with jinja2"
} else {
  $req = Get-Content -LiteralPath $taxReq -Raw
  if($req -notmatch '(?mi)^\s*jinja2\s*$'){
    Add-Content -LiteralPath $taxReq -Value "`njinja2"
    OK "Appended jinja2 to requirements.txt"
  } else { INFO "requirements.txt already has jinja2" }
}

Write-Host "`n==== Step 3: Clean rebuild & up ===="
Push-Location $RepoRoot
try {
  docker compose build --no-cache normalizer tax-engine | Out-Null
  docker compose up -d normalizer tax-engine nats grafana postgres | Out-Null
  OK "Compose up"
} finally { Pop-Location }

Write-Host "`n==== Step 4: Wait for readiness ===="
$okNats = Wait-Healthy "NATS" "http://127.0.0.1:8222/healthz" 60
$okNorm = Wait-Healthy "Normalizer" "http://127.0.0.1:8001/readyz" $ReadyTimeoutSec
if(-not $okNorm){
  Write-Host "`n--- normalizer recent logs ---" -ForegroundColor Yellow
  docker compose logs --no-color normalizer --tail 200
}
$okTax  = Wait-Healthy "Tax-engine" "http://127.0.0.1:8002/readyz" $ReadyTimeoutSec
if(-not $okTax){
  Write-Host "`n--- tax-engine recent logs ---" -ForegroundColor Yellow
  docker compose logs --no-color tax-engine --tail 200
}

Write-Host "`n==== Step 5: NATS smoke (skipped if services not ready) ===="
if($okNorm -and $okTax){
  $net = "apgms-final_default"
  $img = "natsio/nats-box:latest"
  docker pull $img | Out-Null

  $cmd1 = "nats pub apgms.tax.v1 '{""calc"":""ok"",""amount"":123.45}' -s nats://nats:4222"
  docker run --rm --network $net $img sh -lc "$cmd1"

  $payload = '{ "id":"paygw-demo","entity":"AUS-PTY","period":"2025-09","lines":[], "payg_w":{"method":"formula_progressive","period":"weekly","gross":2000} }'
  $cmd2 = "nats pub apgms.normalized.v1 '$payload' -s nats://nats:4222"
  docker run --rm --network $net $img sh -lc "$cmd2"
} else {
  WARN "Skipping smoke tests because a service is not ready."
}

Write-Host "`n==== Step 6: Metrics (best effort) ===="
try {
  $m1 = curl.exe -s http://127.0.0.1:8001/metrics
  if($LASTEXITCODE -eq 0){ OK "Normalizer metrics reachable" } else { ERR "Normalizer metrics unavailable" }
} catch {}
try {
  $m2 = curl.exe -s http://127.0.0.1:8002/metrics
  if($LASTEXITCODE -eq 0){ OK "Tax-engine metrics reachable" } else { WARN "Tax-engine metrics unavailable" }
} catch {}

Write-Host "`n==== Summary ===="
Write-Host "NATS: $okNats; Normalizer: $okNorm; Tax-engine: $okTax"
OK "Done."
