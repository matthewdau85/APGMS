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