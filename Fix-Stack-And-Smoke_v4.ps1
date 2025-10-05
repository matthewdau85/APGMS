# Fix-Stack-And-Smoke_v4.ps1
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

function Wait-Ready([string]$name,[string]$url,[int]$timeoutSec){
  $deadline=(Get-Date).AddSeconds($timeoutSec)
  do{
    try{
      $r = curl.exe -s -S $url
      if($LASTEXITCODE -eq 0){ OK "$name ready ($url)"; return $true }
    }catch{}
    Start-Sleep 3
  }while((Get-Date) -lt $deadline)
  ERR "$name NOT ready within $timeoutSec s ($url)"; return $false
}

# --- 1) Fix normalizer metrics block (remove broken text, add guarded Counter) ---
Write-Host "==== Step 1: Repair normalizer metrics block ===="
$normMain = Join-Path $RepoRoot "apps/services/event-normalizer/app/main.py"
if(!(Test-Path $normMain)){ throw "Missing $normMain" }
$txt = Get-Content -LiteralPath $normMain -Raw

# Ensure the prometheus import exists
if($txt -notmatch '(?m)^\s*from\s+prometheus_client\s+import\s+Counter'){
  $txt = $txt -replace '(?m)^(import .*\n)+', { param($m) $m.Value + "from prometheus_client import Counter`n" }
}

# Strip any previous/broken NORMALIZER_TAX_RESULTS definitions (including multi-line)
$txt = [regex]::Replace($txt, '^\s*NORMALIZER_TAX_RESULTS\s*=\s*Counter\([^)]*\)\s*', '', 'Singleline, Multiline')
# Also remove any weird escaped leftovers from the bad patch
$txt = $txt -replace '\\\s*#.*', ''  # lines like "\ \ \ \ ... # comment" -> drop escapes

# Insert a clean, idempotent guarded definition just after the Counter import
$guard = @"
# Guarded metric registration (prevents double-register on module reload)
try:
    NORMALIZER_TAX_RESULTS  # type: ignore  # exists already
except NameError:
    NORMALIZER_TAX_RESULTS = Counter("normalizer_tax_results", "Total tax result messages received")
"@
$txt = $txt -replace '(?m)^(.*from\s+prometheus_client\s+import\s+Counter.*\n)', "`$1$guard`n"

Set-Content -LiteralPath $normMain -Value $txt -Encoding UTF8
OK "Patched $normMain"

# --- 2) Ensure tax-engine has NATS client and Jinja2 installed in image ---
Write-Host "`n==== Step 2: Ensure tax-engine requirements (nats-py) ===="
$taxRoot = Join-Path $RepoRoot "apps/services/tax-engine"
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
nats-py
"@ | Set-Content -LiteralPath $taxReq -Encoding UTF8
  OK "Created $taxReq with nats-py"
} else {
  $req = Get-Content -LiteralPath $taxReq -Raw
  $changed = $false
  if($req -notmatch '(?mi)^\s*jinja2\s*$'){ Add-Content -LiteralPath $taxReq -Value "`njinja2"; $changed=$true }
  if($req -notmatch '(?mi)^\s*nats-py\s*$'){ Add-Content -LiteralPath $taxReq -Value "`nnats-py"; $changed=$true }
  if($changed){ OK "Updated $taxReq" } else { INFO "requirements already OK" }
}

# Sanity: tax-engine Dockerfile should install requirements BEFORE copying the app to bust cache properly
$taxDocker = Join-Path $taxRoot "Dockerfile"
if(Test-Path $taxDocker){
  $df = Get-Content -LiteralPath $taxDocker -Raw
  if($df -notmatch '(?m)^\s*COPY\s+requirements\.txt\s+/app/requirements\.txt'){
    $df = $df -replace '(?ms)WORKDIR\s+/app\s*\r?\n',
      "WORKDIR /app`r`nCOPY requirements.txt /app/requirements.txt`r`nRUN python -m pip install --upgrade pip setuptools wheel && pip install -r /app/requirements.txt`r`n"
    Set-Content -LiteralPath $taxDocker -Value $df -Encoding UTF8
    OK "Amended tax-engine Dockerfile to install requirements early"
  } else {
    INFO "tax-engine Dockerfile already installs requirements early"
  }
}

# --- 3) Rebuild & Up (no cache to be sure) ---
Write-Host "`n==== Step 3: Clean rebuild & up ===="
Push-Location $RepoRoot
try{
  docker compose build --no-cache normalizer tax-engine | Out-Null
  docker compose up -d normalizer tax-engine nats grafana postgres | Out-Null
  OK "Compose up"
} finally { Pop-Location }

# --- 4) Wait for readiness + show logs if not ready ---
Write-Host "`n==== Step 4: Wait for readiness ===="
$okNats = Wait-Ready "NATS" "http://127.0.0.1:8222/healthz" 60
$okNorm = Wait-Ready "Normalizer" "http://127.0.0.1:8001/readyz" $ReadyTimeoutSec
if(-not $okNorm){
  Write-Host "`n--- normalizer recent logs ---" -ForegroundColor Yellow
  docker compose logs --no-color normalizer --tail 200
}
$okTax = Wait-Ready "Tax-engine" "http://127.0.0.1:8002/readyz" $ReadyTimeoutSec
if(-not $okTax){
  Write-Host "`n--- tax-engine recent logs ---" -ForegroundColor Yellow
  docker compose logs --no-color tax-engine --tail 200
}

# --- 5) Optional NATS smoke when both are ready ---
Write-Host "`n==== Step 5: NATS smoke (if ready) ===="
if($okNorm -and $okTax){
  $net = "apgms-final_default"
  $img = "natsio/nats-box:latest"
  docker pull $img | Out-Null
  $cmd1 = "nats pub apgms.tax.v1 '{""calc"":""ok"",""amount"":123.45}' -s nats://nats:4222"
  docker run --rm --network $net $img sh -lc "$cmd1"
  $payload = '{ "id":"paygw-demo","entity":"AUS-PTY","period":"2025-09","lines":[], "payg_w":{"method":"formula_progressive","period":"weekly","gross":2000} }'
  $cmd2 = "nats pub apgms.normalized.v1 '$payload' -s nats://nats:4222"
  docker run --rm --network $net $img sh -lc "$cmd2"
}else{
  WARN "Skipping smoke tests (services not ready)."
}

Write-Host "`n==== Summary ===="
Write-Host "NATS: $okNats; Normalizer: $okNorm; Tax-engine: $okTax"
