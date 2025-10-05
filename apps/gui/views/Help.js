export default async function Help(root){
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">Help</h2>
    <div class="mt-3 space-y-4 text-sm text-gray-700 leading-6">
      <div>
        <div class="font-medium">What does this tool do?</div>
        <div>It cleans your data so names, dates, and other details follow the same format every time.</div>
      </div>
      <div>
        <div class="font-medium">Quick start</div>
        <ol class="list-decimal ml-5 space-y-1">
          <li>Go to <span class="font-medium">Import Data</span>.</li>
          <li>Try the example first, then upload your file.</li>
          <li>Open <span class="font-medium">History</span> or <span class="font-medium">See Results</span> to view the outcome.</li>
        </ol>
      </div>
      <div>
        <div class="font-medium">Trouble reaching the service?</div>
        <div>If you see â€œOfflineâ€, please check your internet and try again. If it keeps happening, close and reopen the app.</div>
      </div>
      <div>
        <a class="text-sky-700 hover:underline" href="/api/docs" target="_blank">Technical docs (optional)</a>
      </div>
    </div>
  </section>`;
}