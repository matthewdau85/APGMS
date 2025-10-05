#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { providers, type ProviderName } from "./providers/index";
import type { ContractRunReport, ContractSpec, ContractSpecContext, ProviderFlavor } from "./types";
import { canonicalize } from "./utils";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const allowlistPath = path.join(__dirname, "allowlist.json");

interface Allowlist {
  [provider: string]: string[];
}

function loadAllowlist(): Allowlist {
  if (!fs.existsSync(allowlistPath)) {
    return {};
  }
  const raw = fs.readFileSync(allowlistPath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (err) {
    console.warn("[contracts] Failed to parse allowlist.json:", err);
    return {};
  }
}

async function loadSpec(provider: string): Promise<ContractSpec> {
  const specPathTs = path.join(__dirname, `${provider}.spec.ts`);
  const specPathJs = path.join(__dirname, `${provider}.spec.js`);
  const targetPath = fs.existsSync(specPathTs) ? specPathTs : specPathJs;
  if (!fs.existsSync(targetPath)) {
    throw new Error(`No spec found for provider ${provider} (expected ${specPathTs} or ${specPathJs})`);
  }
  const moduleUrl = pathToFileURL(targetPath).href;
  const mod = await import(moduleUrl);
  const spec: ContractSpec | undefined = mod.default ?? mod.run ?? mod.spec;
  if (!spec) {
    throw new Error(`Spec module ${targetPath} does not export a default ContractSpec`);
  }
  return spec;
}

async function loadProvider<T>(provider: string, flavor: ProviderFlavor): Promise<T> {
  const providerPathTs = path.join(__dirname, "providers", `${provider}-${flavor}.ts`);
  const providerPathJs = path.join(__dirname, "providers", `${provider}-${flavor}.js`);
  const targetPath = fs.existsSync(providerPathTs) ? providerPathTs : providerPathJs;
  if (!fs.existsSync(targetPath)) {
    throw new Error(`Missing provider implementation ${provider}-${flavor}`);
  }
  const moduleUrl = pathToFileURL(targetPath).href;
  const mod = await import(moduleUrl);
  const factory: (() => Promise<T> | T) | undefined =
    mod.createProvider ?? mod.default ?? mod.provider ?? mod.load;
  if (!factory) {
    throw new Error(`Provider module ${targetPath} does not export createProvider/default`);
  }
  const value = await factory();
  return value as T;
}

function shouldRunReal(provider: string): boolean {
  const gate = process.env.CONTRACT_TESTS_REAL;
  const providerGate = process.env[`CONTRACT_TESTS_REAL_${provider.toUpperCase()}`];
  const values = [gate, providerGate].filter((v) => v !== undefined).map((v) => String(v).toLowerCase());
  if (values.some((v) => v === "0" || v === "false" || v === "no")) {
    return false;
  }
  if (values.some((v) => v === "1" || v === "true" || v === "yes")) {
    return true;
  }
  return true;
}

function createContext(provider: ProviderName, flavor: ProviderFlavor): ContractSpecContext {
  const notes: string[] = [];
  const context: ContractSpecContext & { __notes?: string[] } = {
    provider,
    flavor,
    isReal: flavor === "real",
    note(message: string) {
      notes.push(message);
    },
    async load<T>() {
      return await loadProvider<T>(provider, flavor);
    },
  };
  Object.defineProperty(context, "__notes", { value: notes, enumerable: false });
  return context;
}

interface DiffRecord {
  path: string;
  mock: unknown;
  real: unknown;
}

function compareReports(mock: ContractRunReport, real: ContractRunReport): DiffRecord[] {
  const diffs: DiffRecord[] = [];
  walk(mock.responseTypes, real.responseTypes, "responseTypes", diffs);
  walk(mock.errors, real.errors, "errors", diffs);
  walk(mock.idempotency, real.idempotency, "idempotency", diffs);
  walk(mock.timeoutMs, real.timeoutMs, "timeoutMs", diffs);
  walk(mock.retriableCodes, real.retriableCodes, "retriableCodes", diffs);
  return diffs;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walk(mock: unknown, real: unknown, prefix: string, diffs: DiffRecord[]) {
  if (Array.isArray(mock) && Array.isArray(real)) {
    const canonMock = canonicalize(mock);
    const canonReal = canonicalize(real);
    if (JSON.stringify(canonMock) !== JSON.stringify(canonReal)) {
      diffs.push({ path: prefix, mock: canonMock, real: canonReal });
    }
    return;
  }
  if (isPlainObject(mock) && isPlainObject(real)) {
    const keys = new Set([...Object.keys(mock), ...Object.keys(real)]);
    for (const key of keys) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (!(key in mock)) {
        diffs.push({ path: nextPrefix, mock: undefined, real: (real as any)[key] });
        continue;
      }
      if (!(key in real)) {
        diffs.push({ path: nextPrefix, mock: (mock as any)[key], real: undefined });
        continue;
      }
      walk((mock as any)[key], (real as any)[key], nextPrefix, diffs);
    }
    return;
  }
  if (JSON.stringify(mock) !== JSON.stringify(real)) {
    diffs.push({ path: prefix, mock, real });
  }
}

async function main() {
  const allowlist = loadAllowlist();
  const results: ContractRunReport[] = [];
  let hasFailure = false;

  for (const provider of providers) {
    const spec = await loadSpec(provider);
    for (const flavor of ["mock", "real"] as const) {
      if (flavor === "real" && !shouldRunReal(provider)) {
        results.push({
          provider,
          flavor,
          responseTypes: {},
          errors: {},
          idempotency: {},
          timeoutMs: 0,
          retriableCodes: [],
          skipped: true,
        });
        console.log(`[contracts] Skipping ${provider} real provider (feature gate disabled)`);
        continue;
      }
      const ctx = createContext(provider, flavor);
      try {
        const report = await spec(ctx);
        results.push(report);
        console.log(`[contracts] ${provider}-${flavor} complete`);
      } catch (err) {
        hasFailure = true;
        console.error(`[contracts] ${provider}-${flavor} run failed:`, err);
      }
    }
  }

  for (const provider of providers) {
    const mock = results.find((r) => r.provider === provider && r.flavor === "mock");
    const real = results.find((r) => r.provider === provider && r.flavor === "real");
    if (!mock) {
      console.error(`[contracts] Missing mock report for ${provider}`);
      hasFailure = true;
      continue;
    }
    if (!real) {
      console.error(`[contracts] Missing real report for ${provider}`);
      hasFailure = true;
      continue;
    }
    if (real.skipped) {
      console.log(`[contracts] Real provider for ${provider} skipped; comparison not performed.`);
      continue;
    }
    const diffs = compareReports(mock, real);
    if (diffs.length === 0) {
      console.log(`[contracts] ${provider}: mock and real providers aligned.`);
      continue;
    }
    const allowed = allowlist[provider] ?? [];
    const unexpected = diffs.filter((d) => !allowed.includes(d.path));
    if (unexpected.length === 0) {
      console.log(`[contracts] ${provider}: only allow-listed divergences detected.`);
      continue;
    }
    hasFailure = true;
    console.error(`[contracts] ${provider}: divergences detected:`);
    for (const diff of unexpected) {
      console.error(`  ${diff.path}: mock=${JSON.stringify(diff.mock)} real=${JSON.stringify(diff.real)}`);
    }
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[contracts] Unhandled error", err);
  process.exit(1);
});
