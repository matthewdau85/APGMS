import { api, pretty, toast } from "../lib/utils.js";

export default async function Rules(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-5">
    <h2 class="text-lg font-semibold">Rules</h2>
    <div class="mt-3 flex gap-2">
      <button id="btnReload" class="px-3 py-2 rounded bg-gray-900 text-white text-sm">Reload</button>
      <button id="btnCreate" class="px-3 py-2 rounded bg-blue-600 text-white text-sm">Create</button>
    </div>
    <table class="mt-3 w-full text-sm">
      <thead><tr class="text-left text-gray-500"><th class="py-2">Name</th><th>Version</th><th>Updated</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <dialog id="dlg" class="p-0 rounded-xl">
      <form method="dialog" class="p-4 w-[560px] max-w-[95vw]">
        <h3 class="text-base font-semibold">Rule</h3>
        <label class="block mt-2 text-sm">Name<input id="rName" class="mt-1 w-full border rounded px-2 py-1"/></label>
        <label class="block mt-2 text-sm">JSON<textarea id="rBody" class="mt-1 w-full h-48 border rounded px-2 py-1 font-mono text-xs">{}</textarea></label>
        <div class="mt-3 flex gap-2 justify-end">
          <button id="save" value="save" class="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">Save</button>
          <button id="cancel" value="cancel" class="px-3 py-1.5 rounded bg-gray-200 text-gray-900 text-sm">Cancel</button>
        </div>
      </form>
    </dialog>
  </section>`;

  const rows = document.getElementById("rows");
  async function reload(){
    rows.innerHTML = "";
    const { ok, body } = await api("/rules");
    if (ok && Array.isArray(body)) {
      for (const r of body) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td class="py-1">${r.name||"â€”"}</td><td>${r.version??"â€”"}</td><td>${r.updated_at||"â€”"}</td>
        <td class="space-x-3">
          <a href="#" data-name="${r.name}" class="text-blue-600 act-edit">Edit</a>
          <a href="#" data-name="${r.name}" class="text-red-600 act-del">Delete</a>
        </td>`;
        rows.appendChild(tr);
      }
    } else {
      rows.innerHTML = `<tr><td class="py-2 text-red-600" colspan="4">No rules</td></tr>`;
    }
  }
  document.getElementById("btnReload").onclick = reload;
  reload();

  const dlg = document.getElementById("dlg");
  document.getElementById("btnCreate").onclick = ()=>{ document.getElementById("rName").value=""; document.getElementById("rBody").value="{}"; dlg.showModal(); };

  rows.addEventListener("click", async (e)=>{
    const a = e.target.closest("a"); if (!a) return;
    e.preventDefault();
    const name = a.dataset.name;
    if (a.classList.contains("act-edit")) {
      const r = await api(`/rules/${encodeURIComponent(name)}`);
      document.getElementById("rName").value = name;
      document.getElementById("rBody").value = pretty(r.body||{});
      dlg.showModal();
    } else if (a.classList.contains("act-del")) {
      if (!confirm(`Delete rule "${name}"?`)) return;
      const d = await api(`/rules/${encodeURIComponent(name)}`, { method:"DELETE" });
      toast(d.ok?"Deleted":"Failed", d.ok); reload();
    }
  });

  dlg.addEventListener("close", async ()=>{
    if (dlg.returnValue==="save") {
      const name = document.getElementById("rName").value.trim();
      const body = document.getElementById("rBody").value;
      try { JSON.parse(body) } catch { toast("Invalid JSON", false); return; }
      const m = await api(`/rules/${encodeURIComponent(name)}`, { method:"PUT", headers:{ "Content-Type":"application/json" }, body });
      toast(m.ok?"Saved":"Failed", m.ok); reload();
    }
  });
}