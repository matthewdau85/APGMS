$ErrorActionPreference = "Stop"
$compose = "docker-compose.yml"
if (!(Test-Path $compose)) { throw "No docker-compose.yml found in $(Get-Location)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $compose "$compose.$ts.bak" -Force
Write-Host "[ OK ] Backed up: $compose -> $compose.$ts.bak"

# Read
$text = Get-Content $compose -Raw -Encoding UTF8

# Find start of '  normalizer:' (service headers are 2-space indented)
$start = [regex]::Match($text,'(?m)^(  )normalizer:\s*$')
if (!$start.Success) { throw "Could not find 'normalizer:' service header." }

# Find the next service header (two spaces + word + colon at BOL) *after* normalizer
$tail    = $text.Substring($start.Index + $start.Length)
$nextHdr = [regex]::Match($tail,'(?m)^(  )[A-Za-z0-9._-]+:\s*$')
$endIdx  = if ($nextHdr.Success) { $start.Index + $start.Length + $nextHdr.Index } else { $text.Length }

# Replace the whole normalizer block with a clean one
$fixed = @"
  normalizer:
    build:
      context: .
      dockerfile: apps/services/event-normalizer/Dockerfile
    environment:
      APP_MODULE: "app.main:app"
      UVICORN_PORT: "8001"
      NATS_URL: nats://nats:4222
      SERVICE_PORT: "8001"
      PYTHONPATH: /app
    ports: ["8001:8001"]
    depends_on:
      nats:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8001/healthz >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 20
    restart: unless-stopped
"@

$new = $text.Substring(0,$start.Index) + $fixed + $text.Substring($endIdx)
$new | Set-Content -Encoding UTF8 $compose
Write-Host "[ OK ] Rewrote 'normalizer' block in docker-compose.yml"
