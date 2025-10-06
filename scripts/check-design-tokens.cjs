#!/usr/bin/env node
const { execSync } = require("child_process");

const status = execSync("git status --porcelain src/ui/tokens.ts", {
  encoding: "utf8",
}).trim();

const references = [
  process.env.DESIGN_TOKENS_BASE,
  "origin/main",
  "main",
  "HEAD^",
];

const diffs = [];

if (status) {
  const isUntracked = status.includes("??");
  const command = isUntracked
    ? "git diff --no-index -- /dev/null src/ui/tokens.ts"
    : "git diff -- src/ui/tokens.ts";
  try {
    diffs.push(execSync(command, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  } catch (error) {
    if (error.stdout) {
      diffs.push(error.stdout.toString());
    } else {
      throw error;
    }
  }
}

for (const ref of references) {
  if (!ref) continue;
  try {
    const mergeBase = execSync(`git merge-base ${ref} HEAD`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const output = execSync(`git diff ${mergeBase}...HEAD -- src/ui/tokens.ts`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (output.trim()) {
      diffs.push(output);
      break;
    }
  } catch (error) {
    // Ignore missing refs and keep trying fallbacks.
  }
}

const diff = diffs.join("\n");

if (!diff.trim()) {
  process.exit(0);
}

console.log("Design token changes detected. Attach design sign-off before merging.\n");
console.log(diff);
if (process.env.DESIGN_SIGN_OFF === "approved") {
  console.log("Design sign-off override detected. Proceeding despite token diff.\n");
  process.exit(0);
}

console.log("\n⬆️ Include approval from the design system team in this PR before merging.");
process.exit(1);
