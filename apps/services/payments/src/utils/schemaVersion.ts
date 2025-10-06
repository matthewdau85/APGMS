const SUPPORTED_SCHEMA_VERSIONS = new Set(["v1", "v2"]);

export type SchemaVersion = "v1" | "v2";

export function normalizeSchemaVersion(version?: string | null): SchemaVersion {
  const candidate = (version ?? "v1").toString().trim().toLowerCase();
  if (!SUPPORTED_SCHEMA_VERSIONS.has(candidate)) {
    throw new Error(`Unsupported schema_version: ${version ?? "<missing>"}`);
  }
  return candidate as SchemaVersion;
}

export function acceptsSchemaVersion(version?: string | null): boolean {
  try {
    normalizeSchemaVersion(version);
    return true;
  } catch {
    return false;
  }
}

export { SUPPORTED_SCHEMA_VERSIONS };
