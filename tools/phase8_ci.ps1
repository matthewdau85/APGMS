<#  Phase 8: CI + repo hygiene bootstrap
    - Creates .github/workflows/ci.yml
    - Adds minimal .dockerignore files
    - Adds tools/dev.ps1 helper
    - Adds optional .githooks/pre-commit and enables core.hooksPath
#>

$ErrorActionPreference = 'Stop'

function Ok($m){ Write-Host "[  OK  ] $m" -ForegroundColor Green }
function Info($m){ Write-Host "[ INFO ] $m" -ForegroundColor Cyan }
function Warn($m){ Write-Host "[ WARN ] $m" -ForegroundColor Yellow }

# Resolve repo root (this script lives in tools/)
$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRoot  = Split-Path -Parent $ScriptDir
Set-Location $RepoRoot
Info "Repo root: $RepoRoot"

# Ensure folders
$wfDir  = Join-Path $RepoRoot ".github/workflows"
$hooks  = Join-Path $RepoRoot ".githooks"
$tools  = Join-Path $RepoRoot "tools"
$appsTE = Join-Path $RepoRoot "apps/services/tax-engine"
$appsEN = Join-Path $RepoRoot "apps/services/event-normalizer"
$ops    = Join-Path $RepoRoot "ops"

$null = New-Item -ItemType Directory -Force -Path $wfDir,$hooks | Out-Null

# ---------- 1) GitHub Actions CI workflow ----------
$ciYml = @"
name: CI

on:
  push:
    branches: [ "**" ]
  pull_request:

jobs:
  build_and_smoke:
    runs-on: ubuntu-latest
    timeout-minutes: 25

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Python 3.11 (for optional repo checks)
        uses: actions/setup-python@v5
        with:
          python-version: "3.11"

      - name: Install curl & docker-compose plugin
        run: |
          sudo apt-get update
          sudo apt-get install -y curl jq
          docker --version
          docker compose version || true

      - name: Build images
        run: |
          docker compose build

      - name: Start core services (nats, normalizer, tax-engine)
        run: |
          docker compose up -d nats normalizer tax-engine

      - name: Wait for health - nats (monitoring)
        run: |
          for i in {1..20}; do
            code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8222/healthz || true)
            if [ "$code" = "200" ]; then echo "NATS OK"; exit 0; fi
            sleep 2
          done
          echo "NATS health not OK"; docker compose logs nats; exit 1

      - name: Wait for health - normalizer
        run: |
          for i in {1..30}; do
            code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8001/healthz || true)
            if [ "$code" = "200" ]; then echo "Normalizer OK"; exit 0; fi
            sleep 2
          done
          echo "Normalizer health not OK"; docker compose logs normalizer; exit 1

      - name: Wait for health - tax-engine
        run: |
          for i in {1..30}; do
            code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8002/healthz || true)
            if [ "$code" = "200" ]; then echo "Tax Engine OK"; exit 0; fi
            sleep 2
          done
          echo "Tax Engine health not OK"; docker compose logs tax-engine; exit 1

      - name: Publish test message to NATS
        run: |
          set -e
          subject="apgms.tx.calculate"
          payload='{"ci":"ok","ts":"'"$(date -u +%FT%TZ)"'"}'
          net=$(docker inspect $(docker compose ps -q nats) | jq -r '.[0].NetworkSettings.Networks | keys[0]')
          echo "$payload" > payload.json
          docker run --rm --network "$net" \
            -v "$PWD/payload.json:/tmp/payload.json:ro" \
            --entrypoint sh synadia/nats-box:latest \
            -lc 'MSG=$(cat /tmp/payload.json); nats --server nats://nats:4222 pub '"$subject"' "$MSG"'
          rm -f payload.json

      - name: Tail service logs briefly
        run: |
          docker compose logs --since=2m normalizer tax-engine || true

      - name: Shutdown
        if: always()
        run: |
          docker compose down -v
"@

$ciPath = Join-Path $wfDir "ci.yml"
$ciYml | Set-Content -NoNewline $ciPath
Ok "Wrote $ciPath"

# ---------- 2) Minimal .dockerignore for services ----------
$commonIgnore = @"
__pycache__/
*.pyc
*.pyo
*.pyd
*.log
*.sqlite
.env
.git
.gitignore
.vscode
.idea
.ops-cache
node_modules/
dist/
build/
"@

foreach($svc in @($appsTE,$appsEN)){
  if (Test-Path $svc) {
    $di = Join-Path $svc ".dockerignore"
    $commonIgnore | Set-Content -NoNewline $di
    Ok "Wrote $di"
  }
}

# Root .dockerignore (optional but helpful)
$rootDI = Join-Path $RepoRoot ".dockerignore"
if (-not (Test-Path $rootDI)) {
  ($commonIgnore + "`nops/`n.githooks/`n.github/`n") | Set-Content -NoNewline $rootDI
  Ok "Wrote $rootDI"
} else {
  Info "Root .dockerignore exists; left unchanged"
}

# ---------- 3) Dev helper (tools/dev.ps1) ----------
$devPs1 = @"
param(
  [ValidateSet('up','down','rebuild','logs','publish')]
  [string]$Cmd = 'up'
)

function Info(\$m){ Write-Host "[ INFO ] \$m" -ForegroundColor Cyan }

switch ($Cmd) {
  'up' {
    Info "Starting nats, normalizer, tax-engine"
    docker compose up -d nats normalizer tax-engine
  }
  'down' {
    Info "Stopping stack"
    docker compose down -v
  }
  'rebuild' {
    Info "Rebuilding images"
    docker compose build --no-cache
    docker compose up -d nats normalizer tax-engine
  }
  'logs' {
    docker compose logs -f nats normalizer tax-engine
  }
  'publish' {
    \$subject = 'apgms.tx.calculate'
    \$tmp = New-TemporaryFile
    '{""dev"":""ok"",""ts"":""' + (Get-Date).ToUniversalTime().ToString("s") + 'Z""}' | Set-Content -NoNewline \$tmp
    \$cid = docker compose ps -q nats
    \$net = (docker inspect \$cid | ConvertFrom-Json)[0].NetworkSettings.Networks.PSObject.Properties.Name | Select-Object -First 1

    docker run --rm --network \$net `
      --entrypoint sh synadia/nats-box:latest `
      -lc "MSG=\$(cat /tmp/payload.json); nats --server nats://nats:4222 pub '\$subject' \"\$MSG\"" `
      -v "\$($tmp.FullName):/tmp/payload.json:ro"

    Remove-Item \$tmp -Force
  }
}
"@
$devPath = Join-Path $tools "dev.ps1"
$devPs1 | Set-Content -NoNewline $devPath
Ok "Wrote $devPath"

# ---------- 4) Optional git hook to block committing secrets ----------
$preCommit = @"
#!/usr/bin/env bash
set -euo pipefail
if git diff --cached --name-only | grep -E '(^|/)\.env($|[^/])' >/dev/null; then
  echo '[pre-commit] Refusing to commit .env files.' >&2
  exit 1
fi
"@
$pcPath = Join-Path $hooks "pre-commit"
$preCommit | Set-Content -NoNewline -Encoding ascii $pcPath
Set-ItemProperty -Path $pcPath -Name IsReadOnly -Value $false -ErrorAction SilentlyContinue | Out-Null
& git config core.hooksPath ".githooks" | Out-Null
Ok "Installed .githooks/pre-commit and set core.hooksPath"

Info "Phase 8 bootstrap complete."
Write-Host "Next: commit & push these files so CI runs." -ForegroundColor Green
