import { onRoute, start } from "./lib/router.js";
import { api } from "./lib/utils.js";
import Home from "./views/Home.js";
import Import from "./views/Import.js";
import Results from "./views/Results.js";
import History from "./views/History.js";
import Help from "./views/Help.js";
import Settings from "./views/Settings.js";

const routes = new Map([
  ["/", Home],
  ["/import", Import],
  ["/results", Results],
  ["/history", History],
  ["/help", Help],
  ["/settings", Settings],
]);

function brand(){
  const cfg = window.GUI_CONFIG || {};
  document.getElementById("brand").textContent = cfg.brand || "APGMS Normalizer";
  document.getElementById("title").textContent = cfg.title || "Customer Portal";
  if (cfg.links?.docs) document.getElementById("docs").href = cfg.links.docs;
}
brand();

async function badge(){
  const b = document.getElementById("svc");
  try {
    const r = await fetch((window.GUI_CONFIG?.baseUrl||"/api").replace(/\/+$/,"")+"/readyz",{cache:"no-store"});
    if (r.ok) { b.textContent="Ready"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-emerald-100 text-emerald-800"; }
    else { b.textContent="Not ready"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-rose-100 text-rose-800"; }
  } catch {
    b.textContent="Offline"; b.className="ml-auto inline-flex items-center px-2 py-1 text-xs rounded-full bg-rose-100 text-rose-800";
  }
}
badge();

const app = document.getElementById("app");
onRoute(async p=>{
  app.innerHTML="";
  const View = routes.get(p.split("?")[0]) || Home;
  const el = document.createElement("div");
  el.className="space-y-6";
  app.appendChild(el);
  await View(el);
});
start();