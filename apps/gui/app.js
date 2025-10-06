(() => {
  const cfg = window.GUI_CONFIG || {};
  const base = (cfg.baseUrl || "/api").replace(/\/+$/, "");
  const $ = (sel, root=document) => root.querySelector(sel);

  const routes = ["home","connections","transactions","recon","tax-bas","help","settings"];
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
          <a href="#/recon"        class="${active==='recon'?'active':''}">Ops</a>
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

    recon(){
      return `
        ${this.nav('recon')}
        <div id="opsToast" class="ops-toast hidden" role="status" aria-live="polite"></div>
        <section class="grid" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr); gap:12px; margin-top:12px">
          <div class="card" id="reconWorkbench">
            <div class="flex" style="display:flex; flex-wrap:wrap; gap:12px; align-items:flex-end">
              <div style="flex:1 1 160px; min-width:150px">
                <label for="filterAge">Age window <span class="hint" title="Limit the queue by how long an anomaly has been waiting">i</span></label>
                <select id="filterAge">
                  <option value="all">Any age</option>
                  <option value="lt:15">Less than 15 minutes</option>
                  <option value="lt:60">Less than 1 hour</option>
                  <option value="lt:240">Less than 4 hours</option>
                  <option value="lt:1440">Less than 1 day</option>
                  <option value="gte:1440">Older than a day</option>
                </select>
              </div>
              <div style="flex:1 1 200px; min-width:180px">
                <span class="label">Severity bands <span class="hint" title="Operational impact based on policy thresholds">i</span></span>
                <div class="chip-list" id="severityFilters">
                  <label><input type="checkbox" value="critical" checked> Critical</label>
                  <label><input type="checkbox" value="high" checked> High</label>
                  <label><input type="checkbox" value="medium" checked> Medium</label>
                  <label><input type="checkbox" value="low" checked> Low</label>
                </div>
              </div>
              <div style="flex:1 1 200px; min-width:180px">
                <label>ML score <span class="hint" title="Model confidence 0-100. Narrow to focus triage.">i</span></label>
                <div class="range">
                  <input id="mlMin" type="number" min="0" max="100" value="0" aria-label="Minimum ML score"/>
                  <span>to</span>
                  <input id="mlMax" type="number" min="0" max="100" value="100" aria-label="Maximum ML score"/>
                </div>
              </div>
              <div style="flex:1 1 220px; min-width:200px">
                <label for="reconSearch">Quick search</label>
                <input id="reconSearch" type="search" placeholder="ID, account, narrative"/>
              </div>
            </div>

            <div class="inline-info">
              <p><strong>Inline explainers:</strong> Hover severity badges or ML scores to see why the model flagged the anomaly.</p>
            </div>

            <div class="bulk-row">
              <div>
                <strong id="reconCount">0</strong> anomalies in view · <span id="selectedSummary">0 selected</span>
                <button type="button" id="clearSelection" class="link-btn">Clear</button>
              </div>
              <div class="bulk-actions">
                <button class="btn" id="bulkResolve" disabled>Resolve selected</button>
                <button class="btn" id="bulkSnooze" disabled>Snooze 24h</button>
                <button class="btn" id="bulkEscalate" disabled>Escalate to L2</button>
              </div>
            </div>

            <div class="virtual-wrap">
              <div class="virtual-header">
                <div><input type="checkbox" id="reconSelectAll" aria-label="Select all anomalies"/></div>
                <div>Anomaly</div>
                <div>Age</div>
                <div>Severity</div>
                <div>Why it matters</div>
                <div>ML score</div>
              </div>
              <div id="reconScroller" class="virtual-scroller" aria-label="Recon anomalies" role="grid">
                <div id="reconCanvas" class="virtual-canvas"></div>
              </div>
              <div id="reconEmpty" class="empty-state">No anomalies match the filters.</div>
            </div>
          </div>

          <div class="card" id="detailPanel">
            <h3 class="detail-title">Review details</h3>
            <p id="detailSubtitle" class="detail-sub">Select an anomaly or DLQ entry to see raw inputs and guidance.</p>
            <div class="detail-section">
              <div class="detail-heading">Summary</div>
              <div id="detailSummary" class="detail-body muted">Waiting for a selection.</div>
            </div>
            <div class="detail-section">
              <div class="detail-heading">Raw payload</div>
              <pre id="detailPayload" class="detail-pre muted">â€”</pre>
            </div>
            <div class="detail-section">
              <div class="detail-heading">Validation errors</div>
              <ul id="detailErrors" class="detail-list muted"><li>â€”</li></ul>
            </div>
            <div class="detail-section">
              <div class="detail-heading">Suggested fixes</div>
              <ul id="detailFixes" class="detail-list muted"><li>Use the help links to resolve anomalies faster.</li></ul>
            </div>
          </div>
        </section>

        <section class="grid" style="margin-top:12px; gap:12px">
          <div class="card" id="dlqConsole">
            <div class="header-row">
              <div>
                <h3>Dead-letter replay console</h3>
                <p class="muted">Replay failures with pacing and observe live feedback.</p>
              </div>
              <div class="header-actions">
                <label class="rate-label">Rate limit</label>
                <input id="dlqRate" type="number" min="1" value="50" aria-label="Replay rate per minute"/>
                <button class="btn" id="reloadDlq">Refresh</button>
              </div>
            </div>
            <div class="bulk-row">
              <div><strong id="dlqCount">0</strong> messages · <span id="dlqSelected">0 selected</span></div>
              <div class="bulk-actions">
                <button class="btn" id="dlqReplay" disabled>Replay selected</button>
                <button class="btn" id="dlqDrop" disabled>Drop selected</button>
              </div>
            </div>
            <table class="dlq-table">
              <thead>
                <tr>
                  <th><input type="checkbox" id="dlqSelectAll" aria-label="Select all DLQ messages"/></th>
                  <th>Failure</th>
                  <th>When</th>
                  <th>Reason</th>
                  <th>Attempts</th>
                  <th></th>
                </tr>
              </thead>
              <tbody id="dlqRows">
                <tr><td colspan="6" class="muted">Loadingâ€¦</td></tr>
              </tbody>
            </table>
          </div>

          <div class="card" id="auditLog">
            <h3>Audit trail</h3>
            <p class="muted">Actions taken in this workbench are journaled for traceability.</p>
            <ol id="auditEntries" class="audit-list"></ol>
          </div>
        </section>
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

    if (view==='recon') {
      const toastEl = $('#opsToast');
      let toastTimer;
      const notify = (msg, ok=true) => {
        if (!toastEl) return;
        toastEl.textContent = msg;
        toastEl.className = `ops-toast ${ok ? 'success' : 'error'} show`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(()=>{ toastEl.className = 'ops-toast hidden'; }, 2600);
      };

      const state = {
        anomalies: [],
        filtered: [],
        selected: new Set(),
        dlq: [],
        dlqSelected: new Set(),
        rowHeight: 64,
        activeRecon: null,
        activeDlq: null,
        audit: []
      };

      const severityMap = {
        critical: { label: 'Critical', explain: 'Breaches tolerance or creates regulatory exposure.' },
        high: { label: 'High', explain: 'Material financial impact; escalate if not cleared promptly.' },
        medium: { label: 'Medium', explain: 'Needs follow-up to keep ledgers in sync.' },
        low: { label: 'Low', explain: 'Informational or automatically recoverable drift.' }
      };

      const scroller = $('#reconScroller');
      const canvas = $('#reconCanvas');
      const empty = $('#reconEmpty');
      const countEl = $('#reconCount');
      const selectedLabel = $('#selectedSummary');
      const clearButton = $('#clearSelection');
      const selectAll = $('#reconSelectAll');
      const severityInputs = Array.from(document.querySelectorAll('#severityFilters input[type="checkbox"]'));
      const ageSelect = $('#filterAge');
      const mlMin = $('#mlMin');
      const mlMax = $('#mlMax');
      const searchInput = $('#reconSearch');
      const bulkResolve = $('#bulkResolve');
      const bulkSnooze = $('#bulkSnooze');
      const bulkEscalate = $('#bulkEscalate');
      const detailHeading = document.querySelector('#detailPanel .detail-title');
      const detailSubtitle = $('#detailSubtitle');
      const detailSummary = $('#detailSummary');
      const detailPayload = $('#detailPayload');
      const detailErrors = $('#detailErrors');
      const detailFixes = $('#detailFixes');
      const auditList = $('#auditEntries');
      const dlqRows = $('#dlqRows');
      const dlqSelectAll = $('#dlqSelectAll');
      const dlqCount = $('#dlqCount');
      const dlqSelectedLabel = $('#dlqSelected');
      const dlqRate = $('#dlqRate');
      const dlqReplay = $('#dlqReplay');
      const dlqDrop = $('#dlqDrop');
      const reloadDlq = $('#reloadDlq');

      const defaultHeading = detailHeading?.textContent || 'Review details';

      const escapeHtml = (value='') => {
        return String(value ?? '').replace(/[&<>'"]/g, c => {
          switch (c) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return c;
          }
        });
      };

      const parseDate = (val) => {
        if (!val) return null;
        const d = val instanceof Date ? val : new Date(val);
        return Number.isNaN(d.getTime()) ? null : d;
      };

      const ageMinutes = (item) => {
        if (typeof item?.ageMinutes === 'number') return item.ageMinutes;
        if (typeof item?.age_minutes === 'number') return item.age_minutes;
        if (typeof item?.age === 'number') return item.age;
        const dt = parseDate(item?.__occurred || item?.detected_at || item?.created_at || item?.timestamp || item?.first_seen);
        if (!dt) return null;
        const diff = (Date.now() - dt.getTime()) / 60000;
        return diff < 0 ? 0 : diff;
      };

      const formatAge = (item) => {
        const mins = ageMinutes(item);
        if (mins == null) return '—';
        if (mins < 60) return `${Math.round(mins)}m`;
        const hours = Math.floor(mins / 60);
        if (hours < 48) {
          const rem = Math.round(mins - hours * 60);
          return rem ? `${hours}h ${rem}m` : `${hours}h`;
        }
        const days = Math.floor(hours / 24);
        const remHours = hours % 24;
        return remHours ? `${days}d ${remHours}h` : `${days}d`;
      };

      const formatRelative = (date) => {
        if (!date) return '—';
        const diff = Date.now() - date.getTime();
        if (diff < 60000 && diff > -60000) return 'Just now';
        const mins = Math.round(Math.abs(diff) / 60000);
        if (mins < 60) return diff >= 0 ? `${mins}m ago` : `in ${mins}m`;
        const hours = Math.round(mins / 60);
        if (hours < 48) return diff >= 0 ? `${hours}h ago` : `in ${hours}h`;
        const days = Math.round(hours / 24);
        return diff >= 0 ? `${days}d ago` : `in ${days}d`;
      };

      const formatScore = (score) => {
        if (!Number.isFinite(score)) return '—';
        const rounded = Math.round(score * 10) / 10;
        return `${rounded.toFixed(1)}`;
      };

      const clampScoreInput = (input) => {
        if (!input) return 0;
        let val = parseFloat(input.value);
        if (!Number.isFinite(val)) val = 0;
        val = Math.min(100, Math.max(0, val));
        input.value = String(val);
        return val;
      };

      const stringLabel = (str) => {
        if (!str) return 'Unknown';
        return String(str).replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      };

      const severityMeta = (item) => {
        const key = String(item?.severity || item?.level || item?.priority || 'unknown').toLowerCase();
        const meta = severityMap[key] || { label: stringLabel(key), explain: 'Severity not provided.' };
        return { key: key || 'unknown', label: meta.label, explain: meta.explain };
      };

      const getScore = (item) => {
        const raw = item?.mlScore ?? item?.ml_score ?? item?.score ?? item?.model_score ?? item?.prediction ?? item?.ml ?? item?.probability;
        if (typeof raw === 'number') return Math.min(100, Math.max(0, raw));
        const num = parseFloat(raw);
        return Number.isFinite(num) ? Math.min(100, Math.max(0, num)) : 0;
      };

      const matchAge = (item, filter) => {
        if (!filter || filter === 'all') return true;
        const mins = ageMinutes(item);
        if (mins == null) return true;
        if (filter.startsWith('lt:')) return mins < parseFloat(filter.split(':')[1] || '0');
        if (filter.startsWith('gte:')) return mins >= parseFloat(filter.split(':')[1] || '0');
        return true;
      };

      const normalizeAnomaly = (raw, idx) => {
        const base = raw || {};
        const id = base.id ?? base.anomaly_id ?? base.reference ?? base.event_id ?? `anomaly-${Date.now()}-${idx}`;
        const payload = base.payload ?? base.raw ?? base.body ?? base.message ?? base.event ?? null;
        const validation = Array.isArray(base.validationErrors) ? base.validationErrors : Array.isArray(base.validation) ? base.validation : [];
        const fixes = Array.isArray(base.suggestedFixes) ? base.suggestedFixes : Array.isArray(base.fix_suggestions) ? base.fix_suggestions : Array.isArray(base.remediation) ? base.remediation : [];
        const explain = Array.isArray(base.explainers) ? base.explainers.join(', ') : base.explainer || base.explanation || base.model_reason || base.why || '';
        const summary = base.summary || base.title || base.reason || base.description || base.message || `Anomaly ${id}`;
        const occurred = base.detected_at || base.created_at || base.occurred_at || base.timestamp || base.first_seen;
        return { ...base, __id: id, __originalId: base.id ?? base.anomaly_id ?? base.reference ?? id, __payload: payload, __validation: validation, __fixes: fixes, __explain: explain, __summary: summary, __occurred: occurred };
      };

      const normalizeDlq = (raw, idx) => {
        const base = raw || {};
        const id = base.id ?? base.messageId ?? base.event_id ?? `dlq-${Date.now()}-${idx}`;
        const occurred = base.failed_at || base.received_at || base.timestamp || base.created_at;
        const payload = base.payload ?? base.body ?? base.message ?? base.event ?? null;
        const validation = Array.isArray(base.validationErrors) ? base.validationErrors : [];
        const fixes = Array.isArray(base.remediation) ? base.remediation : Array.isArray(base.suggestedFixes) ? base.suggestedFixes : [];
        const reason = base.reason || base.error || base.message || base.failure || 'Unknown failure';
        const attempts = base.attempts ?? base.deliveryAttempts ?? base.retries ?? base.retry_count ?? 0;
        return { ...base, __id: id, __originalId: base.id ?? base.messageId ?? id, __occurred: occurred, __payload: payload, __validation: validation, __fixes: fixes, __reason: reason, __attempts: attempts };
      };

      const resetDetail = () => {
        if (detailHeading) detailHeading.textContent = defaultHeading;
        if (detailSubtitle) detailSubtitle.textContent = 'Select an anomaly or DLQ entry to see raw inputs and guidance.';
        if (detailSummary) { detailSummary.textContent = 'Waiting for a selection.'; detailSummary.classList.add('muted'); }
        if (detailPayload) { detailPayload.textContent = '—'; detailPayload.classList.add('muted'); }
        if (detailErrors) { detailErrors.innerHTML = '<li>—</li>'; detailErrors.classList.add('muted'); }
        if (detailFixes) { detailFixes.innerHTML = '<li>Use the help links to resolve anomalies faster.</li>'; detailFixes.classList.add('muted'); }
      };

      const populateList = (listEl, items, mapper) => {
        if (!listEl) return;
        listEl.innerHTML = '';
        if (!items || !items.length) {
          const li = document.createElement('li');
          li.textContent = 'None reported.';
          listEl.appendChild(li);
          listEl.classList.add('muted');
          return;
        }
        listEl.classList.remove('muted');
        for (const item of items) {
          listEl.appendChild(mapper(item));
        }
      };

      const showDetail = (kind, item) => {
        if (!item) { resetDetail(); return; }
        const occurredDate = parseDate(item.__occurred || item.detected_at || item.created_at || item.timestamp);
        const badge = severityMeta(item);
        if (detailHeading) detailHeading.textContent = kind === 'dlq' ? `DLQ message · ${item.__originalId}` : `Recon anomaly · ${item.__originalId}`;
        if (detailSubtitle) detailSubtitle.textContent = kind === 'dlq' ? 'Replay payload, inspect validation feedback, and confirm fixes.' : `${badge.label} impact · ${formatAge(item)} old`;
        if (detailSummary) {
          detailSummary.textContent = item.__summary || item.__reason || '—';
          detailSummary.classList.remove('muted');
        }
        if (detailPayload) {
          const payload = item.__payload ?? item.payload ?? item.body ?? item.message ?? null;
          if (payload == null) {
            detailPayload.textContent = '—';
            detailPayload.classList.add('muted');
          } else {
            detailPayload.textContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
            detailPayload.classList.remove('muted');
          }
        }
        if (detailErrors) {
          const errors = item.__validation ?? item.validationErrors ?? item.validation ?? [];
          populateList(detailErrors, errors, (err) => {
            const li = document.createElement('li');
            if (typeof err === 'string') { li.textContent = err; }
            else if (err?.message) { li.textContent = err.message; }
            else { li.textContent = JSON.stringify(err); }
            return li;
          });
        }
        if (detailFixes) {
          const fixes = item.__fixes ?? item.suggestedFixes ?? [];
          populateList(detailFixes, fixes.length ? fixes : null, (fix) => {
            const li = document.createElement('li');
            if (typeof fix === 'string') {
              li.textContent = fix;
            } else {
              const link = document.createElement('a');
              if (fix?.href) {
                link.href = fix.href;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
              } else {
                link.href = '#/help';
              }
              link.textContent = fix?.label || fix?.title || fix?.href || 'View guidance';
              li.appendChild(link);
              if (fix?.note) {
                const span = document.createElement('span');
                span.textContent = ` — ${fix.note}`;
                li.appendChild(span);
              }
            }
            return li;
          });
        }
        if (detailPayload && occurredDate) detailPayload.setAttribute('title', occurredDate.toLocaleString());
      };

      const updateSelection = () => {
        if (selectedLabel) selectedLabel.textContent = `${state.selected.size} selected`;
        const disable = state.selected.size === 0;
        [bulkResolve, bulkSnooze, bulkEscalate].forEach(btn => { if (btn) btn.disabled = disable; });
        if (selectAll) {
          const total = state.filtered.length;
          if (!total) {
            selectAll.checked = false;
            selectAll.indeterminate = false;
          } else {
            let all = true;
            for (const item of state.filtered) {
              if (!state.selected.has(item.__id)) { all = false; break; }
            }
            selectAll.checked = all && total > 0;
            selectAll.indeterminate = !all && state.selected.size > 0;
          }
        }
      };

      const reconcileSelection = () => {
        const ids = new Set(state.anomalies.map(a => a.__id));
        for (const id of Array.from(state.selected)) {
          if (!ids.has(id)) state.selected.delete(id);
        }
        if (state.activeRecon && !ids.has(state.activeRecon)) {
          state.activeRecon = null;
          if (!state.activeDlq) resetDetail();
        }
        updateSelection();
      };

      const renderVirtual = () => {
        if (!canvas || !scroller) return;
        const total = state.filtered.length;
        canvas.innerHTML = '';
        canvas.style.height = `${total * state.rowHeight}px`;
        if (!total) return;
        const viewHeight = scroller.clientHeight || 0;
        const start = Math.max(0, Math.floor((scroller.scrollTop || 0) / state.rowHeight) - 3);
        const end = Math.min(total, start + Math.ceil((viewHeight || 0) / state.rowHeight) + 6);
        const frag = document.createDocumentFragment();
        for (let i = start; i < end; i++) {
          const item = state.filtered[i];
          const row = document.createElement('div');
          row.className = 'virtual-row';
          if (i % 2) row.classList.add('alt');
          if (state.selected.has(item.__id)) row.classList.add('selected');
          if (state.activeRecon === item.__id) row.classList.add('active');
          row.style.top = `${i * state.rowHeight}px`;
          row.style.height = `${state.rowHeight}px`;
          row.dataset.id = item.__id;
          const severity = severityMeta(item);
          const score = getScore(item);
          const occurred = parseDate(item.__occurred || item.detected_at || item.created_at || item.timestamp);
          const reason = escapeHtml(item.__summary || item.__reason || 'Review required');
          const explain = escapeHtml(item.__explain || 'Model contribution details unavailable.');
          const tooltipAge = occurred ? occurred.toLocaleString() : 'Timestamp unavailable';
          row.innerHTML = `
            <label class="virtual-cell chk"><input type="checkbox" data-id="${escapeHtml(item.__id)}" ${state.selected.has(item.__id)?'checked':''}/></label>
            <div class="virtual-cell code" title="${escapeHtml(item.__originalId)}">${escapeHtml(item.__originalId)}</div>
            <div class="virtual-cell" title="${escapeHtml(tooltipAge)}">${formatAge(item)}</div>
            <div class="virtual-cell"><span class="pill pill-${escapeHtml(severity.key)}" title="${escapeHtml(severity.explain)}">${escapeHtml(severity.label)}</span></div>
            <div class="virtual-cell reason"><div class="reason-title">${reason}</div>${item.__explain ? `<div class="reason-note">${explain}</div>` : ''}</div>
            <div class="virtual-cell score" title="${escapeHtml(explain)}">${formatScore(score)}</div>
          `;
          row.addEventListener('click', (ev) => {
            if (ev.target.closest('input')) return;
            state.activeRecon = item.__id;
            state.activeDlq = null;
            showDetail('recon', item);
            renderVirtual();
          });
          const cb = row.querySelector('input[type="checkbox"]');
          cb?.addEventListener('change', ev => {
            ev.stopPropagation();
            if (cb.checked) state.selected.add(item.__id); else state.selected.delete(item.__id);
            updateSelection();
            if (!cb.checked && state.activeRecon === item.__id) state.activeRecon = null;
            row.classList.toggle('selected', cb.checked);
          });
          frag.appendChild(row);
        }
        canvas.appendChild(frag);
      };

      const renderAudit = () => {
        if (!auditList) return;
        if (!state.audit.length) {
          auditList.innerHTML = '<li class="muted">No actions yet.</li>';
          return;
        }
        auditList.innerHTML = state.audit.map(entry => {
          const when = entry.time instanceof Date ? entry.time.toLocaleString() : entry.time;
          const detail = entry.detail ? ` <span class="audit-detail">${escapeHtml(entry.detail)}</span>` : '';
          return `<li><span class="audit-time">${escapeHtml(when)}</span> <span class="audit-status ${entry.ok ? 'ok' : 'fail'}">${escapeHtml(entry.action)}</span>${detail}</li>`;
        }).join('');
      };

      const addAudit = (action, detail, ok=true) => {
        state.audit.unshift({ time: new Date(), action, detail, ok });
        if (state.audit.length > 50) state.audit.pop();
        renderAudit();
      };

      const applyFilters = () => {
        let minScore = clampScoreInput(mlMin);
        let maxScore = clampScoreInput(mlMax);
        if (minScore > maxScore) {
          if (document.activeElement === mlMin) { maxScore = minScore; if (mlMax) mlMax.value = String(maxScore); }
          else { minScore = maxScore; if (mlMin) mlMin.value = String(minScore); }
        }
        const selectedSev = severityInputs.filter(cb => cb.checked).map(cb => cb.value.toLowerCase());
        const restrictSeverity = selectedSev.length && selectedSev.length < severityInputs.length;
        const ageVal = ageSelect?.value || 'all';
        const query = (searchInput?.value || '').trim().toLowerCase();
        const matchesQuery = (item) => {
          if (!query) return true;
          const fields = [item.__originalId, item.__summary, item.__reason, item.account, item.counterparty, item.reference, item.owner];
          return fields.some(val => val && String(val).toLowerCase().includes(query));
        };
        state.filtered = state.anomalies.filter(item => {
          if (restrictSeverity) {
            const sev = severityMeta(item).key;
            if (!selectedSev.includes(sev)) return false;
          }
          const score = getScore(item);
          if (score < minScore || score > maxScore) return false;
          if (!matchAge(item, ageVal)) return false;
          if (!matchesQuery(item)) return false;
          return true;
        });
        if (countEl) countEl.textContent = state.filtered.length;
        if (empty) empty.classList.toggle('hidden', !!state.filtered.length);
        if (scroller) scroller.classList.toggle('hidden', !state.filtered.length);
        reconcileSelection();
        renderVirtual();
      };

      const idsToPayload = (ids) => ids.map(id => {
        const found = state.anomalies.find(a => a.__id === id);
        return found?.__originalId || id;
      });

      const runBulk = async (label, path, extra={}) => {
        if (!state.selected.size) { notify('Select at least one anomaly first.', false); return; }
        const ids = Array.from(state.selected);
        try {
          const res = await api(path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ ids: idsToPayload(ids), ...extra }) });
          if (res.ok) {
            notify(`${label} ${ids.length} anomaly${ids.length===1?'':'ies'}.`);
            addAudit(label, `${ids.length} anomaly${ids.length===1?'':'ies'}`, true);
            const removed = new Set(ids);
            state.anomalies = state.anomalies.filter(item => !removed.has(item.__id));
            state.selected.clear();
            if (removed.has(state.activeRecon)) { state.activeRecon = null; if (!state.activeDlq) resetDetail(); }
            applyFilters();
          } else {
            notify(`${label} failed (HTTP ${res.status}).`, false);
            addAudit(`${label} failed`, `HTTP ${res.status}`, false);
          }
        } catch (err) {
          notify(`${label} failed: ${err.message}`, false);
          addAudit(`${label} error`, err.message || 'Network error', false);
        }
      };

      const renderDlq = () => {
        if (!dlqRows) return;
        dlqRows.innerHTML = '';
        if (dlqCount) dlqCount.textContent = state.dlq.length;
        if (!state.dlq.length) {
          const tr = document.createElement('tr');
          const td = document.createElement('td');
          td.colSpan = 6;
          td.className = 'muted';
          td.textContent = 'DLQ is empty.';
          tr.appendChild(td);
          dlqRows.appendChild(tr);
          return;
        }
        const frag = document.createDocumentFragment();
        for (const item of state.dlq) {
          const tr = document.createElement('tr');
          tr.dataset.id = item.__id;
          if (state.dlqSelected.has(item.__id)) tr.classList.add('selected');
          if (state.activeDlq === item.__id) tr.classList.add('active');
          const occurred = parseDate(item.__occurred || item.failed_at || item.timestamp);
          const reason = item.__reason || '—';
          tr.innerHTML = `
            <td><input type="checkbox" data-id="${escapeHtml(item.__id)}" ${state.dlqSelected.has(item.__id)?'checked':''}/></td>
            <td title="${escapeHtml(item.__originalId)}">${escapeHtml(item.__originalId)}</td>
            <td title="${occurred ? escapeHtml(occurred.toLocaleString()) : 'Timestamp unavailable'}">${formatRelative(occurred)}</td>
            <td title="${escapeHtml(reason)}">${escapeHtml(reason.length > 96 ? reason.slice(0,93) + '…' : reason)}</td>
            <td>${item.__attempts ?? '—'}</td>
            <td><button class="link-btn" data-inspect="${escapeHtml(item.__id)}">Inspect</button></td>
          `;
          frag.appendChild(tr);
        }
        dlqRows.appendChild(frag);
      };

      const updateDlqSelection = () => {
        if (dlqSelectedLabel) dlqSelectedLabel.textContent = `${state.dlqSelected.size} selected`;
        const disable = state.dlqSelected.size === 0;
        [dlqReplay, dlqDrop].forEach(btn => { if (btn) btn.disabled = disable; });
        if (dlqSelectAll) {
          const total = state.dlq.length;
          if (!total) {
            dlqSelectAll.checked = false;
            dlqSelectAll.indeterminate = false;
          } else {
            let all = true;
            for (const item of state.dlq) {
              if (!state.dlqSelected.has(item.__id)) { all = false; break; }
            }
            dlqSelectAll.checked = all;
            dlqSelectAll.indeterminate = !all && state.dlqSelected.size > 0;
          }
        }
      };

      const idsFromDlq = (ids) => ids.map(id => {
        const found = state.dlq.find(d => d.__id === id);
        return found?.__originalId || id;
      });

      const runDlqAction = async (label, path, { includeRate=true } = {}) => {
        if (!state.dlqSelected.size) { notify('Select at least one message first.', false); return; }
        const ids = Array.from(state.dlqSelected);
        const payload = { ids: idsFromDlq(ids) };
        if (includeRate) payload.rateLimit = parseInt(dlqRate?.value || '1', 10) || 1;
        try {
          const res = await api(path, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
          if (res.ok) {
            notify(`${label} ${ids.length} message${ids.length===1?'':'s'}.`);
            addAudit(`DLQ ${label.toLowerCase()}`, `${ids.length} message${ids.length===1?'':'s'}`, true);
            const removed = new Set(ids);
            state.dlq = state.dlq.filter(item => !removed.has(item.__id));
            state.dlqSelected.clear();
            if (state.activeDlq && removed.has(state.activeDlq)) { state.activeDlq = null; if (!state.activeRecon) resetDetail(); }
            renderDlq();
            updateDlqSelection();
          } else {
            notify(`${label} failed (HTTP ${res.status}).`, false);
            addAudit(`DLQ ${label.toLowerCase()} failed`, `HTTP ${res.status}`, false);
          }
        } catch (err) {
          notify(`${label} failed: ${err.message}`, false);
          addAudit(`DLQ ${label.toLowerCase()} error`, err.message || 'Network error', false);
        }
      };

      const loadRecon = async () => {
        try {
          const res = await api('/recon/anomalies');
          const body = res?.body;
          const items = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
          state.anomalies = items.map((item, idx) => normalizeAnomaly(item, idx));
          applyFilters();
          addAudit('Recon queue refreshed', `${state.anomalies.length} items`, res.ok);
          if (!res.ok) notify(`Recon fetch failed (HTTP ${res.status}).`, false);
        } catch (err) {
          state.anomalies = [];
          applyFilters();
          notify(`Recon fetch failed: ${err.message}`, false);
          addAudit('Recon fetch error', err.message || 'Network error', false);
        }
      };

      const loadDlq = async () => {
        try {
          const res = await api('/dlq/messages');
          const body = res?.body;
          const items = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : [];
          state.dlq = items.map((item, idx) => normalizeDlq(item, idx));
          state.dlqSelected.clear();
          renderDlq();
          updateDlqSelection();
          addAudit('DLQ refreshed', `${state.dlq.length} messages`, res.ok);
          if (!res.ok) notify(`DLQ fetch failed (HTTP ${res.status}).`, false);
        } catch (err) {
          state.dlq = [];
          renderDlq();
          updateDlqSelection();
          notify(`DLQ fetch failed: ${err.message}`, false);
          addAudit('DLQ fetch error', err.message || 'Network error', false);
        }
      };

      clearButton?.addEventListener('click', () => {
        state.selected.clear();
        updateSelection();
        renderVirtual();
      });

      selectAll?.addEventListener('change', (ev) => {
        if (ev.target.checked) {
          state.filtered.forEach(item => state.selected.add(item.__id));
        } else {
          state.filtered.forEach(item => state.selected.delete(item.__id));
        }
        updateSelection();
        renderVirtual();
      });

      severityInputs.forEach(cb => cb.addEventListener('change', applyFilters));
      ageSelect?.addEventListener('change', applyFilters);
      mlMin?.addEventListener('change', applyFilters);
      mlMax?.addEventListener('change', applyFilters);
      let searchTimer;
      searchInput?.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(applyFilters, 180);
      });

      scroller?.addEventListener('scroll', () => {
        requestAnimationFrame(renderVirtual);
      });

      window.addEventListener('resize', renderVirtual);

      bulkResolve?.addEventListener('click', () => runBulk('Resolved', '/recon/resolve'));
      bulkSnooze?.addEventListener('click', () => runBulk('Snoozed 24h', '/recon/snooze', { durationMinutes: 1440 }));
      bulkEscalate?.addEventListener('click', () => runBulk('Escalated to L2', '/recon/escalate', { target: 'L2' }));

      dlqRows?.addEventListener('change', ev => {
        if (!ev.target.matches('input[type="checkbox"]')) return;
        const id = ev.target.dataset.id;
        if (!id) return;
        if (ev.target.checked) state.dlqSelected.add(id); else state.dlqSelected.delete(id);
        ev.target.closest('tr')?.classList.toggle('selected', ev.target.checked);
        updateDlqSelection();
      });

      dlqRows?.addEventListener('click', ev => {
        const btn = ev.target.closest('button[data-inspect]');
        if (!btn) return;
        const id = btn.dataset.inspect;
        const item = state.dlq.find(d => d.__id === id);
        if (!item) return;
        state.activeDlq = id;
        state.activeRecon = null;
        showDetail('dlq', item);
        renderDlq();
      });

      dlqSelectAll?.addEventListener('change', ev => {
        if (ev.target.checked) {
          state.dlq.forEach(item => state.dlqSelected.add(item.__id));
        } else {
          state.dlqSelected.clear();
        }
        renderDlq();
        updateDlqSelection();
      });

      dlqReplay?.addEventListener('click', () => runDlqAction('Replayed', '/dlq/replay', { includeRate: true }));
      dlqDrop?.addEventListener('click', () => runDlqAction('Dropped', '/dlq/drop', { includeRate: false }));
      reloadDlq?.addEventListener('click', () => loadDlq());

      renderAudit();
      resetDetail();
      applyFilters();
      loadRecon();
      loadDlq();
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