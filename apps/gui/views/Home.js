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