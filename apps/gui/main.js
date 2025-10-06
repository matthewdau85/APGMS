import { onRoute, start } from "./lib/router.js";

const routes = new Map([
  ["/", () => import("./views/Home.js")],
  ["/import", () => import("./views/Import.js")],
  ["/results", () => import("./views/Results.js")],
  ["/history", () => import("./views/History.js")],
  ["/help", () => import("./views/Help.js")],
  ["/settings", () => import("./views/Settings.js")],
]);

const fallbackRoute = routes.get("/");

const app = document.getElementById("app");

function showRouteSkeleton() {
  if (!app) return;
  const wrap = document.createElement("div");
  wrap.className = "space-y-6";
  wrap.style.padding = "0";

  for (let i = 0; i < 3; i += 1) {
    const card = document.createElement("div");
    card.className = "card skeleton-card";
    card.style.minHeight = "96px";

    const heading = document.createElement("div");
    heading.className = "skeleton";
    heading.style.width = "36%";
    heading.style.height = "18px";

    const lineOne = document.createElement("div");
    lineOne.className = "skeleton";
    lineOne.style.width = "100%";
    lineOne.style.height = "12px";
    lineOne.style.marginTop = "14px";

    const lineTwo = document.createElement("div");
    lineTwo.className = "skeleton";
    lineTwo.style.width = "70%";
    lineTwo.style.height = "12px";
    lineTwo.style.marginTop = "8px";

    card.appendChild(heading);
    card.appendChild(lineOne);
    card.appendChild(lineTwo);
    wrap.appendChild(card);
  }

  app.replaceChildren(wrap);
}

function brand(){
  const cfg = window.GUI_CONFIG || {};
  const brandEl = document.getElementById("brand");
  if (brandEl) {
    brandEl.textContent = cfg.brand || "APGMS Normalizer";
  }
  const titleEl = document.getElementById("title");
  if (titleEl) {
    titleEl.textContent = cfg.title || "Customer Portal";
  }
  const docsEl = document.getElementById("docs");
  if (docsEl && cfg.links?.docs) {
    docsEl.href = cfg.links.docs;
  }
}
brand();

async function badge(){
  const b = document.getElementById("svc");
  if (!b) {
    return;
  }
  try {
    const r = await fetch((window.GUI_CONFIG?.baseUrl||"/api").replace(/\/+$/,"")+"/readyz",{cache:"no-store"});
    if (r.ok) { b.textContent="Ready"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-800"; }
    else { b.textContent="Not ready"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-rose-100 text-rose-800"; }
  } catch {
    b.textContent="Offline"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-rose-100 text-rose-800";
  }
}
badge();

onRoute(async p=>{
  if (!app) return;
  const loader = routes.get(p.split("?")[0]) || fallbackRoute;
  showRouteSkeleton();
  try {
    const mod = await loader();
    const View = mod?.default;
    const el = document.createElement("div");
    el.className = "space-y-6";
    app.replaceChildren(el);
    if (typeof View === "function") {
      await View(el);
    }
  } catch (error) {
    const card = document.createElement("div");
    card.className = "card";
    const heading = document.createElement("h2");
    heading.textContent = "We couldn't load that view";
    const copy = document.createElement("p");
    copy.textContent = "Please try again or refresh the page.";
    card.appendChild(heading);
    card.appendChild(copy);
    app.replaceChildren(card);
    console.error(error);
  }
});
start();
