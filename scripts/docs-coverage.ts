import { promises as fs } from "fs";
import path from "path";

type Endpoint = { method: string; path: string };

const DOCS_DIR = path.resolve("docs/help");
const REGISTRY_FILE = path.resolve("docs/public-endpoints.json");

async function main() {
  const [docs, registry] = await Promise.all([collectDocs(), readRegistry()]);
  const missing: Endpoint[] = [];

  for (const endpoint of registry) {
    const covered = docs.some((doc) => doc.includes(endpoint.path));
    if (!covered) {
      missing.push(endpoint);
      continue;
    }
    if (!docs.some((doc) => lineMentionsEndpoint(doc, endpoint))) {
      missing.push(endpoint);
    }
  }

  if (missing.length) {
    console.error("Missing documentation for endpoints:");
    for (const endpoint of missing) {
      console.error(` - ${endpoint.method.toUpperCase()} ${endpoint.path}`);
    }
    process.exit(1);
  }

  console.log(`All ${registry.length} public endpoints referenced in docs.`);
}

function lineMentionsEndpoint(doc: string, endpoint: Endpoint): boolean {
  const pattern = new RegExp(`${escapeForRegExp(endpoint.path)}[^\n]*${endpoint.method}`, "i");
  const reversePattern = new RegExp(`${endpoint.method}[^\n]*${escapeForRegExp(endpoint.path)}`, "i");
  return pattern.test(doc) || reversePattern.test(doc);
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function collectDocs(): Promise<string[]> {
  const files = (await fs.readdir(DOCS_DIR)).filter((file) => file.endsWith(".mdx"));
  return Promise.all(files.map((file) => fs.readFile(path.join(DOCS_DIR, file), "utf8")));
}

async function readRegistry(): Promise<Endpoint[]> {
  const raw = await fs.readFile(REGISTRY_FILE, "utf8");
  const data = JSON.parse(raw) as Endpoint[];
  return data.map((endpoint) => ({
    method: endpoint.method.toUpperCase(),
    path: endpoint.path,
  }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
