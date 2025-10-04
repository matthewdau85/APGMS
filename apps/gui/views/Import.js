import { api, pretty, say } from "../lib/utils.js";

export default async function Import(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">Import Data</h2>
    <p class="text-sm text-gray-600 mt-1">Start small to see how it works, or upload a whole file.</p>

    <div class="mt-4 grid md:grid-cols-2 gap-6">
      <div>
        <div class="text-sm font-medium">Try one example</div>
        <textarea id="one" class="mt-1 w-full h-40 border rounded-lg px-3 py-2 font-mono text-sm">{}</textarea>
        <button id="sendOne" class="mt-2 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm">Run</button>
      </div>

      <div>
        <div class="text-sm font-medium">Upload a file</div>
        <input id="file" type="file" accept=".jsonl" class="mt-1 w-full border rounded-lg px-3 py-2"/>
        <div class="text-xs text-gray-500 mt-1">Use a .jsonl file (one line per item).</div>
        <button id="sendFile" class="mt-2 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-sm">Upload</button>
      </div>
    </div>

    <div class="mt-4">
      <div class="text-sm font-medium">What happened</div>
      <pre id="out" class="mt-1 w-full h-64 border rounded-lg px-3 py-2 font-mono text-sm overflow-auto bg-gray-50"></pre>
    </div>
  </section>
  `;

  const out = document.getElementById("out");

  document.getElementById("sendOne").onclick = async ()=>{
    out.textContent = "Workingâ€¦";
    const body = document.getElementById("one").value || "{}";
    try { JSON.parse(body) } catch { out.textContent="Please enter valid JSON."; return; }
    const { ok, status, raw } = await api("/normalize", { method:"POST", headers:{ "Content-Type":"application/json" }, body });
    out.textContent = `Status: ${status}\n\n` + (raw||"");
    say(ok? "Done" : "Something didnâ€™t work", ok);
  };

  document.getElementById("sendFile").onclick = async ()=>{
    const f = document.getElementById("file").files[0];
    if (!f) { out.textContent="Please choose a file first."; return; }
    out.textContent = "Uploadingâ€¦";
    const fd = new FormData(); fd.append("file", f, f.name);
    const { ok, status, raw } = await api("/normalize/bulk", { method:"POST", body: fd });
    out.textContent = `Status: ${status}\n\n` + (raw||"");
    say(ok? "Uploaded" : "Upload failed", ok);
  };
}