import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const projectRoot = process.cwd();
const repoRoot = path.resolve(projectRoot, "../../..");
const glossaryPath = path.resolve(repoRoot, "content", "glossary.json");

if (!fs.existsSync(glossaryPath)) {
  console.error(`Glossary file not found at ${glossaryPath}`);
  process.exit(1);
}

const glossary = JSON.parse(fs.readFileSync(glossaryPath, "utf8"));
const terms = Object.keys(glossary);

const sourceDir = path.resolve(projectRoot, "src");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      files.push(...walk(path.join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith(".tsx")) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

const files = fs.existsSync(sourceDir) ? walk(sourceDir) : [];

const errors = [];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const file of files) {
  const raw = fs.readFileSync(file, "utf8");
  const withoutBlockComments = raw.replace(/\/\*[\s\S]*?\*\//g, " ");
  const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, " ");

  for (const term of terms) {
    const escaped = escapeRegExp(term);
    const termRegex = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, "g");

    let match;
    while ((match = termRegex.exec(withoutLineComments)) !== null) {
      const index = match.index;
      const precedingChar = withoutLineComments[index - 1];
      const followingChar = withoutLineComments[index + term.length];

      if (precedingChar && "'\"`".includes(precedingChar)) continue;
      if (followingChar && "'\"`".includes(followingChar)) continue;

      const originalIndex = match.index;
      const before = withoutLineComments.lastIndexOf("<Gloss", originalIndex);
      const after = withoutLineComments.indexOf("</Gloss>", originalIndex);
      let wrapped = false;

      if (before !== -1 && after !== -1 && before < originalIndex && after > originalIndex) {
        const openTagEnd = withoutLineComments.indexOf(">", before);
        if (openTagEnd !== -1 && openTagEnd < originalIndex) {
          const openTag = withoutLineComments.slice(before, openTagEnd + 1);
          const attrRegex = new RegExp(`term=[\"']${escaped}[\"']`);
          if (attrRegex.test(openTag)) {
            wrapped = true;
          }
        }
      }

      if (!wrapped) {
        const line = withoutLineComments.slice(0, index).split(/\r?\n/).length;
        errors.push({
          file,
          line,
          term,
        });
      }
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    const relative = path.relative(projectRoot, error.file);
    console.error(`${relative}:${error.line} — term "${error.term}" must be wrapped with <Gloss term="${error.term}">`);
  }
  process.exit(1);
}

console.log(`Glossary lint passed on ${files.length} file(s).`);
