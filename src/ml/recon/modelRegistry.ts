import { promises as fs } from "fs";
import path from "path";
import { ReconModelDefinition } from "./types";

const REGISTRY_ROOT = path.join(process.cwd(), "models", "recon-anomaly");
let cachedModel: ReconModelDefinition | null = null;

async function listCandidateVersions(): Promise<string[]> {
  try {
    const entries = await fs.readdir(REGISTRY_ROOT, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && isSemver(entry.name))
      .map((entry) => entry.name);
  } catch (err: any) {
    throw new Error(`Recon model registry missing at ${REGISTRY_ROOT}: ${err?.message || err}`);
  }
}

function pickLatestVersion(versions: string[]): string {
  if (versions.length === 0) {
    throw new Error("No recon anomaly models available");
  }
  return versions.reduce((latest, current) => (compareSemver(current, latest) > 0 ? current : latest));
}

function isSemver(input: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(input);
}

function compareSemver(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = a.split(".").map((part) => Number(part));
  const [bMajor, bMinor, bPatch] = b.split(".").map((part) => Number(part));
  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

async function loadModelFile(version: string): Promise<ReconModelDefinition> {
  const modelPath = path.join(REGISTRY_ROOT, version, "model.json");
  const raw = await fs.readFile(modelPath, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return parsed as ReconModelDefinition;
  } catch (err: any) {
    throw new Error(`Failed to parse recon model ${modelPath}: ${err?.message || err}`);
  }
}

export async function loadReconModel(): Promise<ReconModelDefinition> {
  if (cachedModel) {
    return cachedModel;
  }
  const versions = await listCandidateVersions();
  const latest = pickLatestVersion(versions);
  const model = await loadModelFile(latest);
  cachedModel = model;
  return model;
}

export function resetReconModelCache() {
  cachedModel = null;
}
