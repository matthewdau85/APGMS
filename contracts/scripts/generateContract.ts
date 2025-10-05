#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";

const [, , rawName] = process.argv;
if (!rawName) {
  console.error("Usage: tsx contracts/scripts/generateContract.ts <provider>");
  process.exit(1);
}

const provider = rawName.trim().toLowerCase();
if (!/^[-a-z0-9_]+$/.test(provider)) {
  console.error("Provider name must be kebab/alpha-numeric");
  process.exit(1);
}

const contractsDir = path.resolve(process.cwd(), "contracts");
const providersDir = path.join(contractsDir, "providers");
const specPath = path.join(contractsDir, `${provider}.spec.ts`);
const mockPath = path.join(providersDir, `${provider}-mock.ts`);
const realPath = path.join(providersDir, `${provider}-real.ts`);
const indexPath = path.join(providersDir, "index.ts");

function ensureFile(filePath: string, template: string) {
  if (fs.existsSync(filePath)) {
    console.log(`Skipping ${filePath} (already exists)`);
    return;
  }
  fs.writeFileSync(filePath, template, "utf8");
  console.log(`Created ${filePath}`);
}

const specTemplate = `import type { ContractSpec } from "./types";\nimport { makeReport } from "./types";\n\n// TODO: update the loaded provider type and fill in assertions\nconst spec: ContractSpec = async (ctx) => {\n  const provider = await ctx.load<any>();\n\n  return makeReport(ctx, {\n    responseTypes: {},\n    errors: {},\n    idempotency: {},\n    timeoutMs: provider.timeoutMs ?? 0,\n    retriableCodes: provider.retriableCodes ? [...provider.retriableCodes] : [],\n  });\n};\n\nexport default spec;\n`;

const providerTemplate = `import { makeError } from "./shared";\n\n// TODO: replace the return type with the correct port interface\nexport async function createProvider(): Promise<any> {\n  return {\n    timeoutMs: 1000,\n    retriableCodes: [],\n    async exampleOperation() {\n      return { ok: true };\n    },\n    async simulateError() {\n      return makeError("NOT_IMPLEMENTED", "Contract stub", false);\n    },\n  };\n}\n\nexport default createProvider;\n`;

ensureFile(specPath, specTemplate);
ensureFile(mockPath, providerTemplate);
ensureFile(realPath, providerTemplate);

if (fs.existsSync(indexPath)) {
  const original = fs.readFileSync(indexPath, "utf8");
  const match = original.match(/export const providers = \[(.*?)\] as const;/s);
  if (!match) {
    console.warn("Could not update providers/index.ts automatically; please add provider manually.");
  } else {
    const items = match[1]
      .split(",")
      .map((s) => s.replace(/['"\s]/g, ""))
      .filter(Boolean);
    if (!items.includes(provider)) {
      items.push(provider);
      items.sort();
      const formatted = items.map((item) => `  "${item}"`).join(",\n");
      const updated = original.replace(
        /export const providers = \[(.*?)\] as const;/s,
        `export const providers = [\n${formatted},\n] as const;`
      );
      fs.writeFileSync(indexPath, updated, "utf8");
      console.log(`Updated providers/index.ts with ${provider}`);
    } else {
      console.log(`providers/index.ts already lists ${provider}`);
    }
  }
}
