<# ======================================================================
 Repair-Implement-Run_v2.ps1
 All-in-one, deterministic & idempotent:
   - Fix service apps (future import, /readyz, /metrics)
   - Add PAYG-W engine + rules + mini UI
   - Replace docker-compose.yml with a clean, known-good version (backs up original)
   - Build, run, wait ready, NATS smoke, metrics
 ====================================================================== #>

[CmdletBinding()]
param(
  [string]$RepoRoot = (Get-Location).Path,
  [int]$ReadyTimeoutSec = 120,
  [switch]$SkipBuild = $false
)

$ErrorActionPreference = "Stop"

function OK($m){ Write-Host "OK: $m" -ForegroundColor Green }
function Info($m){ Write-Host "INFO: $m" -ForegroundColor Gray }
function Warn($m){ Write-Host "WARN: $m" -ForegroundColor Yellow }
function Err($m){ Write-Host "ERR: $m" -ForegroundColor Red }

function Ensure-Dir([string]$p){
  if (!(Test-Path $p)) { New-Item -ItemType Directory -Force -Path $p | Out-Null }
}

function Write-IfChanged([string]$Path,[string]$Content){
  $cur = if(Test-Path $Path){ Get-Content -LiteralPath $Path -Raw } else { "" }
  if($cur -ne $Content){
    Ensure-Dir (Split-Path -Parent $Path)
    Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
    OK "Wrote $Path"
  } else {
    Info "Unchanged $Path"
  }
}

function Ensure-FutureImportTop([string]$pyFile){
  if (!(Test-Path $pyFile)) { return }
  $src = Get-Content -LiteralPath $pyFile -Raw
  # strip any existing future line
  $noFuture = [regex]::Replace($src,'(?m)^\s*from\s+__future__\s+import\s+annotations\s*\r?\n','')
  # optional docstring at top (triple double OR triple single)
  $docPattern = '^(?s)\s*(?:(?:"""[\s\S]*?""")|(?:''''' + "''[\s\S]*?''" + "'''))\s*"
  $m = [regex]::Match($noFuture,$docPattern)
  if ($m.Success) {
    $fixed = $m.Value + "from __future__ import annotations`r`n" + $noFuture.Substring($m.Length)
  } else {
    $fixed = "from __future__ import annotations`r`n" + $noFuture
  }
  if ($fixed -ne $src) {
    Set-Content -LiteralPath $pyFile -Value $fixed -Encoding UTF8
    OK "Moved future import to top: $pyFile"
  } else {
    Info "Future import position OK: $pyFile"
  }
}

# --- Paths ---
$NormRoot = Join-Path $RepoRoot "apps/services/event-normalizer"
$NormApp  = Join-Path $NormRoot "app"
$NormMain = Join-Path $NormApp  "main.py"

$TaxRoot  = Join-Path $RepoRoot "apps/services/tax-engine"
$TaxApp   = Join-Path $TaxRoot "app"
$TaxMain  = Join-Path $TaxApp  "main.py"
$TaxDockerfile = Join-Path $TaxRoot "Dockerfile"

$TaxDomains = Join-Path $TaxApp "domains"
$TaxRules   = Join-Path $TaxApp "rules"
$TaxTemplates = Join-Path $TaxApp "templates"
$TaxStatic    = Join-Path $TaxApp "static"

# --- 0. Prereqs ---
Write-Host "==== Phase 0: Prerequisites ====" -ForegroundColor Cyan
foreach($cmd in @("docker","curl.exe")){
  if (!(Get-Command $cmd -ErrorAction SilentlyContinue)){ throw "Missing $cmd" }
}
OK "Tools present"

# --- 1. Fix service apps: readiness/metrics blocks + future import ---
Write-Host "`n==== Phase 1: Patch services (/metrics, /healthz, /readyz) and future import ====" -ForegroundColor Cyan

# Normalizer
if (Test-Path $NormMain) {
  $normAppend = @'
# --- BEGIN READINESS_METRICS (normalizer) ---
try:
    from fastapi import Response, status
    from prometheus_client import Counter, Gauge, Histogram, CONTENT_TYPE_LATEST, generate_latest
    import asyncio

    # Create/read global readiness flags so other modules can flip them
    _ready_event = globals().get("_ready_event") or asyncio.Event()
    _started_event = globals().get("_started_event") or asyncio.Event()
    globals()["_ready_event"] = _ready_event
    globals()["_started_event"] = _started_event

    NORMALIZER_NATS_CONNECTED = globals().get("NORMALIZER_NATS_CONNECTED") or Gauge("normalizer_nats_connected", "1 if connected to NATS, else 0")
    globals()["NORMALIZER_NATS_CONNECTED"] = NORMALIZER_NATS_CONNECTED

    @app.get("/metrics")
    def _metrics():
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.get("/healthz")
    def _healthz():
        return {"ok": True, "started": _started_event.is_set()}

    @app.get("/readyz")
    def _readyz():
        if _ready_event.is_set():
            return {"ready": True}
        return Response(content='{\"ready\": false}', media_type="application/json", status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
except Exception:
    pass
# --- END READINESS_METRICS (normalizer) ---
'@
  $txt = Get-Content -LiteralPath $NormMain -Raw
  if ($txt -notmatch 'BEGIN READINESS_METRICS \(normalizer\)'){
    $txt = $txt.TrimEnd() + "`r`n`r`n" + $normAppend
    Set-Content -LiteralPath $NormMain -Value $txt -Encoding UTF8
    OK "Patched normalizer readiness/metrics"
  } else { Info "Normalizer readiness/metrics already present" }
  Ensure-FutureImportTop $NormMain
} else { Warn "Missing $NormMain" }

# Tax-engine
if (Test-Path $TaxMain) {
  $taxAppend = @'
# --- BEGIN READINESS_METRICS (tax-engine) ---
try:
    from fastapi import Response, status
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
    import asyncio

    _ready_event = globals().get("_ready_event") or asyncio.Event()
    _started_event = globals().get("_started_event") or asyncio.Event()
    globals()["_ready_event"] = _ready_event
    globals()["_started_event"] = _started_event

    @app.get("/metrics")
    def _metrics():
        return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)

    @app.get("/healthz")
    def _healthz():
        return {"ok": True, "started": _started_event.is_set()}

    @app.get("/readyz")
    def _readyz():
        if _ready_event.is_set():
            return {"ready": True}
        return Response(content='{\"ready\": false}', media_type="application/json", status_code=status.HTTP_503_SERVICE_UNAVAILABLE)
except Exception:
    pass
# --- END READINESS_METRICS (tax-engine) ---
'@
  $txt = Get-Content -LiteralPath $TaxMain -Raw
  if ($txt -notmatch 'BEGIN READINESS_METRICS \(tax-engine\)'){
    $txt = $txt.TrimEnd() + "`r`n`r`n" + $taxAppend
    Set-Content -LiteralPath $TaxMain -Value $txt -Encoding UTF8
    OK "Patched tax-engine readiness/metrics"
  } else { Info "Tax-engine readiness/metrics already present" }
  Ensure-FutureImportTop $TaxMain
} else { Warn "Missing $TaxMain" }

# --- 2. PAYG-W domain + rules + minimal UI ---
Write-Host "`n==== Phase 2: Install PAYG-W and mini UI ====" -ForegroundColor Cyan
Ensure-Dir $TaxDomains
Ensure-Dir $TaxRules
Ensure-Dir $TaxTemplates
Ensure-Dir $TaxStatic

# PAYG-W domain
$PaygwPy = @'
from __future__ import annotations
from typing import Dict, Any, Tuple

def _round(amount: float, mode: str="HALF_UP") -> float:
    from decimal import Decimal, ROUND_HALF_UP, ROUND_HALF_EVEN, getcontext
    getcontext().prec = 28
    q = Decimal(str(amount)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP if mode=="HALF_UP" else ROUND_HALF_EVEN)
    return float(q)

def _bracket_withholding(gross: float, cfg: Dict[str, Any]) -> float:
    """Generic progressive bracket formula: tax = a*gross - b + fixed (per period)."""
    brs = cfg.get("brackets", [])
    for br in brs:
        if gross <= float(br.get("up_to", 9e9)):
            a = float(br.get("a", 0.0)); b = float(br.get("b", 0.0)); fixed = float(br.get("fixed", 0.0))
            return max(0.0, a * gross - b + fixed)
    return 0.0

def _percent_simple(gross: float, rate: float) -> float:
    return max(0.0, gross * rate)

def _flat_plus_percent(gross: float, rate: float, extra: float) -> float:
    return max(0.0, gross * rate + extra)

def _bonus_marginal(regular_gross: float, bonus: float, cfg: Dict[str, Any]) -> float:
    base = _bracket_withholding(regular_gross + bonus, cfg)
    only_base = _bracket_withholding(regular_gross, cfg)
    return max(0.0, base - only_base)

def _solve_net_to_gross(target_net: float, method_cfg: Tuple[str, Dict[str, Any]]) -> Tuple[float,float]:
    mname, params = method_cfg
    lo, hi = 0.0, max(1.0, target_net * 3.0)
    for _ in range(60):
        mid = (lo+hi)/2
        w = compute_withholding_for_gross(mid, mname, params)
        net = mid - w
        if net > target_net: hi = mid
        else: lo = mid
    gross = (lo+hi)/2
    w = compute_withholding_for_gross(gross, mname, params)
    return gross, w

def compute_withholding_for_gross(gross: float, method: str, params: Dict[str, Any]) -> float:
    if method == "formula_progressive":
        return _bracket_withholding(gross, params.get("formula_progressive", {}))
    if method == "percent_simple":
        return _percent_simple(gross, float(params.get("percent", 0.0)))
    if method == "flat_plus_percent":
        return _flat_plus_percent(gross, float(params.get("percent", 0.0)), float(params.get("extra", 0.0)))
    if method == "bonus_marginal":
        return _bonus_marginal(float(params.get("regular_gross", 0.0)), float(params.get("bonus", 0.0)), params.get("formula_progressive", {}))
    if method == "table_ato":
        # Placeholder: replace with exact ATO schedule logic per period & flags.
        return _bracket_withholding(gross, params.get("formula_progressive", {}))
    return 0.0

def compute(event: Dict[str, Any], rules: Dict[str, Any]) -> Dict[str, Any]:
    pw = event.get("payg_w", {}) or {}
    method = (pw.get("method") or "table_ato")
    period = (pw.get("period") or "weekly")
    params = {
        "period": period,
        "tax_free_threshold": bool(pw.get("tax_free_threshold", True)),
        "stsl": bool(pw.get("stsl", False)),
        "percent": float(pw.get("percent", 0.0)),
        "extra": float(pw.get("extra", 0.0)),
        "regular_gross": float(pw.get("regular_gross", 0.0)),
        "bonus": float(pw.get("bonus", 0.0)),
        "formula_progressive": (rules.get("formula_progressive") or {})
    }
    explain = [f"method={method} period={period} TFT={params['tax_free_threshold']} STSL={params['stsl']}"]
    gross = float(pw.get("gross", 0.0) or 0.0)
    target_net = pw.get("target_net")

    if method == "net_to_gross" and target_net is not None:
        gross, w = _solve_net_to_gross(float(target_net), ("formula_progressive", params))
        net = gross - w
        return {"method": method, "gross": _round(gross), "withholding": _round(w), "net": _round(net), "explain": explain + [f"solved net_to_gross target_net={target_net}"]}
    else:
        w = compute_withholding_for_gross(gross, method, params)
        net = gross - w
        return {"method": method, "gross": _round(gross), "withholding": _round(w), "net": _round(net), "explain": explain + [f"computed from gross={gross}"]}
'@
Write-IfChanged (Join-Path $TaxDomains "payg_w.py") $PaygwPy

# Rules placeholder (update annually)
$RulesJson = @'
{
  "version": "2024-25",
  "notes": "Replace with ATO-published formulas/tables each 1 July before production.",
  "methods_enabled": ["table_ato","formula_progressive","percent_simple","flat_plus_percent","bonus_marginal","net_to_gross"],
  "formula_progressive": {
    "period": "weekly",
    "brackets": [
      { "up_to": 359.00,   "a": 0.00,  "b":   0.0,  "fixed": 0.0 },
      { "up_to": 438.00,   "a": 0.19,  "b":  68.0,  "fixed": 0.0 },
      { "up_to": 548.00,   "a": 0.234, "b":  87.82, "fixed": 0.0 },
      { "up_to": 721.00,   "a": 0.347, "b": 148.50, "fixed": 0.0 },
      { "up_to": 865.00,   "a": 0.345, "b": 147.00, "fixed": 0.0 },
      { "up_to": 999999.0, "a": 0.39,  "b": 183.0,  "fixed": 0.0 }
    ],
    "tax_free_threshold": true,
    "rounding": "HALF_UP"
  }
}
'@
Write-IfChanged (Join-Path $TaxRules "payg_w_2024_25.json") $RulesJson

# Mini UI (templates + static css)
$Layout = @'
<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/static/ui.css">
<title>{{ title or "APGMS UI" }}</title>
</head><body>
<div class="container">
  <div class="nav">
    <a href="/ui">Calculator</a>
    <a href="/ui/help">Help</a>
  </div>
  <div class="card">
    <h1>{{ title or "APGMS" }}{% if badge %}<span class="badge">{{ badge }}</span>{% endif %}</h1>
    {% block content %}{% endblock %}
  </div>
</div>
</body></html>
'@
$Index = @'
{% extends "layout.html" %}
{% block content %}
<form method="post" action="/ui/calc">
  <div class="row">
    <div>
      <label>Method</label>
      <select name="method">
        <option value="table_ato">ATO Table (placeholder)</option>
        <option value="formula_progressive">Formula (progressive)</option>
        <option value="percent_simple">Percent simple</option>
        <option value="flat_plus_percent">Flat + percent</option>
        <option value="bonus_marginal">Bonus (marginal)</option>
        <option value="net_to_gross">Net → Gross (solver)</option>
      </select>
    </div>
    <div>
      <label>Period</label>
      <select name="period">
        <option>weekly</option><option>fortnightly</option><option>monthly</option>
      </select>
    </div>
    <div>
      <label>Gross (or Regular Gross)</label>
      <input type="number" step="0.01" name="gross" value="2000">
    </div>
  </div>
  <div class="row">
    <div><label>Percent</label><input type="number" step="0.0001" name="percent" value="0.2"></div>
    <div><label>Extra (flat)</label><input type="number" step="0.01" name="extra" value="0"></div>
    <div><label>Bonus</label><input type="number" step="0.01" name="bonus" value="0"></div>
  </div>
  <div class="row">
    <div><label>Tax-free threshold</label><select name="tft"><option value="true">true</option><option value="false">false</option></select></div>
    <div><label>STSL/HELP</label><select name="stsl"><option value="false">false</option><option value="true">true</option></select></div>
    <div><label>Target Net (for net→gross)</label><input type="number" step="0.01" name="target_net" value=""></div>
  </div>
  <div style="margin-top:12px"><button type="submit">Calculate</button></div>
</form>

{% if result %}
  <h2>Result</h2>
  <div class="result">
    {{ result | tojson(indent=2) }}
  </div>
  <h2>Explain</h2>
  <div class="result">
    {% for line in result.get("explain", []) %}
      • {{ line }}{% if not loop.last %}\n{% endif %}
    {% endfor %}
  </div>
{% endif %}
{% endblock %}
'@
$Help = @'
{% extends "layout.html" %}
{% block content %}
<h2>PAYG-Withholding methods</h2>
<ul>
  <li><b>ATO Table</b>: Apply current-year schedules/formulas. Update rules each 1 July.</li>
  <li><b>Formula (progressive)</b>: Uses bracketed rates in JSON; mirrors ATO tables.</li>
  <li><b>Percent simple</b>: percentage of gross (voluntary agreements).</li>
  <li><b>Flat + percent</b>: add an extra fixed amount to the base percent.</li>
  <li><b>Bonus (marginal)</b>: withhold bonus at marginal rate on top of regular.</li>
  <li><b>Net → Gross</b>: solve gross to hit a target net using selected formula.</li>
</ul>
<p><i>Disclaimer:</i> demo UI; not legal or tax advice. Validate against ATO examples before production.</p>
{% endblock %}
'@
$CSS = @'
:root { --brand:#0b5fff; --bg:#0f1115; --card:#1b1e27; --text:#e8ecf1; --muted:#9aa4b2; }
*{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,Segoe UI,Roboto,Arial}
.container{max-width:980px;margin:32px auto;padding:0 16px}
.card{background:var(--card);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);padding:20px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 12px} h2{font-size:16px;margin:0 0 12px;color:var(--muted)}
label{display:block;margin:8px 0 4px;color:var(--muted)}
input,select,button{width:100%;padding:10px 12px;border-radius:10px;border:1px solid #2a2f3a;background:#12151d;color:var(--text)}
button{background:var(--brand);border:none;font-weight:600;cursor:pointer}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.result{white-space:pre-wrap;background:#12151d;border-radius:10px;padding:12px}
.nav{display:flex;gap:10px;margin-bottom:16px}
.nav a{color:#cfe0ff;text-decoration:none}
.badge{display:inline-block;padding:2px 8px;border-radius:999px;background:#19223a;color:#cfe0ff;margin-left:8px;font-size:12px}
'@

Write-IfChanged (Join-Path $TaxTemplates "layout.html") $Layout
Write-IfChanged (Join-Path $TaxTemplates "index.html")  $Index
Write-IfChanged (Join-Path $TaxTemplates "help.html")   $Help
Write-IfChanged (Join-Path $TaxStatic "ui.css")         $CSS

# Mount UI in tax-engine main.py
if (Test-Path $TaxMain) {
  $uiPatch = @'
# --- BEGIN MINI_UI ---
from fastapi import Request
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from .domains import payg_w as payg_w_mod
import os, json

TEMPLATES = Jinja2Templates(directory=os.path.join(os.path.dirname(__file__), "templates"))
app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "static")), name="static")

@app.get("/ui")
def ui_index(request: Request):
    return TEMPLATES.TemplateResponse("index.html", {"request": request, "title": "PAYG-W Calculator", "badge":"demo"})

@app.post("/ui/calc")
async def ui_calc(request: Request):
    form = await request.form()
    pw = {
        "method": form.get("method"),
        "period": form.get("period"),
        "gross": float(form.get("gross") or 0),
        "percent": float(form.get("percent") or 0),
        "extra": float(form.get("extra") or 0),
        "regular_gross": float(form.get("gross") or 0),
        "bonus": float(form.get("bonus") or 0),
        "tax_free_threshold": form.get("tft") == "true",
        "stsl": form.get("stsl") == "true",
        "target_net": float(form.get("target_net")) if form.get("target_net") else None
    }
    with open(os.path.join(os.path.dirname(__file__), "rules", "payg_w_2024_25.json"), "r", encoding="utf-8") as f:
        rules = json.load(f)
    res = payg_w_mod.compute({"payg_w": pw}, rules)
    return TEMPLATES.TemplateResponse("index.html", {"request": request, "title": "PAYG-W Calculator", "result": res, "badge":"demo"})

@app.get("/ui/help")
def ui_help(request: Request):
    return TEMPLATES.TemplateResponse("help.html", {"request": request, "title": "Help", "badge":"demo"})
# --- END MINI_UI ---
'@
  $txt = Get-Content -LiteralPath $TaxMain -Raw
  if ($txt -notmatch 'BEGIN MINI_UI'){
    $txt = $txt.TrimEnd() + "`r`n`r`n" + $uiPatch + "`r`n"
    Set-Content -LiteralPath $TaxMain -Value $txt -Encoding UTF8
    OK "Patched UI into tax-engine main.py"
  } else {
    Info "UI already present (tax-engine)"
  }
  Ensure-FutureImportTop $TaxMain
}

# Dockerfile ensure jinja2
if (Test-Path $TaxDockerfile) {
  $d = Get-Content -LiteralPath $TaxDockerfile -Raw
  if ($d -notmatch 'jinja2') {
    $d = $d -replace '(pip install --no-cache-dir[^\r\n]*)', '$0 jinja2'
    Set-Content -LiteralPath $TaxDockerfile -Value $d -Encoding UTF8
    OK "Added jinja2 to tax-engine Dockerfile"
  } else { Info "Dockerfile already includes jinja2" }
}

# --- 3. Compose: write a clean, known-good file (backup existing) ---
Write-Host "`n==== Phase 3: Write clean docker-compose.yml ====" -ForegroundColor Cyan
$ComposePath = Join-Path $RepoRoot "docker-compose.yml"
if (Test-Path $ComposePath) {
  Copy-Item -Force $ComposePath "$ComposePath.bak"
  Info "Backed up docker-compose.yml → docker-compose.yml.bak"
}

$ComposeYaml = @'
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: apgms
      POSTGRES_PASSWORD: apgms
      POSTGRES_DB: apgms
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U apgms"]
      interval: 5s
      timeout: 5s
      retries: 20

  nats:
    image: nats:2.10-alpine
    command: ["-js", "-sd", "/data", "-m", "8222"]
    ports:
      - "4222:4222"
      - "8222:8222"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8222/healthz >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 20

  normalizer:
    build:
      context: .
      dockerfile: apps/services/event-normalizer/Dockerfile
    environment:
      APP_MODULE: app.main:app
      UVICORN_PORT: "8001"
      SERVICE_PORT: "8001"
      PORT: "8001"
      NATS_URL: nats://nats:4222
      PYTHONPATH: /app
    ports:
      - "8001:8001"
    depends_on:
      nats:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8001/readyz >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 15s
    restart: unless-stopped

  tax-engine:
    build:
      context: ./apps/services/tax-engine
    environment:
      NATS_URL: nats://nats:4222
      SERVICE_PORT: "8002"
    ports:
      - "8002:8002"
    depends_on:
      nats:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://127.0.0.1:8002/readyz >/dev/null 2>&1 || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 15s
    restart: unless-stopped

  grafana:
    image: grafana/grafana:11.1.3
    ports:
      - "3000:3000"
'@
Write-IfChanged $ComposePath $ComposeYaml

# --- 4. Build & Run ---
Write-Host "`n==== Phase 4: Build & Run ====" -ForegroundColor Cyan
if (-not $SkipBuild) {
  Push-Location $RepoRoot
  try {
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { throw "docker compose up failed." }
    OK "Compose up"
  } finally { Pop-Location }
} else {
  Info "SkipBuild requested; using existing containers"
}

# --- 5. Readiness wait ---
Write-Host "`n==== Phase 5: Wait for readiness ====" -ForegroundColor Cyan
function Wait-Ready([string]$Url,[int]$TimeoutSec){
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while((Get-Date) -lt $deadline){
    try {
      $r = curl.exe -sS $Url
      if ($LASTEXITCODE -eq 0 -and $r -match '"ready"\s*:\s*true'){ return $true }
    } catch {}
    Start-Sleep -Seconds 2
  }
  return $false
}

# NATS health
try { $n = curl.exe -sS http://127.0.0.1:8222/healthz; if ($LASTEXITCODE -eq 0) { OK "NATS ready" } else { Err "NATS not ready" } } catch { Err "NATS health check failed" }

$NormReady = Wait-Ready "http://127.0.0.1:8001/readyz" $ReadyTimeoutSec
if ($NormReady) { OK "Normalizer ready" } else {
  Err "Normalizer NOT ready within $ReadyTimeoutSec s"
  docker compose logs --since=120s normalizer
}

$TaxReady = Wait-Ready "http://127.0.0.1:8002/readyz" $ReadyTimeoutSec
if ($TaxReady) { OK "Tax-engine ready" } else {
  Err "Tax-engine NOT ready within $ReadyTimeoutSec s"
  docker compose logs --since=120s tax-engine
}

# --- 6. NATS smoke (natsio/nats-box) ---
Write-Host "`n==== Phase 6: NATS smoke ====" -ForegroundColor Cyan
$Project = Split-Path -Leaf $RepoRoot
$Net = "${Project}_default"
Info "Using network: $Net"
try { docker pull natsio/nats-box:latest | Out-Null } catch {}

function Pub-Nats([string]$Subject,[string]$Json){
  $cmd = "docker run --rm --network $Net natsio/nats-box:latest sh -lc `"nats --server nats://nats:4222 pub $Subject '$Json'`""
  try { iex $cmd; return ($LASTEXITCODE -eq 0) } catch { return $false }
}

if (Pub-Nats "apgms.tax.v1" '{"calc":"ok","amount":123.45}') {
  OK "Published sample → apgms.tax.v1"
} else {
  Warn "Publish failed: apgms.tax.v1"
}

if (Pub-Nats "apgms.normalized.v1" '{"id":"paygw-demo","entity":"AUS-PTY","period":"2025-09","payg_w":{"method":"formula_progressive","period":"weekly","gross":2000}}') {
  OK "Published normalized event → apgms.normalized.v1"
} else {
  Warn "Publish failed: apgms.normalized.v1 (OK if not wired yet)"
}

# --- 7. Metrics & Debug ---
Write-Host "`n==== Phase 7: Metrics & Debug ====" -ForegroundColor Cyan
try {
  $m1 = curl.exe -sS http://127.0.0.1:8001/metrics
  if ($LASTEXITCODE -eq 0) { OK "Normalizer metrics reachable"; $m1 | Select-String -SimpleMatch "normalizer_" | % { $_.Line } } else { Err "Normalizer metrics unavailable" }
} catch { Err "Normalizer metrics check error" }

try {
  $m2 = curl.exe -sS http://127.0.0.1:8002/metrics
  if ($LASTEXITCODE -eq 0) { OK "Tax-engine metrics reachable"; $m2 | Select-String -SimpleMatch "tax_" | % { $_.Line } } else { Warn "Tax-engine metrics unavailable (OK if not instrumented)" }
} catch { Warn "Tax-engine metrics check error" }

try {
  $last = curl.exe -sS http://127.0.0.1:8001/debug/last-tax
  if ($LASTEXITCODE -eq 0) { OK "Last tax seen by normalizer:"; Write-Host $last } else { Warn "Could not fetch /debug/last-tax" }
} catch { Warn "Error fetching /debug/last-tax" }

Write-Host "`n==== Summary ====" -ForegroundColor Cyan
$Norm = if($NormReady){"ready"}else{"not-ready"}
$Tax  = if($TaxReady) {"ready"}else{"not-ready"}
Write-Host "Normalizer: $Norm; Tax-engine: $Tax"
OK "Done."
