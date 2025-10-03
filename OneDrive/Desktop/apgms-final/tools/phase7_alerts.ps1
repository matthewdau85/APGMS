<# ===========================
  Phase 7 setup: Grafana Alerting
=========================== #>

param(
  [string]$SlackWebhookUrl # optional; if not provided we use a local webhook receiver
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Info($m){ Write-Host "[ INFO ] $m" -ForegroundColor Cyan }
function Ok($m){ Write-Host "[  OK  ] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[ WARN ] $m" -ForegroundColor Yellow }
function Err($m){ Write-Host "[ ERR  ] $m" -ForegroundColor Red }

# --- Resolve repo root (parent of /tools) robustly ---
$ScriptPath = $MyInvocation.MyCommand.Path
if (-not $ScriptPath) { $ScriptPath = Join-Path (Get-Location) "tools\phase7_alerts.ps1" }
$ScriptDir = Split-Path -Parent $ScriptPath
$RepoRoot  = Split-Path -Parent $ScriptDir

Info "Repo root: $RepoRoot"

# Paths
$ProvAlertDir   = Join-Path $RepoRoot "ops\grafana\provisioning\alerting"
$RulesDir       = Join-Path $ProvAlertDir "rules"
$MetricsCompose = Join-Path $RepoRoot "docker-compose.metrics.yml"
$AlertsOverride = Join-Path $RepoRoot "docker-compose.alerts.yml"

# Make dirs
$null = New-Item -ItemType Directory -Force -Path $ProvAlertDir, $RulesDir | Out-Null

# Determine contact point
$UsingSlack = -not [string]::IsNullOrWhiteSpace($SlackWebhookUrl)
if ($UsingSlack) {
  Info "Using Slack webhook contact point"
} else {
  Info "No Slack URL provided; using local webhook receiver (http://localhost:18080/alert)"
}

# Contact points provisioning
$ContactPointsPath = Join-Path $ProvAlertDir "contact-points.yaml"
if ($UsingSlack) {
$ContactPoints = @"
apiVersion: 1
contactPoints:
  - orgId: 1
    name: apgms-slack
    receivers:
      - uid: apgms-slack
        type: slack
        settings:
          url: $SlackWebhookUrl
          mentionUsers: ""
          mentionGroups: ""
          recipient: ""
"@
} else {
$ContactPoints = @"
apiVersion: 1
contactPoints:
  - orgId: 1
    name: apgms-webhook
    receivers:
      - uid: apgms-webhook
        type: webhook
        settings:
          url: http://host.docker.internal:18080/alert
          httpMethod: POST
          maxAlerts: 0
"@
}
$ContactPoints | Set-Content -Path $ContactPointsPath -Encoding UTF8
Ok "Wrote $ContactPointsPath"

# Notification policy provisioning (route everything)
$PoliciesPath = Join-Path $ProvAlertDir "notification-policies.yaml"
if ($UsingSlack) {
$Policies = @"
apiVersion: 1
policies:
  - orgId: 1
    receiver: apgms-slack
    group_by: ['alertname']
    routes: []
"@
} else {
$Policies = @"
apiVersion: 1
policies:
  - orgId: 1
    receiver: apgms-webhook
    group_by: ['alertname']
    routes: []
"@
}
$Policies | Set-Content -Path $PoliciesPath -Encoding UTF8
Ok "Wrote $PoliciesPath"

# Alert rules (YAML for Grafana 9+ provisioning)
$RulesPath = Join-Path $RulesDir "apgms-rules.yaml"
$RulesYaml = @"
apiVersion: 1
groups:
  - orgId: 1
    name: apgms-basic
    folder: APGMS
    interval: 30s
    rules:
      - uid: normalizer_down
        title: Normalizer down
        condition: A
        data:
          - refId: A
            queryType: ""
            relativeTimeRange:
              from: 300
              to: 0
            datasourceUid: Prometheus
            model:
              expr: up{job="normalizer"} == 0
              instant: true
              interval: ""
              legendFormat: ""
              refId: A
        noDataState: Alerting
        execErrState: Alerting
        for: 1m
        annotations:
          summary: "Normalizer target is DOWN"
        labels:
          severity: critical

      - uid: tax_engine_down
        title: Tax Engine down
        condition: A
        data:
          - refId: A
            queryType: ""
            relativeTimeRange:
              from: 300
              to: 0
            datasourceUid: Prometheus
            model:
              expr: up{job="tax_engine"} == 0
              instant: true
              interval: ""
              legendFormat: ""
              refId: A
        noDataState: Alerting
        execErrState: Alerting
        for: 1m
        annotations:
          summary: "Tax Engine target is DOWN"
        labels:
          severity: critical

      - uid: nats_exporter_down
        title: NATS exporter down
        condition: A
        data:
          - refId: A
            queryType: ""
            relativeTimeRange:
              from: 300
              to: 0
            datasourceUid: Prometheus
            model:
              expr: up{job="nats_exporter"} == 0
              instant: true
              interval: ""
              legendFormat: ""
              refId: A
        noDataState: Alerting
        execErrState: Alerting
        for: 1m
        annotations:
          summary: "NATS exporter is DOWN"
        labels:
          severity: warning
"@
$RulesYaml | Set-Content -Path $RulesPath -Encoding UTF8
Ok "Wrote $RulesPath"

# Ensure docker-compose.metrics.yml mounts alerting provisioning into grafana
if (-not (Test-Path $MetricsCompose)) {
  Err "Missing $MetricsCompose (run phase6_setup.ps1 first)."
  throw
}

$metricsComposeText = Get-Content -Raw -Path $MetricsCompose
$mountLine = './ops/grafana/provisioning/alerting:/etc/grafana/provisioning/alerting:ro'

if ($metricsComposeText -match [regex]::Escape($mountLine)) {
  Ok "Alerting provisioning mount already present in docker-compose.metrics.yml"
  $mountAdded = $true
} else {
  Info "Adding alerting provisioning mount to grafana in docker-compose.metrics.yml"
  # Initialize flags (IMPORTANT to avoid your error)
  $seenGrafana = $false
  $addedMount  = $false

  $updated = ($metricsComposeText -split "`r?`n") | ForEach-Object {
    $_
    if ($_ -match '^\s*grafana:\s*$') { $seenGrafana = $true }
    if ($seenGrafana -and $_ -match '^\s*volumes:\s*$' -and -not $addedMount) {
      $addedMount = $true
      "      - ""$mountLine"""
    }
  } | Out-String

  if ($addedMount) {
    $updated | Set-Content -Path $MetricsCompose -Encoding UTF8
    Ok "Updated $MetricsCompose with alerting mount under existing volumes"
    $mountAdded = $true
  } else {
    Warn "Could not reliably detect an existing grafana volumes block; using override file instead."
    $mountAdded = $false
  }
}

# Fallback: create an override that layers the mount
if (-not $mountAdded) {
$overrideYml = @"
services:
  grafana:
    volumes:
      - "$mountLine"
"@
  $overrideYml | Set-Content -Path $AlertsOverride -Encoding UTF8
  Ok "Wrote $AlertsOverride (compose override for alerting mount)"
}

# Start webhook receiver if Slack not used
$WebhookName = "apgms-alerts-webhook"
if (-not $UsingSlack) {
  try { docker rm -f $WebhookName | Out-Null } catch { }
  Info "Starting local webhook receiver on http://localhost:18080/alert"
  docker run -d --name $WebhookName -p 18080:8080 mendhak/http-https-echo | Out-Null
  Ok "Webhook receiver running"
}

# Restart grafana to reload provisioning (most reliable)
Push-Location $RepoRoot
try {
  if (Test-Path $AlertsOverride) {
    Info "Restarting Grafana with metrics + alerts override..."
    docker compose -f docker-compose.metrics.yml -f docker-compose.alerts.yml up -d grafana | Out-Host
    docker compose -f docker-compose.metrics.yml -f docker-compose.alerts.yml restart grafana | Out-Host
  } else {
    Info "Restarting Grafana with metrics compose..."
    docker compose -f docker-compose.metrics.yml up -d grafana | Out-Host
    docker compose -f docker-compose.metrics.yml restart grafana | Out-Host
  }
} finally { Pop-Location }

# Quick probes
function Probe($name, $url, $timeoutSec=15) {
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

$okGraf = Probe "Grafana login" "http://127.0.0.1:3000/login"
$okProm = Probe "Prometheus" "http://127.0.0.1:9090/targets"

Write-Host ""
Info "Phase 7 next steps:"
Write-Host "  • Grafana:  http://localhost:3000/  (admin / admin)" -ForegroundColor Gray
Write-Host "  • Alerts:   Alerting → Alert rules → folder 'APGMS' should list 3 rules." -ForegroundColor Gray
if ($UsingSlack) {
  Write-Host "  • Contact:  Slack webhook (${SlackWebhookUrl.Substring(0,[Math]::Min(60,$SlackWebhookUrl.Length))}...)" -ForegroundColor Gray
} else {
  Write-Host "  • Contact:  Webhook http://host.docker.internal:18080/alert (echo server)" -ForegroundColor Gray
  Write-Host "  • View hits: http://localhost:18080/ (body/headers echoed)" -ForegroundColor Gray
}

Write-Host ""
Info "To test: stop a service to trigger an alert, e.g.:"
Write-Host "    docker compose stop tax-engine" -ForegroundColor DarkGray
Write-Host "  Wait ~1 minute; the 'Tax Engine down' alert should fire." -ForegroundColor DarkGray

Ok "Phase 7 alerting setup complete."
