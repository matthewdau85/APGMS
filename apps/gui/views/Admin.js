import { loadLocal, saveLocal, toast } from "../lib/utils.js";

export default async function Admin(root){
  const cfg = window.GUI_CONFIG || {};
  const saved = loadLocal("customer_gui_settings", {});
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-5">
    <h2 class="text-lg font-semibold">Settings</h2>
    <div class="grid md:grid-cols-2 gap-4 mt-3">
      <label class="text-sm">Brand<input id="sBrand" class="mt-1 w-full border rounded px-3 py-2" value="${saved.brand ?? cfg.brand ?? ""}"/></label>
      <label class="text-sm">Title<input id="sTitle" class="mt-1 w-full border rounded px-3 py-2" value="${saved.title ?? cfg.title ?? ""}"/></label>
      <label class="text-sm col-span-full">API Base<input id="sBase" class="mt-1 w-full border rounded px-3 py-2" value="${saved.baseUrl ?? cfg.baseUrl ?? "/api"}"/></label>
    </div>
    <div class="mt-3">
      <button id="save" class="px-3 py-1.5 rounded bg-blue-600 text-white text-sm">Save</button>
      <button id="reset" class="px-3 py-1.5 rounded bg-gray-200 text-gray-900 text-sm">Reset</button>
    </div>
    <p class="text-xs text-gray-500 mt-2">Saved values apply immediately (client-side); refresh to re-run with start-time config.</p>
  </section>`;

  const getVals = () => ({
    brand: document.getElementById("sBrand").value,
    title: document.getElementById("sTitle").value,
    baseUrl: document.getElementById("sBase").value
  });

  document.getElementById("save").onclick = ()=>{
    const v = getVals(); saveLocal("customer_gui_settings", v);
    window.GUI_CONFIG = { ...(window.GUI_CONFIG||{}), ...v };
    document.getElementById("brand").textContent = v.brand || "APGMS Normalizer";
    document.getElementById("brandFoot").textContent = v.brand || "APGMS Normalizer";
    document.getElementById("title").textContent = v.title || "Customer Portal";
    toast("Saved");
  };
  document.getElementById("reset").onclick = ()=>{
    localStorage.removeItem("customer_gui_settings"); toast("Reset");
  };
}