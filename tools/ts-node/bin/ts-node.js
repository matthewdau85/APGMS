#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ts = require("typescript");

const args = process.argv.slice(2);
let file;
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2019,
  esModuleInterop: true,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  resolveJsonModule: true,
};

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];
  if (arg === "--transpile-only") {
    continue;
  }
  if (!file) {
    file = arg;
  }
}

if (!file) {
  console.error("Usage: ts-node [--transpile-only] <file.ts>");
  process.exit(1);
}

const filePath = path.resolve(process.cwd(), file);
let source;
try {
  source = fs.readFileSync(filePath, "utf8");
} catch (err) {
  console.error(`[ts-node] Unable to read ${filePath}: ${err.message}`);
  process.exit(1);
}

const transpiled = ts.transpileModule(source, {
  compilerOptions,
  fileName: filePath,
  reportDiagnostics: false,
});

const compiledModule = new Module(filePath, module.parent);
compiledModule.filename = filePath;
compiledModule.paths = Module._nodeModulePaths(path.dirname(filePath));
compiledModule._compile(transpiled.outputText, filePath);
