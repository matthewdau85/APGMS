import fs from "node:fs";
import path from "node:path";

type DodDefinition = {
  label: string;
  title: string;
  items: string[];
};

const cwd = process.cwd();
const dodDir = path.resolve(cwd, "docs", "dod");

function parseYamlLite(raw: string): DodDefinition {
  const lines = raw.split(/\r?\n/);
  const def: DodDefinition = { label: "", title: "", items: [] };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("label:")) {
      def.label = trimmed.replace(/^label:\s*/, "").trim();
    } else if (trimmed.startsWith("title:")) {
      def.title = trimmed.replace(/^title:\s*/, "").trim();
    } else if (trimmed.startsWith("- ")) {
      def.items.push(trimmed.slice(2).trim());
    }
  }
  if (!def.label || def.items.length === 0) {
    throw new Error("Invalid DoD definition");
  }
  return def;
}

function readDefinitions(): DodDefinition[] {
  const files = fs.readdirSync(dodDir).filter((file) => file.endsWith(".yml"));
  return files.map((file) => {
    const raw = fs.readFileSync(path.join(dodDir, file), "utf8");
    try {
      return parseYamlLite(raw);
    } catch (error) {
      throw new Error(`Invalid DoD file: ${file} (${(error as Error).message})`);
    }
  });
}

function getLabels(): string[] {
  const envLabels = process.env.PR_LABELS;
  if (envLabels) {
    return envLabels
      .split(/[,\n]/)
      .map((label) => label.trim())
      .filter(Boolean);
  }
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    try {
      const raw = fs.readFileSync(eventPath, "utf8");
      const parsed = JSON.parse(raw);
      const labels: string[] = parsed?.pull_request?.labels?.map((label: any) => label?.name).filter(Boolean) ?? [];
      return labels;
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeLabel(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
}

function parseConfirmedItems(): Record<string, Set<string>> {
  const confirmed: Record<string, Set<string>> = {};
  const raw = process.env.DOD_CONFIRMED_ITEMS;
  if (!raw) return confirmed;
  try {
    const parsed = JSON.parse(raw);
    for (const [label, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        confirmed[label] = new Set(value.map((item) => String(item)));
      }
    }
  } catch (error) {
    console.warn("Unable to parse DOD_CONFIRMED_ITEMS", error);
  }
  return confirmed;
}

function confirmedLabelsSet(): Set<string> {
  const raw = process.env.DOD_CONFIRMED_LABELS;
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\n]/)
      .map((label) => label.trim())
      .filter(Boolean)
  );
}

function allItemsConfirmed(label: string): boolean {
  const envKey = `DOD_${normalizeLabel(label)}_COMPLETE`;
  const value = process.env[envKey];
  if (!value) return false;
  return ["true", "1", "yes", "on"].includes(value.toLowerCase());
}

function main() {
  const labels = getLabels();
  if (labels.length === 0) {
    console.log("No DoD labels present – skipping");
    return;
  }
  const definitions = readDefinitions();
  const definitionMap = new Map(definitions.map((def) => [def.label, def]));
  const confirmedItems = parseConfirmedItems();
  const confirmedLabels = confirmedLabelsSet();
  const failures: string[] = [];

  for (const label of labels) {
    const definition = definitionMap.get(label);
    if (!definition) {
      console.log(`No DoD definition for label ${label} – skipping`);
      continue;
    }
    if (confirmedLabels.has(label) || allItemsConfirmed(label)) {
      console.log(`DoD for ${label} confirmed via environment override`);
      continue;
    }
    const confirmedForLabel = confirmedItems[label] ?? new Set<string>();
    const missing = definition.items.filter((item) => !confirmedForLabel.has(item));
    if (missing.length > 0) {
      failures.push(`${label} (${definition.title || "Definition"}): ${missing.join(", ")}`);
    } else {
      console.log(`DoD for ${label} satisfied`);
    }
  }

  if (failures.length > 0) {
    console.error("DoD check failed:\n" + failures.map((f) => ` - ${f}`).join("\n"));
    process.exitCode = 1;
  }
}

main();

