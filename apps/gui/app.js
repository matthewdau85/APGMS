(() => {
  const cfg = window.GUI_CONFIG || {};
  const role = String(cfg.role || "user").toLowerCase();
  const base = (cfg.baseUrl || "/api").replace(/\/+$/, "");
  const $ = (sel, root=document) => root.querySelector(sel);

  const routes = ["home","connections","transactions","tax-bas","help","settings"];
  function currentRoute(){ const h = location.hash.replace(/^#\/?/, "").toLowerCase(); return routes.includes(h) ? h : "home"; }

  function escapeHtml(str=""){
    return str.replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch] || ch);
  }

  function ensureToast(){
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role','status');
      document.body.appendChild(el);
    }
    return el;
  }
  const toastEl = ensureToast();
  let toastTimer = null;
  function showToast(msg, ok=true){
    toastEl.textContent = msg;
    toastEl.classList.toggle('error', !ok);
    toastEl.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>toastEl.classList.remove('show'), 2600);
  }

  async function api(path, init={}) {
    const opts = { ...init };
    const headers = { ...(opts.headers || {}) };
    if (opts.body && !('Content-Type' in headers)) headers['Content-Type'] = 'application/json';
    opts.headers = headers;
    const res = await fetch(base + path, opts);
    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    let data = text;
    if (ct.includes('application/json') && text) {
      try { data = JSON.parse(text); } catch { data = text; }
    }
    if (!res.ok) {
      const msg = typeof data === 'string'
        ? (data.trim() || String(res.status))
        : (data.error || data.message || String(res.status));
      throw new Error(msg);
    }
    if (ct.includes('application/json')) return data;
    return text;
  }

  const PERIOD_STORE = 'apgms.cmd.lastPeriod';
  const RECENT_STORE = 'apgms.cmd.recents';

  function loadJSON(key, fallback){
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const val = JSON.parse(raw);
      return val ?? fallback;
    } catch { return fallback; }
  }
  function saveJSON(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  }

  function loadPeriodDefaults(){
    return loadJSON(PERIOD_STORE, {});
  }
  function savePeriodDefaults(details){
    const keep = (({abn,taxType,periodId})=>({abn,taxType,periodId}))(details);
    saveJSON(PERIOD_STORE, keep);
  }
  function promptPeriodDetails(context){
    const saved = loadPeriodDefaults();
    const abn = window.prompt(`[${context}] ABN`, saved.abn || '12345678901');
    if (!abn) return null;
    const taxType = window.prompt(`[${context}] Tax type`, saved.taxType || 'GST');
    if (!taxType) return null;
    const periodId = window.prompt(`[${context}] Period ID`, saved.periodId || '2024-Q4');
    if (!periodId) return null;
    const details = {
      abn: abn.trim(),
      taxType: taxType.trim().toUpperCase(),
      periodId: periodId.trim()
    };
    savePeriodDefaults(details);
    return details;
  }

  function openInWindow(title, payload){
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
    const w = window.open('', '_blank');
    if (w) {
      w.document.write(`<!doctype html><title>${escapeHtml(title)}</title><pre style="white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;margin:16px;">${escapeHtml(text)}</pre>`);
      w.document.close();
      return true;
    }
    console.log(title, payload);
    return false;
  }

  const actions = {
    goto(route){ location.hash = '#/' + route; },
    openHelp(){ location.hash = '#/help'; },
    openSwagger(){ const url = cfg.swaggerPath || (base + '/openapi.json'); window.open(url, '_blank'); },
    openSupport(){ window.open('mailto:support@apgms.example'); },
    async checkReady(){
      try {
        const text = await api('/readyz', { cache:'no-store' });
        showToast(`Service ready (${String(text).trim() || 'ok'})`);
      } catch(e){ showToast('Ready check failed: ' + e.message, false); }
    },
    async showMetrics(){
      try {
        const metrics = await api('/metrics', { cache:'no-store' });
        const opened = openInWindow('APGMS Metrics', metrics);
        showToast(opened ? 'Metrics opened in a new window.' : 'Metrics written to console (popup blocked).');
      } catch(e){ showToast('Metrics failed: ' + e.message, false); }
    },
    async issueRpt(){
      const details = promptPeriodDetails('Issue RPT');
      if (!details) return;
      try {
        const res = await api('/rpt/issue', { method:'POST', body: JSON.stringify(details) });
        showToast(`RPT issued for ${details.periodId}.`);
        console.log('RPT issued', res);
      } catch(e){ showToast('Issue RPT failed: ' + e.message, false); }
    },
    async viewEvidence(){
      const details = promptPeriodDetails('View Evidence');
      if (!details) return;
      try {
        const query = new URLSearchParams(details).toString();
        const data = await api('/evidence?' + query);
        const ok = openInWindow('RPT Evidence', data);
        showToast(ok ? 'Evidence opened in a new window.' : 'Evidence logged to console (popup blocked).');
      } catch(e){ showToast('Evidence fetch failed: ' + e.message, false); }
    },
    async release(){
      const details = promptPeriodDetails('Release payment');
      if (!details) return;
      try {
        const data = await api('/release', { method:'POST', body: JSON.stringify(details) });
        const ref = data?.bank_receipt_hash || 'released';
        showToast(`Release triggered (${ref}).`);
        console.log('Release', data);
      } catch(e){ showToast('Release failed: ' + e.message, false); }
    }
  };

  const commandDefinitions = [
    { id:'route:home', label:'Home', description:'Go to dashboard overview', section:'Routes', hint:'G H', keywords:'home dashboard main', run:()=>actions.goto('home') },
    { id:'route:connections', label:'Connections', description:'Manage data sources', section:'Routes', hint:'G C', keywords:'connections bank payroll', run:()=>actions.goto('connections') },
    { id:'route:transactions', label:'Transactions', description:'Review normalized activity', section:'Routes', hint:'G T', keywords:'transactions search ledger', run:()=>actions.goto('transactions') },
    { id:'route:tax-bas', label:'Tax & BAS', description:'Prepare BAS and validate', section:'Routes', hint:'G B', keywords:'tax bas ato', run:()=>actions.goto('tax-bas') },
    { id:'route:help', label:'Help & Guidance', description:'Read how-to content', section:'Routes', hint:'G ?', keywords:'help guidance support', run:()=>actions.goto('help') },
    { id:'route:settings', label:'Settings', description:'Portal preferences', section:'Routes', hint:'G ,', keywords:'settings preferences theme', run:()=>actions.goto('settings') },

    { id:'action:ready', label:'Check service readiness', description:'Ping /readyz endpoint', section:'Actions', hint:'↵', keywords:'health ready readyz status', run:()=>actions.checkReady() },
    { id:'action:metrics', label:'View live metrics', description:'Open Prometheus metrics stream', section:'Actions', hint:'M', keywords:'metrics monitoring prometheus', run:()=>actions.showMetrics() },
    { id:'action:issue-rpt', label:'Issue RPT', description:'Sign and stage a Real-time Payment Token', section:'Actions', hint:'I', keywords:'rpt issue token compliance', run:()=>actions.issueRpt() },
    { id:'action:view-evidence', label:'View evidence bundle', description:'Open the evidence package for a period', section:'Actions', hint:'E', keywords:'evidence audit rpt bundle', run:()=>actions.viewEvidence() },
    { id:'action:open-swagger', label:'Open API reference', description:'Launch OpenAPI schema', section:'Help', hint:'?', keywords:'swagger api reference docs', run:()=>actions.openSwagger() },
    { id:'help:shortcuts', label:'Keyboard shortcuts', description:'See available operations', section:'Help', hint:'/', keywords:'keyboard shortcuts help', run:()=>{ actions.openHelp(); showToast('Help opened.'); } },
    { id:'help:support', label:'Contact support', description:'Email the APGMS support desk', section:'Help', hint:'@', keywords:'support email contact helpdesk', run:()=>actions.openSupport() },

    { id:'admin:release', label:'Admin: Release payment', description:'Debit OWA and mark period released', section:'Admin Ops', hint:'A R', keywords:'admin release funds owa', roles:['admin'], run:()=>actions.release() },
    { id:'admin:metrics-snapshot', label:'Admin: Capture metrics snapshot', description:'Download metrics output to a window', section:'Admin Ops', hint:'A M', keywords:'admin metrics snapshot monitoring', roles:['admin'], run:()=>actions.showMetrics() }
  ];

  const palette = createCommandPalette();

  window.addEventListener('hashchange', () => render());

  function createCommandPalette(){
    const overlay = document.createElement('div');
    overlay.className = 'cmdk-root hidden';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
      <div class="cmdk-panel" role="dialog" aria-modal="true" aria-label="Command palette">
        <input class="cmdk-input" type="text" placeholder="Search actions, navigation, or help…" autocomplete="off" />
        <div class="cmdk-results" role="listbox"></div>
      </div>`;
    document.body.appendChild(overlay);
    const panel = overlay.querySelector('.cmdk-panel');
    const input = overlay.querySelector('.cmdk-input');
    const results = overlay.querySelector('.cmdk-results');

    commandDefinitions.forEach(cmd => {
      cmd.search = `${cmd.label} ${(cmd.keywords||'')} ${(cmd.description||'')}`.toLowerCase();
    });

    let open = false;
    let items = [];
    let activeIndex = -1;
    let recent = loadJSON(RECENT_STORE, []);
    const commandMap = new Map(commandDefinitions.map(cmd => [cmd.id, cmd]));

    function allowedCommands(){
      return commandDefinitions.filter(cmd => {
        if (!cmd.roles) return true;
        return cmd.roles.includes(role);
      });
    }

    function remember(id){
      recent = [id, ...recent.filter(x => x !== id)];
      if (recent.length > 7) recent = recent.slice(0,7);
      saveJSON(RECENT_STORE, recent);
    }

    function renderList(query){
      const q = (query || '').trim().toLowerCase();
      const allowed = allowedCommands();
      const allowedIds = new Set(allowed.map(c => c.id));
      const groups = [];
      items = [];
      results.innerHTML = '';

      if (!q && recent.length){
        const recentItems = recent.map(id => commandMap.get(id)).filter(cmd => cmd && allowedIds.has(cmd.id));
        if (recentItems.length){
          groups.push({ title:'Recent', commands: recentItems });
        }
      }

      const matches = allowed.filter(cmd => !q || cmd.search.includes(q));
      const sectionOrder = ['Routes','Actions','Admin Ops','Help'];
      sectionOrder.forEach(section => {
        const list = matches.filter(cmd => cmd.section === section);
        if (list.length) groups.push({ title: section, commands: list });
      });

      if (!groups.length){
        const empty = document.createElement('div');
        empty.className = 'cmdk-empty';
        empty.textContent = 'No results';
        results.appendChild(empty);
        activeIndex = -1;
        return;
      }

      groups.forEach(group => {
        const wrap = document.createElement('div');
        wrap.className = 'cmdk-section';
        const heading = document.createElement('h3');
        heading.textContent = group.title;
        wrap.appendChild(heading);
        group.commands.forEach(cmd => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'cmdk-item';
          btn.dataset.commandId = cmd.id;
          const left = document.createElement('div');
          left.style.display = 'flex';
          left.style.flexDirection = 'column';
          left.style.alignItems = 'flex-start';
          const title = document.createElement('span');
          title.textContent = cmd.label;
          left.appendChild(title);
          if (cmd.description){
            const sub = document.createElement('small');
            sub.textContent = cmd.description;
            left.appendChild(sub);
          }
          btn.appendChild(left);
          if (cmd.hint){
            const hint = document.createElement('span');
            hint.className = 'cmdk-hint';
            hint.textContent = cmd.hint;
            btn.appendChild(hint);
          }
          const idx = items.length;
          btn.addEventListener('click', () => execute(idx));
          btn.addEventListener('mouseenter', () => highlight(idx));
          wrap.appendChild(btn);
          items.push({ cmd, el: btn });
        });
        results.appendChild(wrap);
      });

      highlight(items.length ? 0 : -1);
    }

    function highlight(idx){
      if (idx < 0 || idx >= items.length){
        items.forEach(entry => entry.el.classList.remove('active'));
        activeIndex = -1;
        return;
      }
      items.forEach((entry, i) => entry.el.classList.toggle('active', i === idx));
      activeIndex = idx;
      const el = items[idx].el;
      const rect = el.getBoundingClientRect();
      const containerRect = results.getBoundingClientRect();
      if (rect.top < containerRect.top) el.scrollIntoView({ block:'nearest' });
      if (rect.bottom > containerRect.bottom) el.scrollIntoView({ block:'nearest' });
    }

    function execute(idx){
      if (idx < 0 || idx >= items.length) return;
      const { cmd } = items[idx];
      remember(cmd.id);
      close();
      try {
        const out = cmd.run();
        if (out && typeof out.then === 'function') {
          out.catch(err => { console.error(err); showToast(err.message || 'Command failed', false); });
        }
      } catch(err){
        console.error(err);
        showToast(err.message || 'Command failed', false);
      }
    }

    function openPalette(){
      if (open) return;
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden','false');
      open = true;
      input.value = '';
      renderList('');
      setTimeout(()=>input.focus(), 10);
    }

    function close(){
      if (!open) return;
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden','true');
      open = false;
      input.value = '';
      items = [];
      activeIndex = -1;
    }

    input.addEventListener('input', e => renderList(e.target.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown'){
        e.preventDefault();
        if (items.length) highlight((activeIndex + 1) % items.length);
      } else if (e.key === 'ArrowUp'){
        e.preventDefault();
        if (items.length) highlight((activeIndex - 1 + items.length) % items.length);
      } else if (e.key === 'Enter'){
        e.preventDefault();
        execute(activeIndex >= 0 ? activeIndex : 0);
      } else if (e.key === 'Tab'){
        e.preventDefault();
        if (items.length) highlight((activeIndex + (e.shiftKey ? -1 : 1) + items.length) % items.length);
      }
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    panel.addEventListener('click', e => e.stopPropagation());

    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'){
        e.preventDefault();
        open ? close() : openPalette();
      } else if (open && e.key === 'Escape'){
        e.preventDefault();
        close();
      }
    });

    return {
      open: openPalette,
      close,
      remember,
      recordRoute(view){
        const id = `route:${view}`;
        if (commandMap.has(id)) remember(id);
      }
    };
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

    help(){
      return `
        ${this.nav('help')}
        <div class="card">
          <h3>Help & Guidance</h3>
          <ol>
            <li>Use <b>Connections</b> to link Bank (CDR), Payroll/POS, and ATO (SBR).</li>
            <li>Import or auto-ingest data; view in <b>Transactions</b>.</li>
            <li>Prepare and validate <b>Tax & BAS</b>; lodge via SBR when ready.</li>
            <li>Use <span class="kbd">⌘K</span> for quick navigation and operations.</li>
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
    palette.recordRoute(view);
  }

  render();
})();
