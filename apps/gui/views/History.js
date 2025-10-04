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