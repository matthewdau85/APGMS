<# ===========================
  Phase 6 setup: Prometheus + Grafana
  - Writes:
      ops/prometheus/prometheus.yml
      ops/grafana/provisioning/datasources/prometheus.yaml
      ops/grafana/provisioning/dashboards/dashboard.yaml
      ops/grafana/dashboards/apgms-overview.json
      docker-compose.metrics.yml
  - Starts/ensures services and probes them.
=========================== #>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Info($m){ Write-Host "[ INFO ] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[  OK  ] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[ WARN ] $m" -ForegroundColor Yellow }
function Err($m){ Write-Host "[ ERR  ] $m" -ForegroundColor Red }

# --- Resolve repo root (parent of /tools) robustly ---
$ScriptPath = $MyInvocation.MyCommand.Path
if (-not $ScriptPath) {
  # Fallback if run dot-sourced in the console
  $ScriptPath = Join-Path (Get-Location) "tools\phase6_setup.ps1"
}
$ScriptDir = Split-Path -Parent $ScriptPath
$RepoRoot  = Split-Path -Parent $ScriptDir

Info "Repo root: $RepoRoot"

# --- Ensure folders exist ---
$PromDir = Join-Path $RepoRoot "ops\prometheus"
$GProvDS = Join-Path $RepoRoot "ops\grafana\provisioning\datasources"
$GProvDB = Join-Path $RepoRoot "ops\grafana\provisioning\dashboards"
$GDash   = Join-Path $RepoRoot "ops\grafana\dashboards"
$null = New-Item -ItemType Directory -Force -Path $PromDir, $GProvDS, $GProvDB, $GDash | Out-Null

# --- Prometheus config ---
$promPath = Join-Path $PromDir "prometheus.yml"
$promYml = @"
global:
  scrape_interval: 5s
  evaluation_interval: 5s

scrape_configs:
  - job_name: "normalizer"
    metrics_path: /metrics
    static_configs:
      - targets: ["normalizer:8001"]

  - job_name: "tax_engine"
    metrics_path: /metrics
    static_configs:
      - targets: ["tax-engine:8002"]

  - job_name: "nats_exporter"
    metrics_path: /metrics
    static_configs:
      - targets: ["nats-exporter:7777"]
"@
$promYml | Set-Content -Path $promPath -Encoding UTF8
Ok "Wrote $promPath"

# --- Grafana datasource provisioning ---
$dsPath = Join-Path $GProvDS "prometheus.yaml"
$dsYml = @"
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    isDefault: true
    url: http://prometheus:9090
    jsonData: {}
"@
$dsYml | Set-Content -Path $dsPath -Encoding UTF8
Ok "Wrote $dsPath"

# --- Grafana dashboards provisioning (provider) ---
$provDashPath = Join-Path $GProvDB "dashboard.yaml"
$provDashYml = @"
apiVersion: 1
providers:
  - name: 'apgms-dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
"@
$provDashYml | Set-Content -Path $provDashPath -Encoding UTF8
Ok "Wrote $provDashPath"

# --- A simple Grafana dashboard (JSON) ---
$dashPath = Join-Path $GDash "apgms-overview.json"
$dashJson = @"
{
  "annotations": { "list": [] },
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 0,
  "panels": [
    {
      "type": "stat",
      "title": "Normalizer /metrics scrape OK",
      "id": 1,
      "datasource": { "type": "prometheus", "uid": "Prometheus" },
      "targets": [
        { "expr": "up{job=\"normalizer\"}", "refId": "A" }
      ],
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "values": false, "fields": "" },
        "orientation": "auto",
        "colorMode": "value"
      },
      "gridPos": { "h": 6, "w": 8, "x": 0, "y": 0 }
    },
    {
      "type": "stat",
      "title": "Tax Engine /metrics scrape OK",
      "id": 2,
      "datasource": { "type": "prometheus", "uid": "Prometheus" },
      "targets": [
        { "expr": "up{job=\"tax_engine\"}", "refId": "A" }
      ],
      "options": {
        "reduceOptions": { "calcs": ["lastNotNull"], "values": false, "fields": "" },
        "orientation": "auto",
        "colorMode": "value"
      },
      "gridPos": { "h": 6, "w": 8, "x": 8, "y": 0 }
    },
    {
      "type": "graph",
      "title": "NATS Connections",
      "id": 3,
      "datasource": { "type": "prometheus", "uid": "Prometheus" },
      "targets": [
        { "expr": "nats_varz_connections", "refId": "A" }
      ],
      "gridPos": { "h": 8, "w": 24, "x": 0, "y": 6 }
    }
  ],
  "schemaVersion": 39,
  "style": "dark",
  "tags": ["apgms"],
  "templating": { "list": [] },
  "time": { "from": "now-15m", "to": "now" },
  "timezone": "",
  "title": "APGMS Overview",
  "version": 1
}
"@
$dashJson | Set-Content -Path $dashPath -Encoding UTF8
Ok "Wrote $dashPath"

# --- docker-compose.metrics.yml (overlay that merges with base) ---
$metricsComposePath = Join-Path $RepoRoot "docker-compose.metrics.yml"
$metricsComposeYml = @"
services:
  prometheus:
    image: prom/prometheus:latest
    command: ["--config.file=/etc/prometheus/prometheus.yml","--storage.tsdb.retention.time=2d"]
    ports:
      - "9090:9090"
    volumes:
      - "./ops/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro"
    depends_on:
      - normalizer
      - tax-engine
      - nats-exporter

  # Exporter that scrapes NATS server monitoring endpoints and exposes Prom metrics
  nats-exporter:
    image: natsio/prometheus-nats-exporter:latest
    command:
      - "-varz=http://nats:8222"
      - "-connz=http://nats:8222"
      - "-routez=http://nats:8222"
      - "-serverz=http://nats:8222"
      - "-subz=http://nats:8222"
      - "-gatewayz=http://nats:8222"
      - "-jsz=http://nats:8222"
    ports:
      - "7777:7777"
    healthcheck:
      test: ["CMD-SHELL","wget -qO- http://127.0.0.1:7777/metrics >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 20
    depends_on:
      nats:
        condition: service_healthy

  # Extend grafana service from base compose with provisioning mounts
  grafana:
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=admin
    volumes:
      - "./ops/grafana/provisioning/datasources:/etc/grafana/provisioning/datasources:ro"
      - "./ops/grafana/provisioning/dashboards:/etc/grafana/provisioning/dashboards:ro"
      - "./ops/grafana/dashboards:/var/lib/grafana/dashboards:ro"
"@
$metricsComposeYml | Set-Content -Path $metricsComposePath -Encoding UTF8
Ok "Wrote $metricsComposePath"

# --- Start/ensure services ---
Push-Location $RepoRoot
try {
  Info "Starting base services (nats, normalizer, tax-engine, grafana)..."
  docker compose up -d nats normalizer tax-engine grafana | Out-Host

  Info "Starting metrics overlay (prometheus, nats-exporter)..."
  docker compose -f docker-compose.yml -f docker-compose.override.yml -f docker-compose.metrics.yml `
    up -d prometheus nats-exporter | Out-Host
}
finally { Pop-Location }

# --- Quick health probes ---
function Probe($name, $url, $timeoutSec=10) {
  Info "Probing $name at $url"
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeoutSec
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
      Ok "$name reachable ($($r.StatusCode))"
      return $true
    } else {
      Warn "$name returned HTTP $($r.StatusCode)"
      return $false
    }
  } catch {
    Warn "$name probe failed: $($_.Exception.Message)"
    return $false
  }
}

$okProm = Probe "Prometheus" "http://127.0.0.1:9090/targets"
$okGraf = Probe "Grafana login" "http://127.0.0.1:3000/login"

Write-Host ""
Info "Open these in your browser:"
Write-Host "  • Prometheus targets: http://localhost:9090/targets" -ForegroundColor Gray
Write-Host "  • Grafana:            http://localhost:3000/  (admin / admin)" -ForegroundColor Gray
Write-Host "  • Dashboard name:     APGMS Overview" -ForegroundColor Gray

if ($okProm -and $okGraf) {
  Ok "Phase 6 setup complete."
} else {
  Warn "Phase 6 setup finished with warnings. Check 'docker compose ps' and 'docker compose logs -f' if needed."
}
