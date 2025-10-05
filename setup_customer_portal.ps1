$ErrorActionPreference='Stop'

# 0) Pick your main compose file
$composeMain = if (Test-Path 'docker-compose.yml') { 'docker-compose.yml' }
elseif (Test-Path 'docker-compose.yaml') { 'docker-compose.yaml' }
else { throw "No docker-compose file found in $(Get-Location)" }

# 1) Ensure GUI server config exists as a *vhost include*, not the main nginx.conf
if (!(Test-Path 'ops')) { New-Item -ItemType Directory ops | Out-Null }
$serverConf = @'
server {
  listen 80 default_server;
  server_name _;

  root /usr/share/nginx/html;
  index index.html;

  # Proxy to your FastAPI service inside the compose network
  location /api/ {
    proxy_pass http://normalizer:8001/;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_http_version 1.1;
  }

  # Convenience links
  location /prom { return 302 http://prometheus:9090; }
  location /nats { return 302 http://nats:8222; }

  # Single-page app fallback
  location / {
    try_files $uri /index.html;
  }
}
'@
$enc = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $PWD 'ops/nginx.gui.conf'), ($serverConf -replace "`r`n","`n"), $enc)

# 2) Clean any *wrong* mounts in your main compose: map to conf.d/default.conf, never to nginx.conf
$rawMain = Get-Content $composeMain -Raw
$rawMain = $rawMain -replace ':/etc/nginx/nginx\.conf(:ro)?', ':/etc/nginx/conf.d/default.conf$1'
Set-Content -Encoding UTF8 $composeMain $rawMain

# 3) Create a minimal, known-good GUI override (port 8090)
$guiPort = 8090
$override = @"
services:
  gui:
    image: nginx:alpine
    depends_on:
      - normalizer
    ports:
      - ${guiPort}:80
    environment:
      GUI_BRAND: "APGMS Normalizer"
      GUI_TITLE: "Customer Portal"
      GUI_BASE_URL: "/api"
      GUI_SWAGGER_PATH: "/api/openapi.json"
    volumes:
      - ./apps/gui:/usr/share/nginx/html
      - ./ops/nginx.gui.conf:/etc/nginx/conf.d/default.conf:ro
    command: ["/bin/sh","-c","chmod +x /usr/share/nginx/html/start.sh; /usr/share/nginx/html/start.sh"]
"@
[IO.File]::WriteAllText((Join-Path $PWD 'docker-compose.gui.yaml'), ($override -replace "`r`n","`n"), $enc)

# 4) Make sure the GUI assets exist (simple shell + runtime config)
if (!(Test-Path 'apps/gui')) { New-Item -ItemType Directory 'apps/gui' -Force | Out-Null }

# start.sh creates config.js from env and runs nginx in foreground
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
[IO.File]::WriteAllText((Join-Path $PWD 'apps/gui/start.sh'), ($startSh -replace "`r`n","`n"), $enc)

# minimal index + app.js so the container serves something
if (!(Test-Path 'apps/gui/index.html')) {
  $idx = @'
<!doctype html><meta charset="utf-8"/>
<title>APGMS Customer Portal</title>
<script src="/config.js" defer></script>
<script src="/app.js" defer></script>
<div id="app" style="font:14px system-ui;padding:24px">Loading…</div>
'@
  [IO.File]::WriteAllText((Join-Path $PWD 'apps/gui/index.html'), ($idx -replace "`r`n","`n"), $enc)
}
$app = @'
(()=>{ const a=document.getElementById("app");
  const c=window.GUI_CONFIG||{};
  a.innerHTML=`<h1 style="margin:0 0 8px 0">${c.brand||"APGMS Normalizer"}</h1>
  <p>${c.title||"Customer Portal"}</p>
  <p><a href="${c.swaggerPath||"/api/openapi.json"}" target="_blank">OpenAPI</a></p>`;
})();
'@
[IO.File]::WriteAllText((Join-Path $PWD 'apps/gui/app.js'), ($$app -replace "`r`n","`n"), $enc)

# 5) Validate the merged compose (catches YAML errors before we run)
docker compose -f $composeMain -f docker-compose.gui.yaml config | Out-Null

# 6) Recreate GUI cleanly
docker compose -f $composeMain -f docker-compose.gui.yaml down -v --remove-orphans
docker compose -f $composeMain -f docker-compose.gui.yaml up -d --force-recreate
Start-Sleep -Seconds 2

# 7) Quick sanity: show mounts & nginx config location
Write-Host "`nMounts for gui container:"
docker inspect apgms-final-gui-1 --format '{{range .Mounts}}{{println .Source "->" .Destination}}{{end}}'
Write-Host "`nRecent logs:"
docker compose -f $composeMain -f docker-compose.gui.yaml logs --tail=80 gui

# 8) Open the portal
Start-Process "http://localhost:$guiPort/#/home"
