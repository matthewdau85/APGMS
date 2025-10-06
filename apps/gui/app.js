(() => {
  const cfg = window.GUI_CONFIG || {};
  const base = (cfg.baseUrl || "/api").replace(/\/+$/, "");
  const mlBase = (cfg.mlBaseUrl || base).replace(/\/+$/, "");
  const $ = (sel, root=document) => root.querySelector(sel);

  const routes = ["home","connections","transactions","tax-bas","help","settings"];
  function currentRoute(){ const h = location.hash.replace(/^#\/?/, "").toLowerCase(); return routes.includes(h) ? h : "home"; }
  window.addEventListener("hashchange", () => render());

  async function api(path, init={}) {
    const r = await fetch(base + path, { headers: { "Content-Type":"application/json" }, ...init });
    if (!r.ok) throw new Error(String(r.status));
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  async function mlApi(path, init={}) {
    const r = await fetch(mlBase + path, { headers: { "Content-Type":"application/json" }, ...init });
    if (!r.ok) {
      const msg = await r.text();
      throw new Error(msg || String(r.status));
    }
    return r.json();
  }

  const View = {
    nav(active){
      return `
        <nav aria-label="Primary">
          <a href="#/home"        class="${active==='home'?'active':''}">Home</a>
          <a href="#/connections" class="${active==='connections'?'active':''}">Connections</a>
          <a href="#/transactions"class="${active==='transactions'?'active':''}">Transactions</a>
          <a href="#/tax-bas"     class="${active==='tax-bas'?'active':''}">Tax & BAS</a>
          <a href="#/help"        class="${active==='help'?'active':''}">Help</a>
          <a href="#/settings"    class="${active==='settings'?'active':''}">Settings</a>
        </nav>`;
    },

    home(){
      return `
        ${this.nav('home')}
        <header>
          <h1>${cfg.brand || "APGMS Normalizer"}</h1>
          <p>${cfg.title || "Customer Portal"}</p>
        </header>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); margin-top:12px">
          <div class="card">
            <h3>Service</h3>
            <button class="btn" id="btnReady">Check Ready</button>
            <button class="btn" id="btnMetrics">Metrics</button>
            <pre id="svcOut" style="margin-top:8px;max-height:220px;overflow:auto"></pre>
          </div>
          <div class="card">
            <h3>Yesterday at a glance</h3>
            <div id="yesterday">Loading...</div>
          </div>
          <div class="card">
            <h3>Normalize a file</h3>
            <input id="file" type="file" accept=".csv,.json" />
            <button class="btn" id="btnUpload">Upload & Normalize</button>
            <pre id="normOut" style="margin-top:8px;max-height:220px;overflow:auto"></pre>
          </div>
        </div>
        <div class="footer">OpenAPI: <a target="_blank" href="${cfg.swaggerPath || '/api/openapi.json'}">${cfg.swaggerPath || '/api/openapi.json'}</a></div>
      `;
    },

    connections(){
      return `
        ${this.nav('connections')}
        <div class="grid" style="grid-template-columns:2fr 1fr; margin-top:12px">
          <div class="card">
            <h3>Connected sources</h3>
            <table id="connTable"><thead><tr><th>Type</th><th>Provider</th><th>Status</th><th></th></tr></thead><tbody></tbody></table>
          </div>
          <div class="card">
            <h3>Add connection</h3>
            <label for="connType">Type</label>
            <select id="connType">
              <option value="bank">Bank (CDR/Open Banking)</option>
              <option value="payroll">Payroll</option>
              <option value="pos">POS / Commerce</option>
              <option value="ato">ATO (SBR/BAS/STP)</option>
            </select>
            <label for="provider">Provider</label>
            <select id="provider">
              <option value="basiq">Basiq</option>
              <option value="truelayer">TrueLayer</option>
              <option value="square">Square</option>
              <option value="shopify">Shopify</option>
              <option value="xero">Xero</option>
              <option value="myob">MYOB</option>
              <option value="messagexchange">MessageXchange (SBR)</option>
              <option value="ozedi">Ozedi (SBR)</option>
            </select>
            <button class="btn" id="btnConnect">Connect</button>
            <div id="connMsg" style="margin-top:8px"></div>
          </div>
        </div>
      `;
    },

    transactions(){
      return `
        ${this.nav('transactions')}
        <div class="grid" style="grid-template-columns:2fr 1fr; margin-top:12px">
          <div class="card">
            <h3>Transactions</h3>
            <div style="display:flex; gap:8px; margin-bottom:8px">
              <input id="q" placeholder="Search description or ref" />
              <select id="filterSource"><option value="">All sources</option></select>
              <button class="btn" id="btnRefresh">Refresh</button>
            </div>
            <table id="txTable"><thead><tr><th>Date</th><th>Source</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead><tbody></tbody></table>
          </div>
          <div class="card" id="mlAssistCard">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px">
              <h3 style="margin:0">ML Assisted Matching</h3>
              <span class="badge badge-advisory" aria-label="Advisory only">Advisory</span>
            </div>
            <p class="muted" style="margin:8px 0 12px">Suggestions require operator confirmation before any action.</p>
            <div class="muted" style="margin-bottom:6px">Confidence: <span id="mlConfidence">-</span></div>
            <pre id="mlAssistOutput" style="margin:0 0 12px;max-height:180px;overflow:auto">No suggestions yet.</pre>
            <div style="display:flex; flex-wrap:wrap; gap:8px">
              <button class="btn" id="btnMlRefresh">Get suggestions</button>
              <button class="btn" id="btnMlAccept" disabled>Confirm match</button>
              <button class="btn" id="btnMlOverride" disabled>Override</button>
            </div>
            <div id="mlDecisionMsg" class="muted" style="margin-top:8px"></div>
          </div>
        </div>
      `;
    },

    "tax-bas"(){
      return `
        ${this.nav('tax-bas')}
        <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
          <div class="card">
            <h3>BAS Preparation</h3>
            <button class="btn" id="btnPreviewBas">Preview BAS (draft)</button>
            <pre id="basOut" style="margin-top:8px;max-height:260px;overflow:auto"></pre>
          </div>
          <div class="card">
            <h3>ATO Lodgement</h3>
            <p>Status: <span id="atoStatus">Unknown</span></p>
            <button class="btn" id="btnValidateBas">Validate with ATO (SBR)</button>
            <button class="btn" id="btnLodgeBas">Lodge BAS</button>
            <div id="lodgeMsg" style="margin-top:8px"></div>
          </div>
        </div>
      `;
    },

    help(){
      return `
        ${this.nav('help')}
        <div class="card">
          <h3>Help & Guidance</h3>
          <ol>
            <li>Use <b>Connections</b> to link Bank (CDR), Payroll/POS, and ATO (SBR).</li>
            <li>Import or auto-ingest data; view in <b>Transactions</b>.</li>
            <li>Prepare and validate <b>Tax & BAS</b>; lodge via SBR when ready.</li>
            <li>See <span class="kbd">/api/openapi.json</span> for API details.</li>
          </ol>
        </div>
      `;
    },

    settings(){
      return `
        ${this.nav('settings')}
        <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
          <div class="card">
            <h3>Appearance</h3>
            <label for="theme">Theme</label>
            <select id="theme">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div class="card">
            <h3>Compliance</h3>
            <label>Retention Period (months)</label>
            <input id="retention" type="number" min="0" value="84" />
            <label>PII Masking</label>
            <select id="pii"><option value="on">On</option><option value="off">Off</option></select>
            <button class="btn" id="btnSaveSettings" style="margin-top:8px">Save</button>
            <div id="saveMsg" style="margin-top:8px"></div>
          </div>
        </div>
      `;
    }
  };

  async function wire(view) {
    if (view==='home') {
      $('#btnReady')?.addEventListener('click', async () => {
        const pre = $('#svcOut'); pre.textContent = 'Checking...';
        try { const r = await fetch(base+'/readyz'); pre.textContent = 'HTTP ' + r.status; } catch { pre.textContent = 'Unreachable'; }
      });
      $('#btnMetrics')?.addEventListener('click', async () => {
        const pre = $('#svcOut'); pre.textContent = 'Loading metrics...';
        try { pre.textContent = await (await fetch(base+'/metrics')).text(); } catch { pre.textContent = 'Failed'; }
      });
      $('#btnUpload')?.addEventListener('click', async () => {
        const f = $('#file').files[0], out = $('#normOut'); if(!f){ alert('Choose a file'); return; }
        const text = await f.text();
        const payload = text.trim().startsWith('{') || text.trim().startsWith('[') ? JSON.parse(text) : { csv: text };
        out.textContent = 'Uploading...';
        try {
          const res = await api('/normalize', { method:'POST', body: JSON.stringify(payload) });
          out.textContent = JSON.stringify(res, null, 2);
        } catch(e){ out.textContent = 'Failed: ' + e.message; }
      });
      try { const y = await api('/dashboard/yesterday'); $('#yesterday').textContent = JSON.stringify(y); } catch { $('#yesterday').textContent='N/A'; }
    }

    if (view==='connections') {
      async function loadList(){
        const rows = await api('/connections');
        const tb = $('#connTable tbody'); tb.innerHTML = '';
        rows.forEach(x=>{
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${x.type}</td><td>${x.provider}</td><td>${x.status}</td><td><button class="btn" data-id="${x.id}">Remove</button></td>`;
          tb.appendChild(tr);
        });
        tb.querySelectorAll('button').forEach(btn=>{
          btn.onclick = async () => { await api(`/connections/${btn.dataset.id}`, { method:'DELETE' }); loadList(); };
        });
      }
      $('#btnConnect').onclick = async () => {
        $('#connMsg').textContent = 'Starting connection...';
        const type = $('#connType').value, provider = $('#provider').value;
        try {
          const { url } = await api('/connections/start', { method:'POST', body: JSON.stringify({ type, provider }) });
          $('#connMsg').innerHTML = `Open auth window: <a target="_blank" href="${url}">${url}</a>`;
        } catch(e){ $('#connMsg').textContent = 'Failed: ' + e.message; }
      };
      loadList();
    }

    if (view==='transactions') {
      let currentSuggestion = null;

      async function load() {
        const q = $('#q').value, src = $('#filterSource').value;
        const data = await api(`/transactions?q=${encodeURIComponent(q||'')}&source=${encodeURIComponent(src||'')}`);
        const tb = $('#txTable tbody'); tb.innerHTML='';
        data.items.forEach(t=>{
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${t.date}</td><td>${t.source}</td><td>${t.description}</td><td style="text-align:right">${t.amount.toFixed(2)}</td><td>${t.category||''}</td>`;
          tb.appendChild(tr);
        });
        const sel = $('#filterSource'); sel.innerHTML = '<option value="">All sources</option>';
        data.sources.forEach(s=>{ const o = document.createElement('option'); o.value=s; o.textContent=s; sel.appendChild(o); });
      }

      async function runAssist() {
        const out = $('#mlAssistOutput');
        const confidence = $('#mlConfidence');
        const acceptBtn = $('#btnMlAccept');
        const overrideBtn = $('#btnMlOverride');
        const msg = $('#mlDecisionMsg');
        acceptBtn.disabled = true;
        overrideBtn.disabled = true;
        msg.textContent = '';
        out.textContent = 'Requesting advisory match...';
        try {
          const payload = {
            context_id: 'demo-context',
            bank_lines: [
              { line_id: 'bank-1', posted_at: new Date().toISOString(), amount: 245.72, description: 'Supplier payment' },
              { line_id: 'bank-2', posted_at: new Date().toISOString(), amount: 110.00, description: 'Office supplies' }
            ],
            ledger_entries: [
              { entry_id: 'ledger-1001', booked_at: new Date().toISOString(), amount: 245.72, account_code: '200-AP', memo: 'Payable match' },
              { entry_id: 'ledger-1002', booked_at: new Date().toISOString(), amount: 109.95, account_code: '620-Office', memo: 'Stationery' }
            ]
          };
          const result = await mlApi('/recon/match', { method: 'POST', body: JSON.stringify(payload) });
          currentSuggestion = result;
          confidence.textContent = typeof result.confidence === 'number' ? `${Math.round(result.confidence * 100)}%` : 'N/A';
          out.textContent = JSON.stringify(result.suggestion.matches, null, 2);
          acceptBtn.disabled = false;
          overrideBtn.disabled = false;
        } catch (e) {
          currentSuggestion = null;
          confidence.textContent = '-';
          out.textContent = 'Failed: ' + e.message;
        }
      }

      async function recordDecision(decision) {
        if (!currentSuggestion?.suggestion?.request_hash) {
          return;
        }
        const msg = $('#mlDecisionMsg');
        msg.textContent = 'Recording decision...';
        try {
          await api('/ml/decisions', {
            method: 'POST',
            body: JSON.stringify({
              endpoint: '/ml/recon/match',
              request_hash: currentSuggestion.suggestion.request_hash,
              response: currentSuggestion,
              user_decision: decision,
              decided_by: cfg.operator || 'operator'
            })
          });
          msg.textContent = decision === 'accept' ? 'Decision logged: accepted advisory suggestion.' : 'Decision logged: override recorded.';
          $('#btnMlAccept').disabled = true;
          $('#btnMlOverride').disabled = true;
        } catch (e) {
          msg.textContent = 'Failed to log decision: ' + e.message;
        }
      }

      $('#btnRefresh').onclick = () => { load(); };
      $('#btnMlRefresh').onclick = () => { runAssist(); };
      $('#btnMlAccept').onclick = () => recordDecision('accept');
      $('#btnMlOverride').onclick = () => recordDecision('override');

      load();
      runAssist();
    }

    if (view==='tax-bas') {
      $('#btnPreviewBas').onclick = async () => {
        const out = $('#basOut'); out.textContent='Calculating...';
        try { out.textContent = JSON.stringify(await api('/bas/preview'), null, 2); } catch(e){ out.textContent='Failed: '+e.message; }
      };
      $('#btnValidateBas').onclick = async () => { $('#lodgeMsg').textContent = 'Validating with ATO...'; try{ await api('/bas/validate', { method:'POST' }); $('#lodgeMsg').textContent='Validated'; } catch(e){ $('#lodgeMsg').textContent='Failed: '+e.message; } };
      $('#btnLodgeBas').onclick = async () => { $('#lodgeMsg').textContent = 'Lodging with ATO...'; try{ await api('/bas/lodge', { method:'POST' }); $('#lodgeMsg').textContent='Lodged'; } catch(e){ $('#lodgeMsg').textContent='Failed: '+e.message; } };
      try{ $('#atoStatus').textContent = (await api('/ato/status')).status; }catch{ $('#atoStatus').textContent='Unavailable'; }
    }

    if (view==='settings') {
      $('#theme').value = (localStorage.getItem('theme') || 'light');
      document.documentElement.classList.toggle('theme-dark', $('#theme').value==='dark');
      $('#theme').addEventListener('change', e=>{
        localStorage.setItem('theme', e.target.value);
        document.documentElement.classList.toggle('theme-dark', e.target.value==='dark');
      });
      $('#btnSaveSettings').onclick = async ()=>{
        const payload = { retentionMonths: parseInt($('#retention').value,10), piiMask: $('#pii').value==='on' };
        $('#saveMsg').textContent='Saving...';
        try{ await api('/settings', { method:'POST', body: JSON.stringify(payload) }); $('#saveMsg').textContent='Saved.'; }catch(e){ $('#saveMsg').textContent='Failed: '+e.message; }
      };
    }
  }

  function render(){
    const view = currentRoute();
    const root = document.getElementById('app');
    root.innerHTML = View[view] ? View[view]() : View.home();
    wire(view);
  }

  render();
})();