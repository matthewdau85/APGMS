import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const IGNORED_DIR_NAMES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".next",
  "coverage",
  ".venv",
  "contracts",
  "providers",
  "tools",
]);
const VALID_EXT = new Set([".ts", ".tsx", ".js", ".jsx"]);
const FORBIDDEN = /@providers\/[\w\-@/]+\/real/;

async function walk(dir: string, out: string[]) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.relative(ROOT, fullPath);

    if (entry.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(entry.name)) continue;
      if (relative.includes(`${path.sep}providers${path.sep}`)) continue;
      if (relative.includes(`${path.sep}contracts${path.sep}`)) continue;
      if (relative.includes(`${path.sep}tools${path.sep}`)) continue;
      await walk(fullPath, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!VALID_EXT.has(ext)) continue;
      if (relative.startsWith(`core${path.sep}ports`)) continue;
      out.push(fullPath);
    }
  }
}

async function main() {
  const files: string[] = [];
  await walk(ROOT, files);

  const violations: { file: string; line: number; snippet: string }[] = [];

  await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, idx) => {
        if (FORBIDDEN.test(line)) {
          violations.push({ file, line: idx + 1, snippet: line.trim() });
        }
      });
    })
  );

  if (violations.length) {
    console.error("Forbidden imports detected (business code must not import @providers/*/real):");
    for (const v of violations) {
      console.error(` - ${path.relative(ROOT, v.file)}:${v.line} :: ${v.snippet}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Import safety check passed");
  }
}

void main();
