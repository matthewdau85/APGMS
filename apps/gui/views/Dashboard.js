import { api, pretty } from "../lib/utils.js";

export default async function Dashboard(root){
  root.innerHTML = `
    <section class="bg-white rounded-2xl shadow p-5">
      <h2 class="text-lg font-semibold">Overview</h2>
      <p class="text-sm text-gray-600">Service status, quick stats & shortcuts.</p>
      <div class="mt-4 grid md:grid-cols-3 gap-4" id="cards">
        <div class="p-4 border rounded-xl"><div class="text-xs text-gray-500">Health</div><div id="card-health" class="text-2xl">â€“</div></div>
        <div class="p-4 border rounded-xl"><div class="text-xs text-gray-500">Jobs (24h)</div><div id="card-jobs" class="text-2xl">â€“</div></div>
        <div class="p-4 border rounded-xl"><div class="text-xs text-gray-500">Success rate</div><div id="card-success" class="text-2xl">â€“</div></div>
      </div>
      <div class="mt-4">
        <button id="btnMetrics" class="px-3 py-1.5 rounded-lg bg-gray-200 text-gray-900 text-sm">Preview metrics</button>
        <pre id="metricsPreview" class="mt-3 text-xs bg-gray-50 p-2 rounded hidden"></pre>
      </div>
    </section>
  `;

  document.getElementById("btnMetrics").onclick = async ()=>{
    const pre = document.getElementById("metricsPreview");
    pre.classList.remove("hidden"); pre.textContent = "Loadingâ€¦";
    try { const r = await api("/metrics"); pre.textContent = typeof r.body==="string"? r.body : pretty(r.body); }
    catch { pre.textContent = "Failed to fetch /metrics"; }
  };

  // Optional stats endpoints (/jobs/summary is hypothetical â€“ adjust to your API)
  try {
    const ready = await fetch((window.GUI_CONFIG?.baseUrl||"/api").replace(/\/+$/,"")+"/readyz");
    document.getElementById("card-health").textContent = ready.ok ? "Ready" : "Not Ready";
  } catch { document.getElementById("card-health").textContent = "Unreachable"; }

  try {
    const { ok, body } = await api("/jobs/summary?range=24h");
    if (ok && body) {
      document.getElementById("card-jobs").textContent = body.total ?? "â€“";
      const rate = body.success_rate!=null ? Math.round(body.success_rate*100)+"%" : "â€“";
      document.getElementById("card-success").textContent = rate;
    }
  } catch {}
}