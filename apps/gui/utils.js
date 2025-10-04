window.$ = (sel, root=document) => root.querySelector(sel);
window.$$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
window.$id = (id) => document.getElementById(id);
window.toast = (msg) => { const t=$id("toast"); t.textContent=msg; t.classList.remove("hidden"); setTimeout(()=>t.classList.add("hidden"),2400); };
window.pretty = (v) => { try { return JSON.stringify(typeof v==="string"?JSON.parse(v):v,null,2);} catch { return String(v);} };
function downloadText(name, text) {
  const blob = new Blob([text], {type:"application/json;charset=utf-8"});
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
window.downloadText = downloadText;