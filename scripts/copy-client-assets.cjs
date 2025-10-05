#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const outDir = path.join(projectRoot, "dist", "client");
const publicDir = path.join(projectRoot, "public");
const styles = path.join(projectRoot, "src", "index.css");

fs.mkdirSync(outDir, { recursive: true });

if (fs.existsSync(publicDir)) {
  for (const entry of fs.readdirSync(publicDir)) {
    const src = path.join(publicDir, entry);
    const dest = path.join(outDir, entry);
    fs.cpSync(src, dest, { recursive: true });
  }
}

if (fs.existsSync(styles)) {
  fs.copyFileSync(styles, path.join(outDir, "index.css"));
}
