# setup_portal.ps1  -- creates/updates GUI, API gateway, Nginx proxy, and compose files
# Windows PowerShell 5+ friendly, ASCII only, UTF-8 (no BOM) outputs

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $lf = $Content -replace "`r`n", "`n"
  $enc = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $lf, $enc)
}

function Backup-IfExists { param([string]$Path) if (Test-Path $Path) { $stamp = Get-Date -Format "yyyyMMdd-HHmmss"; Copy-Item -LiteralPath $Path -Destination "$Path.$stamp.bak" -Force } }

# ------------------------------------------------------------------------------------
# 0) Locate compose files
# ------------------------------------------------------------------------------------
$repo = (Get-Location).Path
$mainCompose = if (Test-Path "$repo\docker-compose.yml") { "$repo\docker-compose.yml" }
elseif (Test-Path "$repo\docker-compose.yaml") { "$repo\docker-compose.yaml" }
else { "$repo\docker-compose.yml" }  # will create if missing

$guiCompose  = "$repo\docker-compose.gui.yaml"

# ------------------------------------------------------------------------------------
# 1) Nginx server block (no BOM, LF)
# ------------------------------------------------------------------------------------
$nginxConfPath = "$repo\ops\nginx.gui.conf"
$nginxConf = @'
server {
  listen 80 default_server;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  # Proxy the API to the portal-api container (gateway)
  location /api/ {
    proxy_pass http://portal-api:8000/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
  }

  # Convenience redirects
  location /prom { return 302 http://prometheus:9090; }
  location /nats { return 302 http://nats:8222; }

  # SPA fallback
  location / {
    try_files $uri /index.html;
  }
}
'@

Backup-IfExists $nginxConfPath
Write-Utf8NoBom -Path $nginxConfPath -Content $nginxConf

# ------------------------------------------------------------------------------------
# 2) GUI assets (index.html, styles.css, app.js, start.sh)
# ------------------------------------------------------------------------------------
$guiDir = "$repo\apps\gui"
$indexHtml = @'
<!doctype html>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>APGMS Portal</title>
<link rel="stylesheet" href="/styles.css">
<div id="app" class="app">Loading...</div>
<script src="/config.js" defer></script>
<script src="/app.js" defer></script>
'@

$stylesCss = @'
:root{ --bg:#fff; --fg:#111; --muted:#6b7280; --primary:#0a5; --card:#f7f8fa; --border:#e5e7eb; --focus:#2563eb }
:root.theme-dark{ --bg:#0f1216; --fg:#e6e6e6; --muted:#a1a1aa; --primary:#22c55e; --card:#161a20; --border:#20242c; --focus:#60a5fa }
html,body{ height:100%; margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Arial }
.app{ max-width:1100px; margin:32px auto; padding:0 16px }
nav{ display:flex; gap:12px; flex-wrap:wrap; align-items:center; padding:12px; background:var(--card); border:1px solid var(--border); border-radius:12px }
nav a{ text-decoration:none; color:var(--fg); padding:6px 10px; border-radius:8px }
nav a.active{ background:var(--primary); color:white }
header h1{ margin:10px 0 0 0; font-size:20px }
.grid{ display:grid; gap:12px }
.card{ background:var(--card); border:1px solid var(--border); border-radius:12px; padding:12px }
.btn{ border:1px solid var(--border); background:var(--bg); padding:8px 12px; border-radius:10px; cursor:pointer }
.btn:focus{ outline:3px solid var(--focus) }
label{ display:block; margin:8px 0 4px; color:var(--muted) }
input, select, textarea{ width:100%; padding:8px; border-radius:8px; border:1px solid var(--border); background:var(--bg); color:var(--fg) }
table{ width:100%; border-collapse:collapse }
th,td{ padding:8px; border-bottom:1px solid var(--border) }
.kbd{ font-family:ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; background:var(--card); border:1px solid var(--border); border-radius:6px; padding:2px 6px }
.footer{ margin-top:24px; color:var(--muted) }
'@

$appJs = @'
(() => {
  const cfg = window.GUI_CONFIG || {};
  const base = (cfg.baseUrl || "/api").replace(/\/+$/, "");
  const $ = (sel, root=document) => root.querySelector(sel);

  const routes = ["home","connections","transactions","tax-bas","help","settings"];
  function currentRoute(){ const h = location.hash.replace(/^#\/?/, "").toLowerCase(); return routes.includes(h) ? h : "home"; }
  window.addEventListener("hashchange", () => render());

  async function api(path, init={}) {
    const r = await fetch(base + path, { headers: { "Content-Type":"application/json" }, ...init });
    if (!r.ok) throw new Error(String(r.status));
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  const View = {
    nav(active){
      return `
        <nav aria-label="Primary">
          <a href="#/home"        class="${active==='home'?'active':''}">Home</a>
          <a href="#/connections" class="${active==='connections'?'active':''}">Connections</a>
          <a href="#/transactions"class="${active==='transactions'?'active':''}">Transactions</a>
          <a href="#/tax-bas"     class="${active==='tax-bas'?'active':''}">Tax & BAS</a>
          <a href="#/help"        class="${active==='help'?'active':''}">Help</a>
          <a href="#/settings"    class="${active==='settings'?'active':''}">Settings</a>
        </nav>`;
    },

    home(){
      return `
        ${this.nav('home')}
        <header>
          <h1>${cfg.brand || "APGMS Normalizer"}</h1>
          <p>${cfg.title || "Customer Portal"}</p>
        </header>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); margin-top:12px">
          <div class="card">
            <h3>Service</h3>
            <button class="btn" id="btnReady">Check Ready</button>
            <button class="btn" id="btnMetrics">Metrics</button>
            <pre id="svcOut" style="margin-top:8px;max-height:220px;overflow:auto"></pre>
          </div>
          <div class="card">
            <h3>Yesterday at a glance</h3>
            <div id="yesterday">Loading...</div>
          </div>
          <div class="card">
            <h3>Normalize a file</h3>
            <input id="file" type="file" accept=".csv,.json" />
            <button class="btn" id="btnUpload">Upload & Normalize</button>
            <pre id="normOut" style="margin-top:8px;max-height:220px;overflow:auto"></pre>
          </div>
        </div>
        <div class="footer">OpenAPI: <a target="_blank" href="${cfg.swaggerPath || '/api/openapi.json'}">${cfg.swaggerPath || '/api/openapi.json'}</a></div>
      `;
    },

    connections(){
      return `
        ${this.nav('connections')}
        <div class="grid" style="grid-template-columns:2fr 1fr; margin-top:12px">
          <div class="card">
            <h3>Connected sources</h3>
            <table id="connTable"><thead><tr><th>Type</th><th>Provider</th><th>Status</th><th></th></tr></thead><tbody></tbody></table>
          </div>
          <div class="card">
            <h3>Add connection</h3>
            <label for="connType">Type</label>
            <select id="connType">
              <option value="bank">Bank (CDR/Open Banking)</option>
              <option value="payroll">Payroll</option>
              <option value="pos">POS / Commerce</option>
              <option value="ato">ATO (SBR/BAS/STP)</option>
            </select>
            <label for="provider">Provider</label>
            <select id="provider">
              <option value="basiq">Basiq</option>
              <option value="truelayer">TrueLayer</option>
              <option value="square">Square</option>
              <option value="shopify">Shopify</option>
              <option value="xero">Xero</option>
              <option value="myob">MYOB</option>
              <option value="messagexchange">MessageXchange (SBR)</option>
              <option value="ozedi">Ozedi (SBR)</option>
            </select>
            <button class="btn" id="btnConnect">Connect</button>
            <div id="connMsg" style="margin-top:8px"></div>
          </div>
        </div>
      `;
    },

    transactions(){
      return `
        ${this.nav('transactions')}
        <div class="card">
          <h3>Transactions</h3>
          <div style="display:flex; gap:8px; margin-bottom:8px">
            <input id="q" placeholder="Search description or ref" />
            <select id="filterSource"><option value="">All sources</option></select>
            <button class="btn" id="btnRefresh">Refresh</button>
          </div>
          <table id="txTable"><thead><tr><th>Date</th><th>Source</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead><tbody></tbody></table>
        </div>
      `;
    },

    "tax-bas"(){
      return `
        ${this.nav('tax-bas')}
        <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
          <div class="card">
            <h3>BAS Preparation</h3>
            <button class="btn" id="btnPreviewBas">Preview BAS (draft)</button>
            <pre id="basOut" style="margin-top:8px;max-height:260px;overflow:auto"></pre>
          </div>
          <div class="card">
            <h3>ATO Lodgement</h3>
            <p>Status: <span id="atoStatus">Unknown</span></p>
            <button class="btn" id="btnValidateBas">Validate with ATO (SBR)</button>
            <button class="btn" id="btnLodgeBas">Lodge BAS</button>
            <div id="lodgeMsg" style="margin-top:8px"></div>
          </div>
        </div>
      `;
    },

    help(){
      return `
        ${this.nav('help')}
        <div class="card">
          <h3>Help & Guidance</h3>
          <ol>
            <li>Use <b>Connections</b> to link Bank (CDR), Payroll/POS, and ATO (SBR).</li>
            <li>Import or auto-ingest data; view in <b>Transactions</b>.</li>
            <li>Prepare and validate <b>Tax & BAS</b>; lodge via SBR when ready.</li>
            <li>See <span class="kbd">/api/openapi.json</span> for API details.</li>
          </ol>
        </div>
      `;
    },

    settings(){
      return `
        ${this.nav('settings')}
        <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
          <div class="card">
            <h3>Appearance</h3>
            <label for="theme">Theme</label>
            <select id="theme">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div class="card">
            <h3>Compliance</h3>
            <label>Retention Period (months)</label>
            <input id="retention" type="number" min="0" value="84" />
            <label>PII Masking</label>
            <select id="pii"><option value="on">On</option><option value="off">Off</option></select>
            <button class="btn" id="btnSaveSettings" style="margin-top:8px">Save</button>
            <div id="saveMsg" style="margin-top:8px"></div>
          </div>
        </div>
      `;
    }
  };

  async function wire(view) {
    if (view==='home') {
      $('#btnReady')?.addEventListener('click', async () => {
        const pre = $('#svcOut'); pre.textContent = 'Checking...';
        try { const r = await fetch(base+'/readyz'); pre.textContent = 'HTTP ' + r.status; } catch { pre.textContent = 'Unreachable'; }
      });
      $('#btnMetrics')?.addEventListener('click', async () => {
        const pre = $('#svcOut'); pre.textContent = 'Loading metrics...';
        try { pre.textContent = await (await fetch(base+'/metrics')).text(); } catch { pre.textContent = 'Failed'; }
      });
      $('#btnUpload')?.addEventListener('click', async () => {
        const f = $('#file').files[0], out = $('#normOut'); if(!f){ alert('Choose a file'); return; }
        const text = await f.text();
        const payload = text.trim().startsWith('{') || text.trim().startsWith('[') ? JSON.parse(text) : { csv: text };
        out.textContent = 'Uploading...';
        try {
          const res = await api('/normalize', { method:'POST', body: JSON.stringify(payload) });
          out.textContent = JSON.stringify(res, null, 2);
        } catch(e){ out.textContent = 'Failed: ' + e.message; }
      });
      try { const y = await api('/dashboard/yesterday'); $('#yesterday').textContent = JSON.stringify(y); } catch { $('#yesterday').textContent='N/A'; }
    }

    if (view==='connections') {
      async function loadList(){
        const rows = await api('/connections');
        const tb = $('#connTable tbody'); tb.innerHTML = '';
        rows.forEach(x=>{
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${x.type}</td><td>${x.provider}</td><td>${x.status}</td><td><button class="btn" data-id="${x.id}">Remove</button></td>`;
          tb.appendChild(tr);
        });
        tb.querySelectorAll('button').forEach(btn=>{
          btn.onclick = async () => { await api(`/connections/${btn.dataset.id}`, { method:'DELETE' }); loadList(); };
        });
      }
      $('#btnConnect').onclick = async () => {
        $('#connMsg').textContent = 'Starting connection...';
        const type = $('#connType').value, provider = $('#provider').value;
        try {
          const { url } = await api('/connections/start', { method:'POST', body: JSON.stringify({ type, provider }) });
          $('#connMsg').innerHTML = `Open auth window: <a target="_blank" href="${url}">${url}</a>`;
        } catch(e){ $('#connMsg').textContent = 'Failed: ' + e.message; }
      };
      loadList();
    }

    if (view==='transactions') {
      async function load() {
        const q = $('#q').value, src = $('#filterSource').value;
        const data = await api(`/transactions?q=${encodeURIComponent(q||'')}&source=${encodeURIComponent(src||'')}`);
        const tb = $('#txTable tbody'); tb.innerHTML='';
        data.items.forEach(t=>{
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${t.date}</td><td>${t.source}</td><td>${t.description}</td><td style="text-align:right">${t.amount.toFixed(2)}</td><td>${t.category||''}</td>`;
          tb.appendChild(tr);
        });
        const sel = $('#filterSource'); sel.innerHTML = '<option value="">All sources</option>';
        data.sources.forEach(s=>{ const o = document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o); });
      }
      $('#btnRefresh').onclick = load;
      load();
    }

    if (view==='tax-bas') {
      $('#btnPreviewBas').onclick = async () => {
        const out = $('#basOut'); out.textContent='Calculating...';
        try { out.textContent = JSON.stringify(await api('/bas/preview'), null, 2); } catch(e){ out.textContent='Failed: '+e.message; }
      };
      $('#btnValidateBas').onclick = async () => { $('#lodgeMsg').textContent = 'Validating with ATO...'; try{ await api('/bas/validate', { method:'POST' }); $('#lodgeMsg').textContent='Validated'; } catch(e){ $('#lodgeMsg').textContent='Failed: '+e.message; } };
      $('#btnLodgeBas').onclick = async () => { $('#lodgeMsg').textContent = 'Lodging with ATO...'; try{ await api('/bas/lodge', { method:'POST' }); $('#lodgeMsg').textContent='Lodged'; } catch(e){ $('#lodgeMsg').textContent='Failed: '+e.message; } };
      try{ $('#atoStatus').textContent = (await api('/ato/status')).status; }catch{ $('#atoStatus').textContent='Unavailable'; }
    }

    if (view==='settings') {
      $('#theme').value = (localStorage.getItem('theme') || 'light');
      document.documentElement.classList.toggle('theme-dark', $('#theme').value==='dark');
      $('#theme').addEventListener('change', e=>{
        localStorage.setItem('theme', e.target.value);
        document.documentElement.classList.toggle('theme-dark', e.target.value==='dark');
      });
      $('#btnSaveSettings').onclick = async ()=>{
        const payload = { retentionMonths: parseInt($('#retention').value,10), piiMask: $('#pii').value==='on' };
        $('#saveMsg').textContent='Saving...';
        try{ await api('/settings', { method:'POST', body: JSON.stringify(payload) }); $('#saveMsg').textContent='Saved.'; }catch(e){ $('#saveMsg').textContent='Failed: '+e.message; }
      };
    }
  }

  function render(){
    const view = currentRoute();
    const root = document.getElementById('app');
    root.innerHTML = View[view] ? View[view]() : View.home();
    wire(view);
  }

  render();
})();
'@

$startSh = @'
#!/bin/sh
set -eu
cat >/usr/share/nginx/html/config.js <<CFG
window.GUI_CONFIG = {
  brand: "${GUI_BRAND:-APGMS Normalizer}",
  title: "${GUI_TITLE:-Customer Portal}",
  baseUrl: "${GUI_BASE_URL:-/api}",
  swaggerPath: "${GUI_SWAGGER_PATH:-/api/openapi.json}"
};
CFG
exec nginx -g "daemon off;"
'@

Backup-IfExists "$guiDir\index.html";   Write-Utf8NoBom -Path "$guiDir\index.html" -Content $indexHtml
Backup-IfExists "$guiDir\styles.css";   Write-Utf8NoBom -Path "$guiDir\styles.css" -Content $stylesCss
Backup-IfExists "$guiDir\app.js";       Write-Utf8NoBom -Path "$guiDir\app.js" -Content $appJs
Backup-IfExists "$guiDir\start.sh";     Write-Utf8NoBom -Path "$guiDir\start.sh" -Content $startSh

# ------------------------------------------------------------------------------------
# 3) API Gateway (portal-api)
# ------------------------------------------------------------------------------------
$apiDir = "$repo\portal-api"
$appPy = @'
from fastapi import FastAPI, Query
from pydantic import BaseModel
from typing import List, Dict, Any
import time

app = FastAPI(title="APGMS Portal API", version="0.1.0")

@app.get("/readyz")
def readyz(): return {"ok": True, "ts": time.time()}

@app.get("/metrics", response_class=None)
def metrics():
    return ("\n".join([
        "# HELP portal_up 1 if up",
        "# TYPE portal_up gauge",
        "portal_up 1"
    ]))

@app.get("/dashboard/yesterday")
def yesterday():
    return {"jobs": 3, "success_rate": 0.97, "top_errors": []}

@app.post("/normalize")
def normalize(payload: Dict[str, Any]):
    return {"received": True, "size": sum(len(str(v)) for v in payload.values())}

class ConnStart(BaseModel):
    type: str
    provider: str

_connections: List[Dict[str, Any]] = []

@app.get("/connections")
def list_connections(): return _connections

@app.post("/connections/start")
def start_conn(req: ConnStart):
    url = f"https://example-auth/{req.provider}/authorize?state=fake"
    return {"url": url}

@app.delete("/connections/{conn_id}")
def delete_conn(conn_id: int):
    global _connections
    _connections = [c for c in _connections if c.get("id") != conn_id]
    return {"ok": True}

@app.get("/transactions")
def transactions(q: str = "", source: str = ""):
    items = [
        {"date":"2025-10-03","source":"bank","description":"Coffee","amount":-4.5,"category":"Meals"},
        {"date":"2025-10-03","source":"pos","description":"Sale #1234","amount":120.0,"category":"Sales"},
    ]
    if q: items = [t for t in items if q.lower() in t["description"].lower()]
    if source: items = [t for t in items if t["source"]==source]
    return {"items": items, "sources": sorted({t["source"] for t in items})}

@app.get("/ato/status")
def ato_status():
    return {"status":"Disconnected"}

@app.post("/bas/validate")
def bas_validate(): return {"ok": True, "message":"Validated draft with ATO sandbox (stub)"}

@app.post("/bas/lodge")
def bas_lodge(): return {"ok": True, "message":"Lodged to ATO sandbox (stub)"}

@app.get("/bas/preview")
def bas_preview():
    return {"period":"Q1 2025","GSTPayable": 1234.56,"PAYGW": 987.65,"Total": 2222.21}

class Settings(BaseModel):
    retentionMonths: int
    piiMask: bool

_settings = {"retentionMonths": 84, "piiMask": True}

@app.post("/settings")
def save_settings(s: Settings):
    _settings.update(s.dict()); return {"ok": True}

@app.get("/openapi.json")
def openapi_proxy():
    return app.openapi()
'@

$requirements = @'
fastapi==0.115.0
uvicorn[standard]==0.30.6
'@

$dockerfile = @'
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
EXPOSE 8000
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8000"]
'@

Backup-IfExists "$apiDir\app.py";           Write-Utf8NoBom -Path "$apiDir\app.py" -Content $appPy
Backup-IfExists "$apiDir\requirements.txt"; Write-Utf8NoBom -Path "$apiDir\requirements.txt" -Content $requirements
Backup-IfExists "$apiDir\Dockerfile";       Write-Utf8NoBom -Path "$apiDir\Dockerfile" -Content $dockerfile

# ------------------------------------------------------------------------------------
# 4) docker-compose.gui.yaml (GUI only override)
# ------------------------------------------------------------------------------------
$guiComposeContent = @'
services:
  gui:
    image: nginx:alpine
    depends_on:
      portal-api:
        condition: service_started
    ports:
      - "8090:80"
    environment:
      GUI_BRAND: "APGMS Normalizer"
      GUI_TITLE: "Customer Portal"
      GUI_BASE_URL: "/api"
      GUI_SWAGGER_PATH: "/api/openapi.json"
    volumes:
      - ./apps/gui:/usr/share/nginx/html
      - ./ops/nginx.gui.conf:/etc/nginx/conf.d/default.conf:ro
    command: ["/bin/sh","-c","chmod +x /usr/share/nginx/html/start.sh; /usr/share/nginx/html/start.sh"]
'@

Backup-IfExists $guiCompose
Write-Utf8NoBom -Path $guiCompose -Content $guiComposeContent

# ------------------------------------------------------------------------------------
# 5) Ensure main compose exists and has portal-api service. Remove bad nginx.conf mounts.
# ------------------------------------------------------------------------------------
if (-not (Test-Path $mainCompose)) {
  $baseCompose = @'
services:
  nats:
    image: nats:2-alpine
    command: ["-js","-m","8222"]
    ports:
      - "4222:4222"
      - "8222:8222"
  normalizer:
    build:
      context: .
      dockerfile: Dockerfile
    depends_on:
      nats:
        condition: service_started
  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9090:9090"
    volumes:
      - ./ops/prometheus.yml:/etc/prometheus/prometheus.yml:ro
'@
  Write-Utf8NoBom -Path $mainCompose -Content $baseCompose
}

# strip any short-syntax mounts to /etc/nginx/nginx.conf in all compose files (root)
Get-ChildItem -LiteralPath $repo -File -Include *.yml,*.yaml | ForEach-Object {
  $raw   = Get-Content -LiteralPath $_.FullName -Raw
  $lines = $raw -split '\r?\n'              # <-- fixed split
  $clean = $lines | Where-Object { $_ -notmatch ':/etc/nginx/nginx\.conf(?::ro)?\s*$' }
  if (@($clean).Count -ne @($lines).Count) { # <-- force arrays to compare counts
    Backup-IfExists $_.FullName
    Write-Utf8NoBom -Path $_.FullName -Content (($clean -join "`n") + "`n")
  }
}

# add portal-api service to main compose if missing
$mainRaw = Get-Content -LiteralPath $mainCompose -Raw
if ($mainRaw -notmatch '(?m)^\s*portal-api:\s*$') {
  Backup-IfExists $mainCompose
  $portalApiBlock = @'
  portal-api:
    build:
      context: ./portal-api
    environment:
      NORMALIZER_URL: http://normalizer:8001
    ports:
      - "8000:8000"
'@
  if ($mainRaw -match '(?ms)^\s*services:\s*') {
    $append = "`n" + $portalApiBlock
    Write-Utf8NoBom -Path $mainCompose -Content ($mainRaw.TrimEnd() + $append + "`n")
  } else {
    $wrapped = "services:`n" + $portalApiBlock + "`n"
    Write-Utf8NoBom -Path $mainCompose -Content $wrapped
  }
}

# ------------------------------------------------------------------------------------
# 6) Compose validation and quick tips
# ------------------------------------------------------------------------------------
Write-Host "`nFiles written. Validating compose..."
& docker compose -f $mainCompose -f $guiCompose config | Out-Null
Write-Host "Compose OK."

Write-Host @"
Next steps:

1) Build and start the API gateway and GUI:
   docker compose -f docker-compose.yml -f docker-compose.gui.yaml build portal-api
   docker compose -f docker-compose.yml -f docker-compose.gui.yaml up -d --force-recreate portal-api gui

2) Check logs:
   docker compose -f docker-compose.yml -f docker-compose.gui.yaml logs --tail=80 portal-api gui

3) Open the app:
   http://localhost:8090/#/home
"@
