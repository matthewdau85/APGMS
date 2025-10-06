import { promises as fs } from "fs";
import path from "path";
import { parseFrontmatter } from "./frontmatter";

const SPEC_PATH = path.resolve(process.cwd(), "schema/openapi/merged.json");
const HELP_ROOT = path.resolve(process.cwd(), "docs/help");

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
]);

async function readJson(file: string) {
  const raw = await fs.readFile(file, "utf8");
  return JSON.parse(raw);
}

async function collectHelpTags(dir: string): Promise<Set<string>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const tags = new Set<string>();
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectHelpTags(full);
      nested.forEach((tag) => tags.add(tag));
    } else if (entry.isFile() && entry.name.endsWith(".mdx")) {
      const raw = await fs.readFile(full, "utf8");
      const parsed = parseFrontmatter(raw);
      const frontmatterTags = Array.isArray(parsed.data.tags)
        ? (parsed.data.tags as any[]).map(String)
        : [];
      for (const tag of frontmatterTags) {
        if (tag.toLowerCase().startsWith("api:")) {
          tags.add(tag.replace(/^api:/i, "api:").trim());
        }
      }
    }
  }
  return tags;
}

interface OpenApiSpec {
  paths?: Record<string, Record<string, unknown>>;
}

async function main() {
  try {
    await fs.access(SPEC_PATH);
  } catch (err) {
    console.error(`[docs:coverage] Missing OpenAPI spec at ${SPEC_PATH}`);
    process.exitCode = 1;
    return;
  }

  const spec = (await readJson(SPEC_PATH)) as OpenApiSpec;
  if (!spec.paths) {
    console.error(`[docs:coverage] Spec at ${SPEC_PATH} has no paths section.`);
    process.exitCode = 1;
    return;
  }

  const endpoints: string[] = [];
  for (const [route, operations] of Object.entries(spec.paths)) {
    for (const method of Object.keys(operations)) {
      if (HTTP_METHODS.has(method as any)) {
        endpoints.push(`api:${method.toUpperCase()} ${route}`);
      }
    }
  }

  const tags = await collectHelpTags(HELP_ROOT);
  const missing = endpoints.filter((endpoint) => !tags.has(endpoint));

  if (missing.length > 0) {
    console.error(`[docs:coverage] Missing documentation for ${missing.length} endpoint(s):`);
    missing.forEach((endpoint) => console.error(`  - ${endpoint}`));
    process.exitCode = 1;
    return;
  }

  console.log(`[docs:coverage] All ${endpoints.length} endpoints covered by help content.`);
}

main().catch((err) => {
  console.error(`[docs:coverage] Failed:`, err);
  process.exitCode = 1;
});
