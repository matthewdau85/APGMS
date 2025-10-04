const subs = new Set();
export const goto = (hash)=>{ location.hash = hash };
export const onRoute = (fn)=>{ subs.add(fn); return ()=>subs.delete(fn) };
const emit=()=>{ const p=(location.hash||"#/").replace(/^#/,""); subs.forEach(fn=>fn(p)) };
addEventListener("hashchange",emit);
export const start = ()=>{ if(!location.hash) location.hash="#/"; emit(); };