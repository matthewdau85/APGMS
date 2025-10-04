export const $ = (sel, root=document) => root.querySelector(sel);
export const pretty = (v)=>{ try{ return JSON.stringify(typeof v==="string"?JSON.parse(v):v,null,2)}catch{ return String(v)}};
export const say = (msg, ok=true) => {
  const t = $("#toast"); if(!t) return;
  t.textContent = msg;
  t.className = "fixed bottom-4 right-4 text-white text-sm px-3 py-2 rounded-lg " + (ok?"bg-black":"bg-rose-600");
  t.classList.remove("hidden");
  setTimeout(()=>t.classList.add("hidden"),2200);
};
export const api = async (path, opts={})=>{
  const base = (window.GUI_CONFIG?.baseUrl||"/api").replace(/\/+$/,"");
  const res  = await fetch(base+path, opts);
  const txt  = await res.text();
  let body; try{ body = JSON.parse(txt) }catch{ body = txt }
  return { ok: res.ok, status: res.status, body, raw: txt };
};