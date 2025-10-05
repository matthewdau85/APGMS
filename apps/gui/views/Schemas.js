import { api, pretty } from "../lib/utils.js";

export default async function Schemas(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-5">
    <h2 class="text-lg font-semibold">Schemas</h2>
    <div class="mt-3 flex gap-2">
      <button id="btnReload" class="px-3 py-2 rounded bg-gray-900 text-white text-sm">Reload</button>
    </div>
    <ul id="list" class="mt-3 space-y-2 text-sm"></ul>
    <pre id="view" class="mt-3 text-xs bg-gray-50 p-2 rounded h-96 overflow-auto"></pre>
  </section>`;

  const list = document.getElementById("list");
  document.getElementById("btnReload").onclick = load;
  load();

  async function load(){
    list.innerHTML = "<li>Loadingâ€¦</li>";
    const { ok, body } = await api("/schemas");
    if (ok && Array.isArray(body)) {
      list.innerHTML = "";
      for (const s of body) {
        const li = document.createElement("li");
        li.innerHTML = `<a href="#" class="text-blue-600 hover:underline" data-id="${s.id||s.name}">${s.name||s.id}</a>`;
        list.appendChild(li);
      }
    } else list.innerHTML = "<li>None</li>";
  }

  list.addEventListener("click", async (e)=>{
    const a = e.target.closest("a"); if (!a) return;
    e.preventDefault();
    const id = a.dataset.id;
    const r = await api(`/schemas/${encodeURIComponent(id)}`);
    document.getElementById("view").textContent = r.ok ? pretty(r.body) : `// HTTP ${r.status}\n`+(r.raw||"");
  });
}