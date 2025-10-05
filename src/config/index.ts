import fs from "fs";
import path from "path";

export type ProviderKey = "bank" | "kms" | "rates" | "idp" | "statements";

export interface ProvidersConfig {
  bank: string;
  kms: string;
  rates: string;
  idp: string;
  statements: string;
}

export interface AppConfig {
  profile: string;
  providers: ProvidersConfig;
  globals: {
    PROTO_KILL_SWITCH: boolean;
    SHADOW_MODE: boolean;
    TZ: string;
    mocks: Record<string, string | boolean>;
  };
  raw: Record<string, unknown>;
}

type Primitive = string | number | boolean | null;
type YamlValue = Primitive | YamlObject;
interface YamlObject {
  [key: string]: YamlValue;
}

const CONFIG_DIR = path.resolve(__dirname, "..", "..", "config");
const DEFAULT_PROFILE = "dev";

function parseBoolean(value: string): boolean | string {
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return value;
}

function parsePrimitive(value: string): Primitive | string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "";
  }
  if (trimmed === "null" || trimmed === "~") {
    return null;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const booleanish = parseBoolean(trimmed);
  if (booleanish === true || booleanish === false) {
    return booleanish;
  }
  return trimmed;
}

function parseSimpleYaml(contents: string): YamlObject {
  const root: YamlObject = {};
  const stack: Array<{ indent: number; value: YamlObject }> = [{ indent: -1, value: root }];

  const lines = contents
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, ""))
    .map((line) => line.replace(/\s+$/, ""))
    .filter((line) => line.length > 0);

  for (const originalLine of lines) {
    const indentMatch = originalLine.match(/^\s*/);
    const indent = indentMatch ? indentMatch[0].length : 0;
    const line = originalLine.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }

    const current = stack[stack.length - 1].value;

    if (line.endsWith(":")) {
      const key = line.slice(0, -1).trim();
      const child: YamlObject = {};
      current[key] = child;
      stack.push({ indent, value: child });
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(`Unsupported YAML line: "${originalLine}"`);
    }

    const key = line.slice(0, separatorIndex).trim();
    const valuePortion = line.slice(separatorIndex + 1);
    current[key] = parsePrimitive(valuePortion);
  }

  return root;
}

function readYamlFile(filePath: string): YamlObject {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const contents = fs.readFileSync(filePath, "utf8");
  if (contents.trim().length === 0) {
    return {};
  }
  return parseSimpleYaml(contents);
}

function deepMerge(base: YamlObject, override: YamlObject): YamlObject {
  const output: YamlObject = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      key in output &&
      output[key] &&
      typeof output[key] === "object" &&
      !Array.isArray(output[key])
    ) {
      output[key] = deepMerge(output[key] as YamlObject, value as YamlObject);
    } else {
      output[key] = value;
    }
  }

  return output;
}

function asString(input: unknown, context: string): string {
  if (typeof input !== "string") {
    throw new Error(`${context} must be a string, received ${typeof input}`);
  }
  if (input.length === 0) {
    throw new Error(`${context} must not be empty`);
  }
  return input;
}

function asBoolean(input: unknown, context: string): boolean {
  if (typeof input === "boolean") {
    return input;
  }
  if (typeof input === "string") {
    const parsed = parseBoolean(input);
    if (parsed === true || parsed === false) {
      return parsed;
    }
  }
  throw new Error(`${context} must be a boolean-like value`);
}

function normalizeProfileName(profile?: string): string {
  if (!profile) {
    return DEFAULT_PROFILE;
  }
  return profile.toLowerCase();
}

function collectEnvOverrides(): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const explicitEnv: Array<[string, string]> = [
    ["providers.bank", process.env.PROVIDERS_BANK ?? process.env.BANK_PROVIDER ?? ""],
    ["providers.kms", process.env.PROVIDERS_KMS ?? ""],
    ["providers.rates", process.env.PROVIDERS_RATES ?? ""],
    ["providers.idp", process.env.PROVIDERS_IDP ?? ""],
    ["providers.statements", process.env.PROVIDERS_STATEMENTS ?? ""],
    ["PROTO_KILL_SWITCH", process.env.PROTO_KILL_SWITCH ?? ""],
    ["SHADOW_MODE", process.env.SHADOW_MODE ?? ""],
    ["TZ", process.env.TZ ?? ""],
  ];

  for (const [key, value] of explicitEnv) {
    if (value !== "") {
      overrides[key] = value;
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("MOCK_") && value !== undefined) {
      overrides[key] = value;
    }
  }

  return overrides;
}

function applyPath(target: YamlObject, dottedPath: string, value: unknown): void {
  const segments = dottedPath.split(".");
  let cursor: YamlObject = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!(segment in cursor) || typeof cursor[segment] !== "object" || cursor[segment] === null) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as YamlObject;
  }
  cursor[segments[segments.length - 1]] = value as YamlValue;
}

export function loadConfig(): AppConfig {
  const profile = normalizeProfileName(process.env.APP_PROFILE);
  const defaults = readYamlFile(path.join(CONFIG_DIR, "default.yaml"));
  const profilePath = path.join(CONFIG_DIR, `${profile}.yaml`);
  const profileConfig = readYamlFile(profilePath);

  const merged = deepMerge(defaults, profileConfig);
  const envOverrides = collectEnvOverrides();

  for (const [pathKey, value] of Object.entries(envOverrides)) {
    if (pathKey.includes(".")) {
      applyPath(merged, pathKey, value);
    } else {
      merged[pathKey] = value as YamlValue;
    }
  }

  const providers = merged.providers as YamlObject;
  if (!providers) {
    throw new Error("providers configuration is required");
  }

  const normalizedProviders: Partial<ProvidersConfig> = {};
  (Object.keys({ bank: "", kms: "", rates: "", idp: "", statements: "" }) as ProviderKey[]).forEach((key) => {
    normalizedProviders[key] = asString(providers[key], `providers.${key}`);
  });

  const protoKillSwitch = asBoolean(merged.PROTO_KILL_SWITCH, "PROTO_KILL_SWITCH");
  const shadowMode = asBoolean(merged.SHADOW_MODE, "SHADOW_MODE");
  const timezone = asString(merged.TZ, "TZ");

  const mocks: Record<string, string | boolean> = {};
  for (const [key, value] of Object.entries(merged)) {
    if (key.startsWith("MOCK_")) {
      if (typeof value === "boolean") {
        mocks[key] = value;
      } else if (typeof value === "string") {
        const parsed = parseBoolean(value);
        mocks[key] = parsed === value ? value : (parsed as boolean);
      }
    }
  }

  return {
    profile,
    providers: normalizedProviders as ProvidersConfig,
    globals: {
      PROTO_KILL_SWITCH: protoKillSwitch,
      SHADOW_MODE: shadowMode,
      TZ: timezone,
      mocks,
    },
    raw: merged,
  };
}

let cachedConfig: AppConfig | null = null;

export function getAppConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
    if (!process.env.TZ) {
      process.env.TZ = cachedConfig.globals.TZ;
    }
  }

  return cachedConfig;
}
