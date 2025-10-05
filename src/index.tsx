import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { WithQuery } from "./ui/query";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <WithQuery>
    <App />
  </WithQuery>
);
