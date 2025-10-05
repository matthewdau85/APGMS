import { readdir } from "node:fs/promises";
import path from "node:path";
import url from "node:url";

async function main() {
  const dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const entries = await readdir(dirname);
  const specs = entries.filter((file) => file.endsWith(".spec.ts"));

  if (!specs.length) {
    console.warn("[contracts] No spec files found");
    return;
  }

  let failed = false;

  for (const spec of specs) {
    const specPath = path.join(dirname, spec);
    const specUrl = url.pathToFileURL(specPath).href;
    try {
      const mod = await import(specUrl);
      const runner = mod.runContractTests || mod.default;
      if (typeof runner !== "function") {
        throw new Error(`Spec ${spec} does not export runContractTests()`);
      }
      await runner();
      console.log(`✅ ${spec}`);
    } catch (err) {
      failed = true;
      console.error(`❌ ${spec}`);
      console.error(err instanceof Error ? err.stack ?? err.message : err);
    }
  }

  if (failed) {
    process.exitCode = 1;
  }
}

void main();
