import React from "react";
import { createRoot } from "react-dom/client";

function App() {
  return (
    <div style={{padding:16,fontFamily:"system-ui"}}>
      <h1>APGMS Console</h1>
      <p>Status tiles and RPT widgets will appear here. (P40, P41, P42)</p>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);