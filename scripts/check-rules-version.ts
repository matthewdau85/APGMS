import { execSync } from "node:child_process";

const rulesDir = "apps/services/tax-engine/app/rules/";
const versionFile = "apps/services/tax-engine/app/RATES_VERSION";
const changelogFile = "apps/services/tax-engine/CHANGELOG.md";

const baseRef = process.env.GITHUB_BASE_REF
  ? `origin/${process.env.GITHUB_BASE_REF}`
  : process.env.CI ? "HEAD^" : "HEAD^";

function gitDiffNames(base: string) {
  try {
    const output = execSync(`git diff --name-only ${base}...HEAD`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch (err) {
    const fallback = execSync("git diff --name-only", { encoding: "utf8" });
    return fallback
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
}

const changedFiles = new Set(gitDiffNames(baseRef));
const rulesChanged = Array.from(changedFiles).some((file) => file.startsWith(rulesDir));

if (!rulesChanged) {
  process.exit(0);
}

const versionTouched = changedFiles.has(versionFile);
const changelogTouched = changedFiles.has(changelogFile);

if (!versionTouched || !changelogTouched) {
  console.error(
    "Rules were modified but RATES_VERSION and CHANGELOG.md were not updated."
  );
  console.error(`Expect changes to ${versionFile} and ${changelogFile}.`);
  process.exit(1);
}
