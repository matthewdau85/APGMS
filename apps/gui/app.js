(() => {
  const cfg = window.GUI_CONFIG || {};
  const base = (cfg.baseUrl || "/api").replace(/\/+$/, "");
  const $ = (sel, root=document) => root.querySelector(sel);

  const routes = ["home","connections","transactions","tax-bas","evidence","help","settings"];
  function currentRoute(){ const h = location.hash.replace(/^#\/?/, "").toLowerCase(); return routes.includes(h) ? h : "home"; }
  window.addEventListener("hashchange", () => render());

  async function api(path, init={}) {
    const r = await fetch(base + path, { headers: { "Content-Type":"application/json" }, ...init });
    if (!r.ok) throw new Error(String(r.status));
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  const View = {
    nav(active){
      return `
        <nav aria-label="Primary">
          <a href="#/home"        class="${active==='home'?'active':''}">Home</a>
          <a href="#/connections" class="${active==='connections'?'active':''}">Connections</a>
          <a href="#/transactions"class="${active==='transactions'?'active':''}">Transactions</a>
          <a href="#/tax-bas"     class="${active==='tax-bas'?'active':''}">Tax & BAS</a>
          <a href="#/evidence"    class="${active==='evidence'?'active':''}">Evidence</a>
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
        <div class="card">
          <h3>Transactions</h3>
          <div style="display:flex; gap:8px; margin-bottom:8px">
            <input id="q" placeholder="Search description or ref" />
            <select id="filterSource"><option value="">All sources</option></select>
            <button class="btn" id="btnRefresh">Refresh</button>
          </div>
          <table id="txTable"><thead><tr><th>Date</th><th>Source</th><th>Description</th><th>Amount</th><th>Category</th></tr></thead><tbody></tbody></table>
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

    evidence(){
      return `
        ${this.nav('evidence')}
        <div class="evidence-layout" style="margin-top:12px">
          <div class="card evidence-sidebar">
            <h3>Periods</h3>
            <p id="evListStatus" class="muted">Loading…</p>
            <div id="evList" class="evidence-periods"></div>
          </div>
          <div class="card evidence-main">
            <div class="evidence-header">
              <div>
                <h3 id="evTitle">Select a period</h3>
                <p id="evSubtitle" class="muted"></p>
              </div>
              <div class="evidence-actions">
                <button class="btn" id="evDiffBtn" disabled>Diff to previous evidence</button>
                <button class="btn" id="evDownloadBtn" disabled>Download ZIP</button>
              </div>
            </div>
            <div id="evDiffPanel" class="evidence-diff hidden"></div>
            <div id="evTabs" class="evidence-tabs">
              <button type="button" data-tab="overview" class="active">Overview</button>
              <button type="button" data-tab="hashes">Hashes</button>
              <button type="button" data-tab="rules">Rules</button>
              <button type="button" data-tab="settlement">Settlement</button>
              <button type="button" data-tab="json">JSON</button>
            </div>
            <div id="evContent" class="evidence-content">
              <p class="muted">Choose a period to load evidence.</p>
            </div>
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
      $('#btnRefresh').onclick = load;
      load();
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

    if (view==='evidence') {
      const listEl = $('#evList');
      const statusEl = $('#evListStatus');
      const titleEl = $('#evTitle');
      const subtitleEl = $('#evSubtitle');
      const tabsEl = $('#evTabs');
      const contentEl = $('#evContent');
      const diffPanel = $('#evDiffPanel');
      const diffBtn = $('#evDiffBtn');
      const downloadBtn = $('#evDownloadBtn');
      const cache = new Map();
      let periods = [];
      let current = null;
      let currentEvidence = null;
      let currentTab = 'overview';
      let changedPaths = new Set();

      function escapeHtml(value){
        return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      }

      function fmtDate(value){
        if (!value) return '—';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return escapeHtml(value);
        return escapeHtml(d.toLocaleString());
      }

      function fmtCurrency(cents){
        if (cents === null || cents === undefined) return '—';
        const amount = Number(cents) / 100;
        if (!Number.isFinite(amount)) return escapeHtml(String(cents));
        return escapeHtml(`A$${amount.toLocaleString(undefined,{minimumFractionDigits:2, maximumFractionDigits:2})}`);
      }

      function fmtNumber(value){
        if (value === null || value === undefined) return '—';
        const num = Number(value);
        if (!Number.isFinite(num)) return escapeHtml(String(value));
        return escapeHtml(num.toLocaleString());
      }

      function fmtBytes(size){
        if (size === null || size === undefined) return '—';
        let val = Number(size);
        if (!Number.isFinite(val)) return escapeHtml(String(size));
        const units = ['B','KB','MB','GB'];
        let i = 0;
        while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
        return escapeHtml(`${val.toFixed(i ? 1 : 0)} ${units[i]}`);
      }

      function formatHash(value){
        if (!value) return '—';
        return `<code>${escapeHtml(value)}</code>`;
      }

      function makeKey(item){
        return `${item.abn}|${item.taxType}|${item.periodId}`;
      }

      function applyHighlights(){
        const nodes = contentEl.querySelectorAll('[data-path]');
        nodes.forEach(node => {
          if (changedPaths.has(node.dataset.path)) node.classList.add('ev-changed');
          else node.classList.remove('ev-changed');
        });
      }

      function renderOverview(data){
        if (!data) return `<p class="muted">Choose a period to load evidence.</p>`;
        const meta = data.meta || {};
        const period = data.period || {};
        const attachments = Array.isArray(data.attachments) ? data.attachments : [];
        const approvals = Array.isArray(data.approvals) ? data.approvals : [];
        const rpt = data.rpt || null;
        const rows = [
          `<tr><th>Bundle generated</th><td>${fmtDate(meta.generated_at)}</td></tr>`,
          `<tr data-path="period.state"><th>State</th><td>${escapeHtml(period.state ?? '—')}</td></tr>`,
          `<tr data-path="period.final_liability_cents"><th>Final liability</th><td>${fmtCurrency(period.final_liability_cents)}</td></tr>`,
          `<tr data-path="period.accrued_cents"><th>Accrued</th><td>${fmtCurrency(period.accrued_cents)}</td></tr>`,
          `<tr data-path="period.credited_to_owa_cents"><th>Credited to OWA</th><td>${fmtCurrency(period.credited_to_owa_cents)}</td></tr>`,
          `<tr><th>Thresholds</th><td><code>${escapeHtml(JSON.stringify(period.thresholds || {}))}</code></td></tr>`
        ].join('');
        const rptSection = rpt ? `
          <table class="evidence-summary"><tbody>
            <tr data-path="rpt.created_at"><th>Issued</th><td>${fmtDate(rpt.created_at)}</td></tr>
            <tr data-path="rpt.signature"><th>Signature</th><td>${formatHash(rpt.signature)}</td></tr>
            <tr data-path="rpt.payload_sha256"><th>Payload SHA256</th><td>${formatHash(rpt.payload_sha256)}</td></tr>
          </tbody></table>
          <details class="ev-details"><summary>View payload</summary><pre class="code-block">${escapeHtml(JSON.stringify(rpt.payload, null, 2))}</pre></details>
        ` : `<p class="muted">No RPT issued for this period.</p>`;
        const approvalsList = approvals.length ? `<ul class="ev-listing">${approvals.map(a => `
          <li>
            <strong>${escapeHtml(a.action || '—')}</strong>
            <span>${escapeHtml(a.actor || '—')}</span>
            <time>${fmtDate(a.at)}</time>
            ${a.payload_hash ? `<code>${escapeHtml(a.payload_hash)}</code>` : ''}
          </li>`).join('')}</ul>` : `<p class="muted">No approvals recorded.</p>`;
        const attachmentsList = attachments.length ? `<ul class="ev-listing">${attachments.map(a => `
          <li>
            <strong>${escapeHtml(a.name)}</strong>
            <span class="muted">${escapeHtml(a.description || '')}</span>
            <span class="muted">${escapeHtml(a.mime || 'application/octet-stream')} • ${fmtBytes(a.size)}</span>
          </li>`).join('')}</ul>` : `<p class="muted">No attachments available.</p>`;
        return `
          <section class="ev-section">
            <h4>Period summary</h4>
            <table class="evidence-summary"><tbody>${rows}</tbody></table>
          </section>
          <section class="ev-section">
            <h4>RPT</h4>
            ${rptSection}
          </section>
          <section class="ev-section">
            <h4>Approvals</h4>
            ${approvalsList}
          </section>
          <section class="ev-section">
            <h4>Attachments</h4>
            ${attachmentsList}
          </section>
        `;
      }

      function renderHashes(data){
        if (!data) return `<p class="muted">Choose a period to load evidence.</p>`;
        const hashes = data.hashes || {};
        return `
          <section class="ev-section">
            <h4>Hash material</h4>
            <table class="evidence-summary"><tbody>
              <tr data-path="hashes.merkle_root"><th>Merkle root</th><td>${formatHash(hashes.merkle_root)}</td></tr>
              <tr data-path="hashes.running_balance_hash"><th>Running balance hash</th><td>${formatHash(hashes.running_balance_hash)}</td></tr>
              <tr data-path="hashes.ledger_head_hash"><th>Ledger head hash</th><td>${formatHash(hashes.ledger_head_hash)}</td></tr>
              <tr data-path="hashes.bank_receipt_hash"><th>Bank receipt hash</th><td>${formatHash(hashes.bank_receipt_hash)}</td></tr>
              <tr data-path="hashes.rpt_payload_sha256"><th>RPT payload SHA256</th><td>${formatHash(hashes.rpt_payload_sha256)}</td></tr>
            </tbody></table>
          </section>
        `;
      }

      function renderRules(data){
        if (!data) return `<p class="muted">Choose a period to load evidence.</p>`;
        const rules = data.rules || { files: [] };
        const files = Array.isArray(rules.files) ? rules.files : [];
        const rows = files.length ? files.map(f => `
          <tr>
            <td>${escapeHtml(f.name)}</td>
            <td><code>${escapeHtml(f.sha256 || '—')}</code></td>
            <td>${fmtBytes(f.size)}</td>
          </tr>
        `).join('') : `<tr><td colspan="3" class="muted">No rule files found.</td></tr>`;
        return `
          <section class="ev-section">
            <h4>Rule versions</h4>
            <table class="evidence-summary"><tbody>
              <tr data-path="rules.rates_version"><th>Rates version</th><td>${escapeHtml(rules.rates_version || '—')}</td></tr>
            </tbody></table>
          </section>
          <section class="ev-section">
            <h4>Rule file hashes</h4>
            <table class="evidence-ledger">
              <thead><tr><th>File</th><th>SHA256</th><th>Size</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
        `;
      }

      function renderSettlement(data){
        if (!data) return `<p class="muted">Choose a period to load evidence.</p>`;
        const settlement = data.settlement || {};
        const ledger = Array.isArray(data.owa_ledger) ? data.owa_ledger : [];
        const sample = ledger.slice(-10);
        const rows = sample.length ? sample.map(r => `
          <tr>
            <td>${escapeHtml(r.created_at)}</td>
            <td>${escapeHtml(r.transfer_uuid)}</td>
            <td>${fmtCurrency(r.amount_cents)}</td>
            <td>${fmtCurrency(r.balance_after_cents)}</td>
            <td><code>${escapeHtml(r.bank_receipt_hash || '')}</code></td>
          </tr>
        `).join('') : `<tr><td colspan="5" class="muted">No ledger entries recorded.</td></tr>`;
        return `
          <section class="ev-section">
            <h4>Settlement receipt</h4>
            <table class="evidence-summary"><tbody>
              <tr data-path="settlement.receipt"><th>Receipt hash</th><td>${formatHash(settlement.receipt)}</td></tr>
              <tr data-path="settlement.ledger_entries"><th>Ledger entries</th><td>${fmtNumber(settlement.ledger_entries)}</td></tr>
              <tr data-path="settlement.balance_after_cents"><th>Balance after</th><td>${fmtCurrency(settlement.balance_after_cents)}</td></tr>
            </tbody></table>
          </section>
          <section class="ev-section">
            <h4>Ledger preview (latest ${sample.length} of ${ledger.length})</h4>
            <table class="evidence-ledger">
              <thead><tr><th>When</th><th>Transfer</th><th>Amount</th><th>Balance</th><th>Receipt hash</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </section>
        `;
      }

      function renderJson(data){
        if (!data) return `<p class="muted">Choose a period to load evidence.</p>`;
        return `<pre class="code-block">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
      }

      function renderTab(tab){
        if (tab==='hashes') return renderHashes(currentEvidence);
        if (tab==='rules') return renderRules(currentEvidence);
        if (tab==='settlement') return renderSettlement(currentEvidence);
        if (tab==='json') return renderJson(currentEvidence);
        return renderOverview(currentEvidence);
      }

      function renderCurrent(){
        contentEl.innerHTML = renderTab(currentTab);
        applyHighlights();
      }

      function setTab(tab){
        currentTab = tab;
        tabsEl.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.tab===tab));
        renderCurrent();
      }

      tabsEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => setTab(btn.dataset.tab));
      });

      function renderList(){
        listEl.innerHTML = '';
        if (!periods.length) return;
        const frag = document.createDocumentFragment();
        periods.forEach(item => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'evidence-period';
          if (current && makeKey(current) === makeKey(item)) btn.classList.add('active');
          btn.innerHTML = `<span class="period">${escapeHtml(item.periodId)}</span><span class="meta">${escapeHtml(item.taxType)} • ${escapeHtml(item.state || '—')}</span><span class="meta">${escapeHtml(item.abn)}</span>`;
          btn.onclick = () => selectPeriod(item);
          frag.appendChild(btn);
        });
        listEl.appendChild(frag);
      }

      async function loadEvidence(item){
        const key = makeKey(item);
        if (cache.has(key)) return cache.get(key);
        const query = `/evidence?abn=${encodeURIComponent(item.abn)}&taxType=${encodeURIComponent(item.taxType)}&periodId=${encodeURIComponent(item.periodId)}`;
        const res = await api(query);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        cache.set(key, res.body);
        return res.body;
      }

      function findPrevious(item){
        const idx = periods.findIndex(p => makeKey(p) === makeKey(item));
        if (idx === -1) return null;
        for (let i = idx + 1; i < periods.length; i++) {
          const candidate = periods[i];
          if (candidate.abn === item.abn && candidate.taxType === item.taxType) return candidate;
        }
        return null;
      }

      function flatten(obj, prefix, out){
        if (obj === null || obj === undefined) {
          if (prefix) out[prefix] = obj;
          return;
        }
        if (typeof obj !== 'object') {
          if (prefix) out[prefix] = obj;
          return;
        }
        if (Array.isArray(obj)) {
          if (prefix) out[prefix] = JSON.stringify(obj);
          return;
        }
        const keys = Object.keys(obj);
        if (!keys.length) {
          if (prefix) out[prefix] = obj;
          return;
        }
        keys.forEach(key => {
          const next = prefix ? `${prefix}.${key}` : key;
          flatten(obj[key], next, out);
        });
      }

      function computeDiff(prev, next){
        const ignore = new Set(['meta.generated_at']);
        const prevFlat = {};
        const nextFlat = {};
        flatten(prev, '', prevFlat);
        flatten(next, '', nextFlat);
        const keys = new Set([...Object.keys(prevFlat), ...Object.keys(nextFlat)]);
        const diffs = [];
        keys.forEach(key => {
          if (ignore.has(key)) return;
          const before = prevFlat[key];
          const after = nextFlat[key];
          const beforeNorm = before === undefined || before === null ? '—' : typeof before === 'string' ? before : JSON.stringify(before);
          const afterNorm = after === undefined || after === null ? '—' : typeof after === 'string' ? after : JSON.stringify(after);
          if (beforeNorm === afterNorm) return;
          diffs.push({ path: key, before: beforeNorm, after: afterNorm });
        });
        return diffs.sort((a,b)=>a.path.localeCompare(b.path));
      }

      function renderDiffTable(diffs, prev){
        const header = `<div class="evidence-diff-header"><strong>Changes vs ${escapeHtml(prev.periodId)}</strong><button type="button" class="link-btn" id="evDiffClear">Clear</button></div>`;
        if (!diffs.length) {
          return `${header}<p class="muted">Evidence matches ${escapeHtml(prev.periodId)}.</p>`;
        }
        const rows = diffs.map(d => `<tr><td>${escapeHtml(d.path)}</td><td>${escapeHtml(d.before)}</td><td>${escapeHtml(d.after)}</td></tr>`).join('');
        return `${header}<table><thead><tr><th>Field</th><th>${escapeHtml(prev.periodId)}</th><th>${escapeHtml(current.periodId)}</th></tr></thead><tbody>${rows}</tbody></table>`;
      }

      function clearDiff(){
        changedPaths = new Set();
        diffPanel.classList.add('hidden');
        diffPanel.innerHTML = '';
        applyHighlights();
      }

      async function showDiff(){
        if (!current || !currentEvidence) return;
        const prev = findPrevious(current);
        if (!prev) {
          diffPanel.classList.remove('hidden');
          diffPanel.innerHTML = '<p class="muted">No previous evidence available for this ABN and tax type.</p>';
          changedPaths = new Set();
          applyHighlights();
          return;
        }
        diffPanel.classList.remove('hidden');
        diffPanel.innerHTML = '<p class="muted">Calculating diff…</p>';
        try {
          const prevEvidence = await loadEvidence(prev);
          const diffs = computeDiff(prevEvidence, currentEvidence);
          diffPanel.innerHTML = renderDiffTable(diffs, prev);
          changedPaths = new Set(diffs.map(d => d.path));
          applyHighlights();
        } catch (e) {
          diffPanel.innerHTML = '<p class="muted">Unable to diff evidence.</p>';
          changedPaths = new Set();
          applyHighlights();
        }
        const clearBtn = $('#evDiffClear');
        if (clearBtn) clearBtn.onclick = clearDiff;
      }

      async function downloadZip(){
        if (!current) return;
        downloadBtn.disabled = true;
        try {
          const url = `${base}/evidence/zip?abn=${encodeURIComponent(current.abn)}&taxType=${encodeURIComponent(current.taxType)}&periodId=${encodeURIComponent(current.periodId)}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error('HTTP '+res.status);
          const blob = await res.blob();
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `evidence_${current.abn}_${current.periodId}_${current.taxType}.zip`;
          document.body.appendChild(a);
          a.click();
          URL.revokeObjectURL(a.href);
          a.remove();
        } catch (e) {
          alert('Failed to download ZIP.');
        } finally {
          downloadBtn.disabled = false;
        }
      }

      async function selectPeriod(item){
        current = item;
        changedPaths = new Set();
        diffPanel.classList.add('hidden');
        diffPanel.innerHTML = '';
        renderList();
        titleEl.textContent = `Evidence ${item.periodId}`;
        subtitleEl.textContent = `${item.abn} · ${item.taxType}`;
        contentEl.innerHTML = '<p class="muted">Loading…</p>';
        downloadBtn.disabled = true;
        diffBtn.disabled = true;
        try {
          currentEvidence = await loadEvidence(item);
          downloadBtn.disabled = false;
          diffBtn.disabled = !findPrevious(item);
          renderCurrent();
        } catch (e) {
          currentEvidence = null;
          contentEl.innerHTML = '<p class="muted">Failed to load evidence.</p>';
        }
      }

      async function loadIndex(){
        statusEl.textContent = 'Loading…';
        listEl.innerHTML = '';
        try {
          const res = await api('/evidence/index');
          if (!res.ok || !Array.isArray(res.body) || !res.body.length) {
            statusEl.textContent = res.ok ? 'No evidence available yet.' : 'Failed to load evidence list.';
            periods = [];
            return;
          }
          statusEl.textContent = '';
          periods = res.body;
          renderList();
          selectPeriod(periods[0]);
        } catch (e) {
          statusEl.textContent = 'Failed to load evidence list.';
        }
      }

      diffBtn.onclick = showDiff;
      downloadBtn.onclick = downloadZip;
      loadIndex();
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