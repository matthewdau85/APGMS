import { api } from "../lib/utils.js";

const ROW_HEIGHT = 44;
const BUFFER = 6;

export default async function History(root) {
  root.innerHTML = `
  <section class="bg-white rounded-2xl shadow p-6">
    <h2 class="text-lg font-semibold">History</h2>
    <p class="text-sm text-gray-600 mt-1">Recent work. Click an item to see more.</p>

    <div class="mt-3 flex gap-2">
      <input id="q" class="border rounded px-3 py-2 text-sm w-80" placeholder="Filter by word (optional)"/>
      <button id="reload" class="px-3 py-2 rounded bg-gray-900 text-white text-sm">Refresh</button>
    </div>

    <div class="virtual-status" id="historyStatus" aria-live="polite"></div>
    <div class="virtual-table" id="historyShell" aria-busy="false">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>When</th>
            <th>Status</th>
            <th>Items</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
    <p id="historyEmpty" class="virtual-empty hidden">Nothing here yet.</p>
  </section>`;

  const qInput = root.querySelector("#q");
  const reloadBtn = root.querySelector("#reload");
  const rowsEl = root.querySelector("#rows");
  const statusEl = root.querySelector("#historyStatus");
  const shellEl = root.querySelector("#historyShell");
  const emptyEl = root.querySelector("#historyEmpty");

  if (!rowsEl || !statusEl || !shellEl || !reloadBtn || !qInput || !emptyEl) {
    return;
  }

  rowsEl.style.setProperty("--row-height", `${ROW_HEIGHT}px`);

  let jobs = [];
  let firstLoad = true;
  let requestToken = 0;
  let debounceTimer = 0;
  let raf = 0;
  let cleaned = false;
  let observer;

  const updateStatus = (text) => {
    statusEl.textContent = text;
  };

  const renderSkeleton = () => {
    shellEl.setAttribute("aria-busy", "true");
    rowsEl.replaceChildren();
    for (let i = 0; i < 6; i += 1) {
      const tr = document.createElement("tr");
      tr.className = "skeleton-row";
      const td = document.createElement("td");
      td.colSpan = 5;
      const block = document.createElement("div");
      block.className = "skeleton";
      block.style.height = "14px";
      block.style.width = `${40 + (i % 3) * 15}%`;
      td.appendChild(block);
      tr.appendChild(td);
      rowsEl.appendChild(tr);
    }
  };

  const renderError = (message) => {
    rowsEl.replaceChildren();
    const tr = document.createElement("tr");
    tr.className = "error";
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = message;
    tr.appendChild(td);
    rowsEl.appendChild(tr);
    shellEl.setAttribute("aria-busy", "false");
  };

  const makeSpacer = (count) => {
    const tr = document.createElement("tr");
    tr.className = "spacer";
    const td = document.createElement("td");
    td.colSpan = 5;
    td.style.height = `${count * ROW_HEIGHT}px`;
    tr.appendChild(td);
    return tr;
  };

  const createCell = (value, classNames = []) => {
    const td = document.createElement("td");
    td.textContent = value;
    classNames.forEach((name) => td.classList.add(name));
    return td;
  };

  const makeRow = (job) => {
    const tr = document.createElement("tr");

    const idCell = createCell(job?.id ?? "—", ["mono", "truncate"]);
    if (job?.id) idCell.title = job.id;

    const whenCell = createCell(job?.created_at ?? "—");
    if (job?.created_at) whenCell.title = job.created_at;

    const statusCell = createCell(job?.status ?? "—");
    const countCell = createCell(String(job?.count ?? "—"), ["num"]);

    const actionCell = document.createElement("td");
    actionCell.classList.add("actions");
    const link = document.createElement("a");
    link.href = "#/results";
    link.textContent = "Open";
    actionCell.appendChild(link);

    tr.append(idCell, whenCell, statusCell, countCell, actionCell);
    return tr;
  };

  const renderVirtual = (resetScroll = false) => {
    if (!jobs.length) {
      rowsEl.replaceChildren();
      shellEl.setAttribute("aria-busy", "false");
      return;
    }

    if (resetScroll) {
      rowsEl.scrollTop = 0;
    }

    const viewportHeight = rowsEl.clientHeight || 360;
    const scrollTop = rowsEl.scrollTop;
    const maxScroll = Math.max(0, jobs.length * ROW_HEIGHT - viewportHeight);
    if (!resetScroll && scrollTop > maxScroll) {
      rowsEl.scrollTop = maxScroll;
      return renderVirtual(false);
    }
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
    const end = Math.min(jobs.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + BUFFER);

    const fragment = document.createDocumentFragment();

    if (start > 0) {
      fragment.appendChild(makeSpacer(start));
    }

    for (let i = start; i < end; i += 1) {
      fragment.appendChild(makeRow(jobs[i]));
    }

    if (end < jobs.length) {
      fragment.appendChild(makeSpacer(jobs.length - end));
    }

    rowsEl.replaceChildren(fragment);
    shellEl.setAttribute("aria-busy", "false");
  };

  const scheduleRender = () => {
    if (!jobs.length) return;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      renderVirtual();
    });
  };

  const onScroll = () => {
    scheduleRender();
  };

  const onResize = () => {
    if (!jobs.length) return;
    renderVirtual();
  };

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    rowsEl.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", onResize);
    if (observer) observer.disconnect();
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  rowsEl.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onResize);

  const parentNode = root.parentNode;
  if (parentNode instanceof Node) {
    observer = new MutationObserver(() => {
      if (!root.isConnected) {
        cleanup();
      }
    });
    observer.observe(parentNode, { childList: true });
  }

  const load = async ({ resetScroll = true } = {}) => {
    const query = qInput.value.trim();
    const token = ++requestToken;

    reloadBtn.disabled = true;
    shellEl.setAttribute("aria-busy", "true");

    if (firstLoad) {
      renderSkeleton();
      emptyEl.classList.add("hidden");
      updateStatus("Loading history…");
    } else {
      updateStatus("Refreshing…");
    }

    try {
      const res = await api(`/jobs${query ? `?q=${encodeURIComponent(query)}` : ""}`);
      if (token !== requestToken) return;

      firstLoad = false;

      if (!res.ok || !Array.isArray(res.body)) {
        throw new Error(`Unexpected response: ${res.status}`);
      }

      jobs = res.body;

      if (!jobs.length) {
        rowsEl.replaceChildren();
        emptyEl.classList.remove("hidden");
        shellEl.setAttribute("aria-busy", "false");
        updateStatus(query ? "No history matches your filter." : "No history yet.");
        return;
      }

      emptyEl.classList.add("hidden");
      updateStatus(`Showing ${jobs.length} entr${jobs.length === 1 ? "y" : "ies"}${query ? " (filtered)" : ""}.`);
      renderVirtual(resetScroll);
    } catch (error) {
      if (token !== requestToken) return;
      firstLoad = false;
      jobs = [];
      emptyEl.classList.add("hidden");
      updateStatus("Unable to load history.");
      renderError("We couldn’t load history. Try again in a moment.");
      console.error(error);
    } finally {
      if (token === requestToken) {
        shellEl.setAttribute("aria-busy", "false");
        reloadBtn.disabled = false;
      }
    }
  };

  reloadBtn.addEventListener("click", () => load({ resetScroll: false }));

  qInput.addEventListener("input", () => {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => load({ resetScroll: true }), 220);
  });

  qInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      window.clearTimeout(debounceTimer);
      load({ resetScroll: true });
    }
  });

  await load({ resetScroll: true });

  // Ensure listeners are cleaned up if the view is removed without navigation (e.g. hot reload).
  root.addEventListener("destroy", cleanup, { once: true });
}
