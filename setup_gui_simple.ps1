$ErrorActionPreference='Stop'
$enc = New-Object System.Text.UTF8Encoding($false)

function Write-Utf8Lf([string]$Path,[string]$Content){
  $full = Join-Path (Get-Location) $Path
  $dir  = Split-Path $full
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
  $lf = $Content -replace "`r`n","`n"
  [IO.File]::WriteAllText($full,$lf,$enc)
}

# --- Ensure GUI folders exist ---
$root = 'apps/gui'
New-Item -ItemType Directory "$root" -Force | Out-Null
New-Item -ItemType Directory "$root/lib" -Force | Out-Null
New-Item -ItemType Directory "$root/views" -Force | Out-Null
New-Item -ItemType Directory "$root/assets" -Force | Out-Null

# --- Gentle logo ---
Write-Utf8Lf "$root/assets/logo.svg" @'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true">
<rect width="64" height="64" rx="12" fill="#0ea5e9"/><path d="M14 34l10 10 26-26" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
'@

# --- Runtime config (kept simple; start.sh will still override at runtime) ---
Write-Utf8Lf "$root/config.js" @'
window.GUI_CONFIG = {
  brand: "APGMS Normalizer",
  title: "Customer Portal",
  baseUrl: "/api",
  links: { docs: "/api/docs" }
};
'@

# --- Utils: plain messages + simple API wrapper ---
Write-Utf8Lf "$root/lib/utils.js" @'
export const $ = (sel, root=document) => root.querySelector(sel);
export const pretty = (v)=>{ try{ return JSON.stringify(typeof v==="string"?JSON.parse(v):v,null,2)}catch{ return String(v)}};
export const say = (msg, ok=true) => {
  const t = $("#toast"); if(!t) return;
  t.textContent = msg;
  t.className = "fixed bottom-4 right-4 text-white text-sm px-3 py-2 rounded-lg " + (ok?"bg-black":"bg-rose-600");
  t.classList.remove("hidden");
  setTimeout(()=>t.classList.add("hidden"),2200);
};
export const api = async (path, opts={})=>{
  const base = (window.GUI_CONFIG?.baseUrl||"/api").replace(/\/+$/,"");
  const res  = await fetch(base+path, opts);
  const txt  = await res.text();
  let body; try{ body = JSON.parse(txt) }catch{ body = txt }
  return { ok: res.ok, status: res.status, body, raw: txt };
};
'@

# --- Router (hash) ---
Write-Utf8Lf "$root/lib/router.js" @'
const subs = new Set();
export const goto = (hash)=>{ location.hash = hash };
export const onRoute = (fn)=>{ subs.add(fn); return ()=>subs.delete(fn) };
const emit=()=>{ const p=(location.hash||"#/").replace(/^#/,""); subs.forEach(fn=>fn(p)) };
addEventListener("hashchange",emit);
export const start = ()=>{ if(!location.hash) location.hash="#/"; emit(); };
'@

# --- Index: simple nav & language ---
Write-Utf8Lf "$root/index.html" @'
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title id="title">Customer Portal</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="/config.js"></script>
  <script type="module" defer src="/main.js"></script>
</head>
<body class="bg-sky-50 text-gray-900">
  <header class="bg-white border-b">
    <div class="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
      <img src="/assets/logo.svg" class="h-8 w-8" alt="" />
      <div>
        <h1 id="brand" class="text-xl font-semibold">APGMS Normalizer</h1>
        <p class="text-sm text-gray-500">Make your files tidy and ready to use.</p>
      </div>
      <nav class="ml-8 hidden md:flex gap-4 text-sm">
        <a href="#/" class="hover:underline">Home</a>
        <a href="#/import" class="hover:underline">Import Data</a>
        <a href="#/results" class="hover:underline">See Results</a>
        <a href="#/history" class="hover:underline">History</a>
        <a href="#/help" class="hover:underline">Help</a>
        <a href="#/settings" class="hover:underline">Settings</a>
      </nav>
      <span id="svc" class="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-700">Checkingâ€¦</span>
      <a id="docs" href="/api/docs" target="_blank" class="text-sm text-sky-700 hover:underline ml-3">API Docs</a>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 py-6">
    <div id="app"></div>
  </main>

  <div id="toast" class="fixed bottom-4 right-4 hidden"></div>
</body>
</html>
'@

# --- Entry: route registry + friendly status badge ---
Write-Utf8Lf "$root/main.js" @'
import { onRoute, start } from "./lib/router.js";
import { api } from "./lib/utils.js";
import Home from "./views/Home.js";
import Import from "./views/Import.js";
import Results from "./views/Results.js";
import History from "./views/History.js";
import Help from "./views/Help.js";
import Settings from "./views/Settings.js";

const routes = new Map([
  ["/", Home],
  ["/import", Import],
  ["/results", Results],
  ["/history", History],
  ["/help", Help],
  ["/settings", Settings],
]);

function brand(){
  const cfg = window.GUI_CONFIG || {};
  document.getElementById("brand").textContent = cfg.brand || "APGMS Normalizer";
  document.getElementById("title").textContent = cfg.title || "Customer Portal";
  if (cfg.links?.docs) document.getElementById("docs").href = cfg.links.docs;
}
brand();

async function badge(){
  const b = document.getElementById("svc");
  try {
    const r = await fetch((window.GUI_CONFIG?.baseUrl||"/api").replace(/\/+$/,"")+"/readyz",{cache:"no-store"});
    if (r.ok) { b.textContent="Ready"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-800"; }
    else { b.textContent="Not ready"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-rose-100 text-rose-800"; }
  } catch {
    b.textContent="Offline"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-rose-100 text-rose-800";
  }
}
badge();

const app = document.getElementById("app");
onRoute(async p=>{
  app.innerHTML="";
  const View = routes.get(p.split("?")[0]) || Home;
  const el = document.createElement("div");
  el.className="space-y-6";
  app.appendChild(el);
  await View(el);
});
start();
'@

# --- Views: Home (plain language) ---
Write-Utf8Lf "$root/views/Home.js" @'
import { api } from "../lib/utils.js";

export default async function Home(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">Welcome</h2>
    <p class="text-sm text-gray-600 mt-1">This tool cleans your data so it is consistent and easy to use.</p>

    <div class="mt-4 grid md:grid-cols-3 gap-4">
      <a href="#/import" class="block p-4 border rounded-xl hover:bg-sky-50">
        <div class="text-base font-medium">Import Data</div>
        <div class="text-sm text-gray-500 mt-1">Upload a file or try one example.</div>
      </a>
      <a href="#/results" class="block p-4 border rounded-xl hover:bg-sky-50">
        <div class="text-base font-medium">See Results</div>
        <div class="text-sm text-gray-500 mt-1">Look up a job or a single result.</div>
      </a>
      <a href="#/history" class="block p-4 border rounded-xl hover:bg-sky-50">
        <div class="text-base font-medium">History</div>
        <div class="text-sm text-gray-500 mt-1">Recent work at a glance.</div>
      </a>
    </div>

    <div class="mt-6">
      <button id="peek" class="px-3 py-1.5 rounded-lg bg-gray-200 text-gray-900 text-sm">Show a quick status</button>
      <pre id="peekOut" class="mt-3 text-xs bg-gray-50 p-2 rounded hidden"></pre>
    </div>
  </section>
  `;

  document.getElementById("peek").onclick = async ()=>{
    const out = document.getElementById("peekOut");
    out.classList.remove("hidden");
    out.textContent = "Checkingâ€¦";
    try {
      const r = await fetch((window.GUI_CONFIG?.baseUrl||"/api").replace(/\/+$/,"")+"/readyz");
      out.textContent = r.ok ? "All good to go." : "The service is not ready yet.";
    } catch {
      out.textContent = "We could not reach the service. Please check your internet or try again in a minute.";
    }
  };
}
'@

# --- Views: Import (wizard: try one / upload file) ---
Write-Utf8Lf "$root/views/Import.js" @'
import { api, pretty, say } from "../lib/utils.js";

export default async function Import(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">Import Data</h2>
    <p class="text-sm text-gray-600 mt-1">Start small to see how it works, or upload a whole file.</p>

    <div class="mt-4 grid md:grid-cols-2 gap-6">
      <div>
        <div class="text-sm font-medium">Try one example</div>
        <textarea id="one" class="mt-1 w-full h-40 border rounded-lg px-3 py-2 font-mono text-sm">{}</textarea>
        <button id="sendOne" class="mt-2 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm">Run</button>
      </div>

      <div>
        <div class="text-sm font-medium">Upload a file</div>
        <input id="file" type="file" accept=".jsonl" class="mt-1 w-full border rounded-lg px-3 py-2"/>
        <div class="text-xs text-gray-500 mt-1">Use a .jsonl file (one line per item).</div>
        <button id="sendFile" class="mt-2 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm">Upload</button>
      </div>
    </div>

    <div class="mt-4">
      <div class="text-sm font-medium">What happened</div>
      <pre id="out" class="mt-1 w-full h-64 border rounded-lg px-3 py-2 font-mono text-sm overflow-auto bg-gray-50"></pre>
    </div>
  </section>
  `;

  const out = document.getElementById("out");

  document.getElementById("sendOne").onclick = async ()=>{
    out.textContent = "Workingâ€¦";
    const body = document.getElementById("one").value || "{}";
    try { JSON.parse(body) } catch { out.textContent="Please enter valid JSON."; return; }
    const { ok, status, raw } = await api("/normalize", { method:"POST", headers:{ "Content-Type":"application/json" }, body });
    out.textContent = `Status: ${status}\n\n` + (raw||"");
    say(ok? "Done" : "Something didnâ€™t work", ok);
  };

  document.getElementById("sendFile").onclick = async ()=>{
    const f = document.getElementById("file").files[0];
    if (!f) { out.textContent="Please choose a file first."; return; }
    out.textContent = "Uploadingâ€¦";
    const fd = new FormData(); fd.append("file", f, f.name);
    const { ok, status, raw } = await api("/normalize/bulk", { method:"POST", body: fd });
    out.textContent = `Status: ${status}\n\n` + (raw||"");
    say(ok? "Uploaded" : "Upload failed", ok);
  };
}
'@

# --- Views: Results (single look-up) ---
Write-Utf8Lf "$root/views/Results.js" @'
import { api, pretty } from "../lib/utils.js";

export default async function Results(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">See Results</h2>
    <p class="text-sm text-gray-600 mt-1">Paste an ID to view its details. If you just uploaded a file, check History.</p>

    <div class="mt-3 flex gap-2">
      <input id="id" class="border rounded px-3 py-2 text-sm w-80" placeholder="Paste ID here"/>
      <button id="go" class="px-3 py-2 rounded bg-gray-900 text-white text-sm">Open</button>
    </div>
    <pre id="out" class="mt-3 text-xs bg-gray-50 p-2 rounded h-96 overflow-auto"></pre>
  </section>`;

  document.getElementById("go").onclick = async ()=>{
    const id = document.getElementById("id").value.trim();
    if (!id) { document.getElementById("out").textContent="Please paste an ID."; return; }
    let r = await api(`/results/${encodeURIComponent(id)}`);
    if (!r.ok) r = await api(`/jobs/${encodeURIComponent(id)}`);
    document.getElementById("out").textContent = r.ok ? pretty(r.body) : `Status: ${r.status}\n\n`+(r.raw||"");
  };
}
'@

# --- Views: History (simple table) ---
Write-Utf8Lf "$root/views/History.js" @'
import { api } from "../lib/utils.js";

export default async function History(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">History</h2>
    <p class="text-sm text-gray-600 mt-1">Recent work. Click an item to see more.</p>

    <div class="mt-3 flex gap-2">
      <input id="q" class="border rounded px-3 py-2 text-sm w-80" placeholder="Filter by word (optional)"/>
      <button id="reload" class="px-3 py-2 rounded bg-gray-900 text-white text-sm">Refresh</button>
    </div>

    <table class="mt-3 w-full text-sm">
      <thead><tr class="text-left text-gray-500">
        <th class="py-2">ID</th><th>When</th><th>Status</th><th>Items</th><th></th>
      </tr></thead>
      <tbody id="rows"><tr><td class="py-2" colspan="5">Loadingâ€¦</td></tr></tbody>
    </table>
  </section>`;

  async function load(){
    const q = document.getElementById("q").value.trim();
    const res = await api(`/jobs${q?`?q=${encodeURIComponent(q)}`:""}`);
    const rows = document.getElementById("rows"); rows.innerHTML="";
    if (res.ok && Array.isArray(res.body) && res.body.length){
      for (const j of res.body){
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="py-1">${j.id||"â€”"}</td><td>${j.created_at||"â€”"}</td><td>${j.status||"â€”"}</td><td>${j.count??"â€”"}</td>
          <td><a class="text-sky-700 hover:underline" href="#/results">Open</a></td>`;
        rows.appendChild(tr);
      }
    } else {
      rows.innerHTML = `<tr><td class="py-2 text-gray-500" colspan="5">Nothing here yet.</td></tr>`;
    }
  }
  document.getElementById("reload").onclick = load;
  load();
}
'@

# --- Views: Help (non-technical) ---
Write-Utf8Lf "$root/views/Help.js" @'
export default async function Help(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">Help</h2>
    <div class="mt-3 space-y-4 text-sm text-gray-700 leading-6">
      <div>
        <div class="font-medium">What does this tool do?</div>
        <div>It cleans your data so names, dates, and other details follow the same format every time.</div>
      </div>
      <div>
        <div class="font-medium">Quick start</div>
        <ol class="list-decimal ml-5 space-y-1">
          <li>Go to <span class="font-medium">Import Data</span>.</li>
          <li>Try the example first, then upload your file.</li>
          <li>Open <span class="font-medium">History</span> or <span class="font-medium">See Results</span> to view the outcome.</li>
        </ol>
      </div>
      <div>
        <div class="font-medium">Trouble reaching the service?</div>
        <div>If you see â€œOfflineâ€, please check your internet and try again. If it keeps happening, close and reopen the app.</div>
      </div>
      <div>
        <a class="text-sky-700 hover:underline" href="/api/docs" target="_blank">Technical docs (optional)</a>
      </div>
    </div>
  </section>`;
}
'@

# --- Views: Settings (simple) ---
Write-Utf8Lf "$root/views/Settings.js" @'
export default async function Settings(root){
  const cfg = window.GUI_CONFIG||{};
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">Settings</h2>
    <p class="text-sm text-gray-600 mt-1">You can change the look and where the app connects.</p>
    <div class="grid md:grid-cols-2 gap-4 mt-3">
      <label class="text-sm">Brand name
        <input id="brandIn" class="mt-1 w-full border rounded px-3 py-2" value="${cfg.brand||"APGMS Normalizer"}"/>
      </label>
      <label class="text-sm">App title
        <input id="titleIn" class="mt-1 w-full border rounded px-3 py-2" value="${cfg.title||"Customer Portal"}"/>
      </label>
      <label class="text-sm col-span-full">API address
        <input id="baseIn" class="mt-1 w-full border rounded px-3 py-2" value="${cfg.baseUrl||"/api"}"/>
      </label>
    </div>
    <div class="mt-3">
      <button id="save" class="px-3 py-1.5 rounded bg-sky-600 text-white text-sm">Save</button>
    </div>
    <p class="text-xs text-gray-500 mt-2">Changes apply immediately in this browser.</p>
  </section>`;

  document.getElementById("save").onclick = ()=>{
    window.GUI_CONFIG = {
      ...window.GUI_CONFIG,
      brand: document.getElementById("brandIn").value,
      title: document.getElementById("titleIn").value,
      baseUrl: document.getElementById("baseIn").value
    };
    document.getElementById("brand").textContent = window.GUI_CONFIG.brand;
    document.getElementById("title").textContent = window.GUI_CONFIG.title;
  };
}
'@

# --- Keep start.sh (runtime config generator) if missing ---
if (!(Test-Path "$root/start.sh")){
  Write-Utf8Lf "$root/start.sh" @'
#!/bin/sh
set -eu
cat >/usr/share/nginx/html/config.js <<CFG
window.GUI_CONFIG = {
  brand: "${GUI_BRAND:-APGMS Normalizer}",
  title: "${GUI_TITLE:-Customer Portal}",
  baseUrl: "${GUI_BASE_URL:-/api}",
  links: { docs: "${GUI_DOCS_LINK:-/api/docs}" }
};
CFG
exec nginx -g "daemon off;";
'@
}

# --- Bring (or re-bring) the GUI up on the existing override (8088) ---
$composeMain = if (Test-Path 'docker-compose.yml') { 'docker-compose.yml' } elseif (Test-Path 'docker-compose.yaml') { 'docker-compose.yaml' } else { throw 'No docker-compose file found.' }
$override = 'docker-compose.gui.yaml'
if (!(Test-Path $override)) {
  # minimal override in case it was deleted
  Write-Utf8Lf $override @'
services:
  gui:
    image: nginx:alpine
    depends_on: [normalizer]
    ports: ["8088:80"]
    volumes:
      - ./apps/gui:/usr/share/nginx/html
      - ./ops/nginx.gui.conf:/etc/nginx/conf.d/apgms.conf:ro
    command: /bin/sh -c "chmod +x /usr/share/nginx/html/start.sh && /usr/share/nginx/html/start.sh"
'@
}

# Validate + start
docker compose -f $composeMain -f $override config | Out-Null
docker compose -f $composeMain -f $override up -d --force-recreate --remove-orphans | Out-Null
Start-Sleep -Seconds 2
Write-Host "Open: http://localhost:8088"
try { Start-Process 'http://localhost:8088' } catch {}

