(() => {
  const cfg = window.GUI_CONFIG || {};
  const base = (cfg.baseUrl || "/api").replace(/\/+$/, "");
  const $ = (sel, root = document) => root.querySelector(sel);

  const fallbackBasContext = {
    cashVsAccrual:
      "Cash-basis reporters recognise GST when money is received or paid. Accrual-basis reporters recognise GST when the invoice is issued or received, even if payment happens later.",
    dgst:
      "Deferred GST (DGST) must be reported in the period that covers the Australian Border Force import declaration statement date, not the cargo arrival date.",
    labels: [
      {
        code: "G1",
        title: "Total sales",
        description:
          "Total taxable supplies including GST and exports (report GST-free amounts separately).",
        link: "https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/In-detail/BAS-Label-guides/G1-Total-sales/",
        note: "Include cash or accrual timing in line with your accounting basis."
      },
      {
        code: "W1",
        title: "Total salary and wages",
        description:
          "Report gross payments subject to withholding (salary, wages, director fees).",
        link: "https://www.ato.gov.au/Forms/How-to-complete-your-activity-statement/W1---total-salary-wages-and-other-payments/",
        note: "Align PAYG withholding with the pay event period submitted to the ATO."
      },
      {
        code: "1A",
        title: "GST on sales",
        description: "GST collected on taxable supplies for the period.",
        link: "https://www.ato.gov.au/Business/Business-activity-statements-(BAS)/In-detail/BAS-Label-guides/1A-GST-on-sales/",
        note: "Derive from G1 after excluding GST-free and input taxed amounts."
      },
      {
        code: "DGST",
        title: "Deferred GST",
        description: "GST deferred at importation under the deferred GST scheme.",
        link: "https://www.ato.gov.au/Business/Deferred-GST-scheme/",
        note: "Report based on the Integrated Cargo System (ICS) deferred GST statement date."
      }
    ]
  };

  const fallbackRuleUpdates = [
    {
      code: "DGST",
      title: "DGST timing aligns with ICS statement date",
      summary:
        "Deferred GST is payable when the import declaration statement is issued. The goods arrival date no longer drives the period selection.",
      effectiveFrom: "2025-09-01",
      link: "https://www.ato.gov.au/Business/Deferred-GST-scheme/"
    },
    {
      code: "BAS-BASIS",
      title: "Clarified cash vs accrual mapping",
      summary:
        "Cash reporters capture GST when payments clear; accrual reporters capture GST when invoices issue. This banner reminds preparers which mode is active.",
      effectiveFrom: "2025-07-01",
      link: "https://www.ato.gov.au/Business/GST/Accounting-for-GST/Cash-and-accrual-accounting/"
    }
  ];

  const fallbackSegments = [
    {
      label: "July-August 2025",
      start: "2025-07-01",
      end: "2025-08-31",
      ratesVersion: "2025.1",
      note: "Carry-over fuel tax credit rates remain in effect until 31 Aug."
    },
    {
      label: "September 2025",
      start: "2025-09-01",
      end: "2025-09-30",
      ratesVersion: "2025.2",
      note: "Updated DGST recognition applies from 1 Sep."
    }
  ];

  const routes = ["home", "connections", "transactions", "tax-bas", "help", "settings"];

  function currentRoute() {
    const raw = location.hash.replace(/^#/, "");
    const [path] = raw.split("?");
    const parts = path.split("/").filter(Boolean);
    const view = parts[0] || "home";
    const detail = parts.slice(1).map((p) => p.toLowerCase());
    return { view: routes.includes(view) ? view : "home", detail };
  }

  window.addEventListener("hashchange", () => render());

  async function api(path, init = {}) {
    const r = await fetch(base + path, {
      headers: { "Content-Type": "application/json" },
      ...init
    });
    if (!r.ok) throw new Error(String(r.status));
    const ct = r.headers.get("content-type") || "";
    return ct.includes("application/json") ? r.json() : r.text();
  }

  function getModeInfo() {
    const rules = cfg.rules || {};
    const appMode = cfg.appMode || rules.appMode || rules.mode || "Sandbox";
    const ratesVersion = cfg.ratesVersion || rules.ratesVersion || rules.version || "n/a";
    const effectiveFrom = rules.effectiveFrom || cfg.ratesEffectiveFrom || "";
    const effectiveTo = rules.effectiveTo || cfg.ratesEffectiveTo || "";
    const periodLabel = cfg.periodLabel || rules.period || "Current period";
    return { appMode, ratesVersion, effectiveFrom, effectiveTo, periodLabel };
  }

  function getRuleUpdates() {
    const updates = Array.isArray(cfg.ruleUpdates) && cfg.ruleUpdates.length ? cfg.ruleUpdates : fallbackRuleUpdates;
    return updates.map((u) => ({
      code: u.code,
      title: u.title,
      summary: u.summary,
      effectiveFrom: u.effectiveFrom,
      link: u.link
    }));
  }

  function getSegments() {
    return Array.isArray(cfg.ruleSegments) && cfg.ruleSegments.length ? cfg.ruleSegments : fallbackSegments;
  }

  function getBasContext() {
    const ctx = cfg.basContext || {};
    const cashVsAccrual = ctx.cashVsAccrual || fallbackBasContext.cashVsAccrual;
    const dgst = ctx.dgst || fallbackBasContext.dgst;
    const labels = Array.isArray(ctx.labels) && ctx.labels.length ? ctx.labels : fallbackBasContext.labels;
    return { cashVsAccrual, dgst, labels };
  }

  function renderSegmentsBlock(segments) {
    if (!segments.length) return "";
    return `
      <div class="segment-list" aria-live="polite">
        ${segments
          .map(
            (seg) => `
              <div class="segment-item">
                <div class="segment-dates">${seg.label || `${seg.start} - ${seg.end}`}</div>
                <div class="segment-meta"><span class="badge">${seg.ratesVersion}</span>${seg.note ? `<span>${seg.note}</span>` : ""}</div>
                <div class="segment-range">${seg.start} to ${seg.end}</div>
              </div>
            `
          )
          .join("")}
      </div>`;
  }

  function renderUpdatesBlock(updates, heading = "What\u2019s New") {
    if (!updates.length) return "";
    return `
      <div class="whats-new">
        <h4>${heading}</h4>
        <ul>
          ${updates
            .map(
              (u) => `
                <li class="whats-new-item">
                  <span class="badge-new" aria-label="Updated rule">New</span>
                  <div>
                    <div class="whats-new-title">${u.title}</div>
                    <div class="whats-new-date">Effective ${u.effectiveFrom || "TBA"}</div>
                    <p>${u.summary}</p>
                    ${u.link ? `<a class="external" href="${u.link}" target="_blank" rel="noopener">Read update</a>` : ""}
                  </div>
                </li>
              `
            )
            .join("")}
        </ul>
      </div>`;
  }

  function modeBanner() {
    const info = getModeInfo();
    const href = cfg.links?.taxRules || "#/help/tax-rules";
    const effective = info.effectiveFrom
      ? `${info.effectiveFrom}${info.effectiveTo ? " to " + info.effectiveTo : ""}`
      : "Active now";
    return `
      <div class="mode-banner" role="status" aria-live="polite">
        <div class="mode-pill" aria-label="Operating mode">${info.appMode}</div>
        <div class="mode-text">
          <div class="mode-line"><strong>Rates:</strong> ${info.ratesVersion}</div>
          <div class="mode-line"><strong>Effective:</strong> ${effective}</div>
        </div>
        <a class="mode-link" href="${href}">Tax rule reference</a>
      </div>`;
  }

  function layout(viewHtml) {
    return `${modeBanner()}${viewHtml}`;
  }

  const View = {
    nav(active) {
      return `
        <nav aria-label="Primary">
          <a href="#/home"        class="${active === "home" ? "active" : ""}">Home</a>
          <a href="#/connections" class="${active === "connections" ? "active" : ""}">Connections</a>
          <a href="#/transactions"class="${active === "transactions" ? "active" : ""}">Transactions</a>
          <a href="#/tax-bas"     class="${active === "tax-bas" ? "active" : ""}">Tax & BAS</a>
          <a href="#/help"        class="${active === "help" ? "active" : ""}">Help</a>
          <a href="#/settings"    class="${active === "settings" ? "active" : ""}">Settings</a>
        </nav>`;
    },

    home() {
      return `
        ${this.nav("home")}
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
        <div class="footer">OpenAPI: <a target="_blank" rel="noopener" href="${cfg.swaggerPath || "/api/openapi.json"}">${cfg.swaggerPath || "/api/openapi.json"}</a></div>
      `;
    },

    connections() {
      return `
        ${this.nav("connections")}
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

    transactions() {
      return `
        ${this.nav("transactions")}
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

    "tax-bas"() {
      const info = getModeInfo();
      const updates = getRuleUpdates();
      const segments = getSegments();
      const basCtx = getBasContext();
      return `
        ${this.nav("tax-bas")}
        <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
          <div class="card">
            <h3>BAS Preparation</h3>
            <p class="muted">${info.periodLabel}</p>
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
        <div class="grid" style="grid-template-columns:1fr 1fr; margin-top:12px">
          <div class="card">
            <h3>GST rule context</h3>
            <p>The current period uses <strong>${info.ratesVersion}</strong> rates for the <strong>${info.appMode}</strong> mode.</p>
            ${renderSegmentsBlock(segments)}
            ${renderUpdatesBlock(updates)}
          </div>
          <div class="card">
            <h3>BAS labels & statutory timing</h3>
            <p class="muted">Each label links to the ATO explanation for that obligation.</p>
            <dl class="bas-labels">
              ${basCtx.labels
                .map(
                  (label) => `
                    <div class="bas-label" data-label="${label.code}">
                      <dt><span class="badge">${label.code}</span> ${label.title}</dt>
                      <dd>
                        <p>${label.description}</p>
                        ${label.note ? `<p class="muted">${label.note}</p>` : ""}
                        ${label.link ? `<a class="external" href="${label.link}" target="_blank" rel="noopener">Read guidance</a>` : ""}
                      </dd>
                    </div>
                  `
                )
                .join("")}
            </dl>
            <div class="bas-hint"><strong>Cash vs accrual:</strong> ${basCtx.cashVsAccrual}</div>
            <div class="bas-hint"><strong>Deferred GST (DGST):</strong> ${basCtx.dgst}</div>
          </div>
        </div>
      `;
    },

    help(ctx = {}) {
      const section = (ctx.detail && ctx.detail[0]) || "overview";
      const info = getModeInfo();
      const updates = getRuleUpdates();
      const segments = getSegments();
      const basCtx = getBasContext();
      const sections = [
        {
          id: "overview",
          title: "Portal overview",
          body: `
            <p>Use the navigation to connect data sources, review transactions, and prepare statutory filings.</p>
            <ol>
              <li>Connect bank, payroll, and commerce sources to keep ledgers synchronised.</li>
              <li>Review transformed transactions for anomalies before creating the BAS.</li>
              <li>Validate with the ATO and lodge once the statutory period closes.</li>
            </ol>
          `
        },
        {
          id: "tax-rules",
          title: "Tax rules & effective dates",
          body: `
            <p>The service is running in <strong>${info.appMode}</strong> mode with rates version <strong>${info.ratesVersion}</strong>.</p>
            <p>Effective window: ${info.effectiveFrom || "current"}${info.effectiveTo ? ` to ${info.effectiveTo}` : ""}. Preview the BAS to confirm figures align with these statutory windows.</p>
            ${renderSegmentsBlock(segments)}
            ${renderUpdatesBlock(updates, "Recent rule updates")}
          `
        },
        {
          id: "bas-labels",
          title: "BAS labels guidance",
          body: `
            <p>These BAS codes align with Australian Taxation Office (ATO) definitions. Select the label to open the related guidance.</p>
            <ul class="help-bas-list">
              ${basCtx.labels
                .map(
                  (label) => `
                    <li>
                      <span class="badge">${label.code}</span>
                      <span class="help-bas-title">${label.title}</span>
                      ${label.link ? `<a class="external" href="${label.link}" target="_blank" rel="noopener">ATO reference</a>` : ""}
                      <div class="help-bas-desc">${label.description}</div>
                      ${label.note ? `<div class="help-bas-note">${label.note}</div>` : ""}
                    </li>
                  `
                )
                .join("")}
            </ul>
            <p><strong>Cash vs accrual:</strong> ${basCtx.cashVsAccrual}</p>
            <p><strong>Deferred GST (DGST):</strong> ${basCtx.dgst}</p>
          `
        }
      ];

      return `
        ${this.nav("help")}
        <div class="help-wrapper">
          <aside class="card help-sidebar">
            <h3>Help & Guidance</h3>
            <ul>
              ${sections
                .map(
                  (s) => `
                    <li><a class="${section === s.id ? "active" : ""}" href="#/help/${s.id}">${s.title}</a></li>
                  `
                )
                .join("")}
            </ul>
          </aside>
          <div class="card help-content">
            ${sections
              .map(
                (s) => `
                  <article id="help-${s.id}" data-help-section="${s.id}" class="help-section ${section === s.id ? "active" : ""}">
                    <h4>${s.title}</h4>
                    ${s.body}
                  </article>
                `
              )
              .join("")}
          </div>
        </div>
      `;
    },

    settings() {
      return `
        ${this.nav("settings")}
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

  async function wire(view, ctx = {}) {
    if (view === "home") {
      $("#btnReady")?.addEventListener("click", async () => {
        const pre = $("#svcOut");
        pre.textContent = "Checking...";
        try {
          const r = await fetch(base + "/readyz");
          pre.textContent = "HTTP " + r.status;
        } catch {
          pre.textContent = "Unreachable";
        }
      });
      $("#btnMetrics")?.addEventListener("click", async () => {
        const pre = $("#svcOut");
        pre.textContent = "Loading metrics...";
        try {
          pre.textContent = await (await fetch(base + "/metrics")).text();
        } catch {
          pre.textContent = "Failed";
        }
      });
      $("#btnUpload")?.addEventListener("click", async () => {
        const f = $("#file").files[0];
        const out = $("#normOut");
        if (!f) {
          alert("Choose a file");
          return;
        }
        const text = await f.text();
        const payload =
          text.trim().startsWith("{") || text.trim().startsWith("[")
            ? JSON.parse(text)
            : { csv: text };
        out.textContent = "Uploading...";
        try {
          const res = await api("/normalize", { method: "POST", body: JSON.stringify(payload) });
          out.textContent = JSON.stringify(res, null, 2);
        } catch (e) {
          out.textContent = "Failed: " + e.message;
        }
      });
      try {
        const y = await api("/dashboard/yesterday");
        $("#yesterday").textContent = JSON.stringify(y);
      } catch {
        $("#yesterday").textContent = "N/A";
      }
    }

    if (view === "connections") {
      async function loadList() {
        const rows = await api("/connections");
        const tb = $("#connTable tbody");
        tb.innerHTML = "";
        rows.forEach((x) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${x.type}</td><td>${x.provider}</td><td>${x.status}</td><td><button class="btn" data-id="${x.id}">Remove</button></td>`;
          tb.appendChild(tr);
        });
        tb.querySelectorAll("button").forEach((btn) => {
          btn.onclick = async () => {
            await api(`/connections/${btn.dataset.id}`, { method: "DELETE" });
            loadList();
          };
        });
      }
      $("#btnConnect").onclick = async () => {
        $("#connMsg").textContent = "Starting connection...";
        const type = $("#connType").value;
        const provider = $("#provider").value;
        try {
          const { url } = await api("/connections/start", {
            method: "POST",
            body: JSON.stringify({ type, provider })
          });
          $("#connMsg").innerHTML = `Open auth window: <a target="_blank" rel="noopener" href="${url}">${url}</a>`;
        } catch (e) {
          $("#connMsg").textContent = "Failed: " + e.message;
        }
      };
      loadList();
    }

    if (view === "transactions") {
      async function load() {
        const q = $("#q").value;
        const src = $("#filterSource").value;
        const data = await api(`/transactions?q=${encodeURIComponent(q || "")}&source=${encodeURIComponent(src || "")}`);
        const tb = $("#txTable tbody");
        tb.innerHTML = "";
        data.items.forEach((t) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${t.date}</td><td>${t.source}</td><td>${t.description}</td><td style="text-align:right">${t.amount.toFixed(2)}</td><td>${t.category || ""}</td>`;
          tb.appendChild(tr);
        });
        const sel = $("#filterSource");
        sel.innerHTML = '<option value="">All sources</option>';
        data.sources.forEach((s) => {
          const o = document.createElement("option");
          o.value = s;
          o.textContent = s;
          sel.appendChild(o);
        });
      }
      $("#btnRefresh").onclick = load;
      load();
    }

    if (view === "tax-bas") {
      $("#btnPreviewBas").onclick = async () => {
        const out = $("#basOut");
        out.textContent = "Calculating...";
        try {
          out.textContent = JSON.stringify(await api("/bas/preview"), null, 2);
        } catch (e) {
          out.textContent = "Failed: " + e.message;
        }
      };
      $("#btnValidateBas").onclick = async () => {
        $("#lodgeMsg").textContent = "Validating with ATO...";
        try {
          await api("/bas/validate", { method: "POST" });
          $("#lodgeMsg").textContent = "Validated";
        } catch (e) {
          $("#lodgeMsg").textContent = "Failed: " + e.message;
        }
      };
      $("#btnLodgeBas").onclick = async () => {
        $("#lodgeMsg").textContent = "Lodging with ATO...";
        try {
          await api("/bas/lodge", { method: "POST" });
          $("#lodgeMsg").textContent = "Lodged";
        } catch (e) {
          $("#lodgeMsg").textContent = "Failed: " + e.message;
        }
      };
      try {
        $("#atoStatus").textContent = (await api("/ato/status")).status;
      } catch {
        $("#atoStatus").textContent = "Unavailable";
      }
    }

    if (view === "help") {
      const target = ctx.detail && ctx.detail[0];
      if (target) {
        const el = document.querySelector(`[data-help-section="${target}"]`);
        if (el) {
          el.classList.add("help-highlight");
          setTimeout(() => el.classList.remove("help-highlight"), 1800);
          el.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }
    }

    if (view === "settings") {
      $("#theme").value = localStorage.getItem("theme") || "light";
      document.documentElement.classList.toggle("theme-dark", $("#theme").value === "dark");
      $("#theme").addEventListener("change", (e) => {
        localStorage.setItem("theme", e.target.value);
        document.documentElement.classList.toggle("theme-dark", e.target.value === "dark");
      });
      $("#btnSaveSettings").onclick = async () => {
        const payload = {
          retentionMonths: parseInt($("#retention").value, 10),
          piiMask: $("#pii").value === "on"
        };
        $("#saveMsg").textContent = "Saving...";
        try {
          await api("/settings", { method: "POST", body: JSON.stringify(payload) });
          $("#saveMsg").textContent = "Saved.";
        } catch (e) {
          $("#saveMsg").textContent = "Failed: " + e.message;
        }
      };
    }
  }

  function render() {
    const { view, detail } = currentRoute();
    const root = document.getElementById("app");
    const html = View[view] ? View[view].call(View, { detail }) : View.home.call(View, { detail });
    root.innerHTML = layout(html);
    wire(view, { detail });
  }

  render();
})();
