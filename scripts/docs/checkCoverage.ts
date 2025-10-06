import fs from "node:fs";
import path from "node:path";

type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "options" | "head" | "trace";

type OpenAPISpec = {
  paths: Record<string, Partial<Record<HttpMethod, unknown>>>;
};

function loadOpenApi(filePath: string): OpenAPISpec {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Cannot find OpenAPI file at ${absolute}`);
  }
  const data = fs.readFileSync(absolute, "utf8");
  return JSON.parse(data) as OpenAPISpec;
}

function listMdxFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const resolved = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listMdxFiles(resolved));
    } else if (entry.isFile() && resolved.endsWith(".mdx")) {
      files.push(resolved);
    }
  }
  return files;
}

function normalise(content: string): string {
  return content.replace(/\s+/g, " ").toLowerCase();
}

function main() {
  const spec = loadOpenApi("openapi.json");
  const docsDir = path.resolve("docs");
  if (!fs.existsSync(docsDir)) {
    throw new Error(`Docs directory not found at ${docsDir}`);
  }

  const mdxFiles = listMdxFiles(docsDir);
  if (mdxFiles.length === 0) {
    throw new Error("No MDX documentation files were found under docs/.");
  }

  const mdxContent = mdxFiles.map((file) => ({
    file,
    content: normalise(fs.readFileSync(file, "utf8")),
  }));

  const missing: string[] = [];
  for (const [route, operations] of Object.entries(spec.paths || {})) {
    for (const [method, operation] of Object.entries(operations)) {
      const typedMethod = method.toLowerCase() as HttpMethod;
      if (!operation || !["get", "post", "put", "patch", "delete"].includes(typedMethod)) {
        continue;
      }
      const token = `${typedMethod.toUpperCase()} ${route}`.toLowerCase();
      const pathToken = route.toLowerCase();
      const documented = mdxContent.some(({ content }) =>
        content.includes(token) || content.includes(pathToken)
      );
      if (!documented) {
        missing.push(`${typedMethod.toUpperCase()} ${route}`);
      }
    }
  }

  if (missing.length > 0) {
    console.error("Documentation coverage check failed. Missing endpoints:\n" + missing.join("\n"));
    process.exit(1);
  }

  console.log("Documentation coverage check passed for", mdxFiles.length, "MDX file(s).");
}

main();
