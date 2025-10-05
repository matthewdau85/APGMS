import { api, pretty } from "../lib/utils.js";

export default async function Connections(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-5">
    <h2 class="text-lg font-semibold">Connections</h2>
    <p class="text-sm text-gray-600">Messaging / stream backends.</p>
    <div class="mt-3 grid md:grid-cols-2 gap-4">
      <div class="p-4 border rounded-xl"><div class="text-xs text-gray-500">NATS</div><pre id="nats" class="text-xs mt-2 bg-gray-50 p-2 rounded h-60 overflow-auto"></pre></div>
      <div class="p-4 border rounded-xl"><div class="text-xs text-gray-500">Streams</div><pre id="streams" class="text-xs mt-2 bg-gray-50 p-2 rounded h-60 overflow-auto"></pre></div>
    </div>
  </section>`;

  try { const r = await api("/connections/nats"); document.getElementById("nats").textContent = r.ok? pretty(r.body): (r.raw||""); } catch {}
  try { const r = await api("/connections/streams"); document.getElementById("streams").textContent = r.ok? pretty(r.body): (r.raw||""); } catch {}
}