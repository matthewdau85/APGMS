import { api, pretty, toast } from "../lib/utils.js";

export default async function Normalize(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-5">
    <h2 class="text-lg font-semibold">Normalize</h2>
    <p class="text-sm text-gray-600">Send a single event or upload a JSON lines file.</p>
    <div class="mt-4 grid md:grid-cols-2 gap-4">
      <div>
        <label class="text-sm font-medium">Single event (JSON)</label>
        <textarea id="singleEvent" class="mt-1 w-full h-48 border rounded-lg px-3 py-2 font-mono text-sm">{}</textarea>
        <button id="btnSendEvent" class="mt-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm">Send</button>
      </div>
      <div>
        <label class="text-sm font-medium">Bulk file (.jsonl)</label>
        <input id="fileInput" type="file" accept=".jsonl" class="mt-1 w-full border rounded-lg px-3 py-2"/>
        <button id="btnUpload" class="mt-2 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm">Upload</button>
        <div class="text-xs text-gray-500 mt-1">Expects one JSON object per line.</div>
      </div>
    </div>
    <div class="mt-4">
      <label class="text-sm font-medium">Response</label>
      <pre id="respView" class="mt-1 w-full h-64 border rounded-lg px-3 py-2 font-mono text-sm overflow-auto bg-gray-50"></pre>
    </div>
  </section>`;

  document.getElementById("btnSendEvent").onclick = async () => {
    const out = document.getElementById("respView"); out.textContent = "Sendingâ€¦";
    let body = document.getElementById("singleEvent").value.trim() || "{}";
    try { JSON.parse(body); } catch { out.textContent = "Body must be valid JSON"; return; }
    const { ok, status, raw } = await api("/normalize", { method:"POST", headers:{"Content-Type":"application/json"}, body });
    out.textContent = `// HTTP ${status}\n` + (raw||"");
    toast(ok?"Sent":"Failed", ok);
  };

  document.getElementById("btnUpload").onclick = async () => {
    const out = document.getElementById("respView"); const f = document.getElementById("fileInput").files[0];
    if (!f) { out.textContent = "Pick a .jsonl file"; return; }
    out.textContent = "Uploadingâ€¦";
    const fd = new FormData(); fd.append("file", f, f.name);
    const { ok, status, raw } = await api("/normalize/bulk", { method:"POST", body: fd });
    out.textContent = `// HTTP ${status}\n` + (raw||"");
    toast(ok?"Uploaded":"Failed", ok);
  };
}