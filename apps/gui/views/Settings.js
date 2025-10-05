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