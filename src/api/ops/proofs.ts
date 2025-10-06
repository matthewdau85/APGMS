import { Router } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import nacl from "tweetnacl";
import { buildZip } from "../../../libs/zip";
import { requireAdminMfa } from "../../middleware/adminMfa";

interface PackFileEntry {
  name: string;
  size: number;
  sha256: string;
}

interface PackInfo {
  date: string;
  generated_at?: string;
  files: PackFileEntry[];
  bundle_sha256: string;
}

interface RulesManifest {
  version?: string;
  owner?: string;
  review_cadence_days?: number;
  generated_at?: string;
  pack?: PackInfo;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const defaultRoot = path.join(process.cwd(), "ops", "artifacts", "evte");
const PACK_ROOT = path.resolve(process.env.EVTE_PACK_ROOT ?? defaultRoot);

function buildError(status: number, message: string) {
  const err = new Error(message) as Error & { status?: number };
  err.status = status;
  return err;
}

async function readManifest(packDir: string): Promise<RulesManifest> {
  const manifestPath = path.join(packDir, "manifest.json");
  try {
    const raw = await fs.readFile(manifestPath, "utf-8");
    return JSON.parse(raw) as RulesManifest;
  } catch (err) {
    throw buildError(500, "MANIFEST_NOT_FOUND");
  }
}

async function ensurePack(date: string): Promise<{ date: string; dir: string; manifest: RulesManifest; pack: PackInfo }>
{
  if (!DATE_REGEX.test(date)) {
    throw buildError(400, "INVALID_DATE");
  }
  const dir = path.join(PACK_ROOT, date);
  try {
    const stats = await fs.stat(dir);
    if (!stats.isDirectory()) {
      throw buildError(404, "PACK_NOT_FOUND");
    }
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw buildError(404, "PACK_NOT_FOUND");
    }
    if (err?.status) throw err;
    throw buildError(500, "PACK_NOT_FOUND");
  }

  const manifest = await readManifest(dir);
  if (!manifest.pack) {
    throw buildError(500, "PACK_METADATA_MISSING");
  }
  if (!manifest.pack.bundle_sha256) {
    throw buildError(500, "PACK_CHECKSUM_MISSING");
  }
  return { date, dir, manifest, pack: manifest.pack };
}

async function findLatestPack(): Promise<{ date: string; dir: string; manifest: RulesManifest; pack: PackInfo }>
{
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(PACK_ROOT, { withFileTypes: true });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      throw buildError(404, "PACK_NOT_FOUND");
    }
    throw buildError(500, "PACK_ROOT_UNREADABLE");
  }

  const candidates = entries
    .filter(entry => entry.isDirectory() && DATE_REGEX.test(entry.name))
    .map(entry => entry.name)
    .sort();

  const latest = candidates.pop();
  if (!latest) {
    throw buildError(404, "PACK_NOT_FOUND");
  }
  return ensurePack(latest);
}

function signChecksum(bundleSha: string) {
  const keyBase64 = process.env.PROOFS_SIGNING_KEY_BASE64 ?? process.env.RPT_ED25519_SECRET_BASE64;
  if (!keyBase64) {
    throw buildError(500, "SIGNING_KEY_MISSING");
  }
  const secret = Buffer.from(keyBase64, "base64");
  if (secret.length !== 64) {
    throw buildError(500, "SIGNING_KEY_INVALID");
  }
  const message = Buffer.from(bundleSha, "hex");
  const signature = nacl.sign.detached(message, new Uint8Array(secret));
  return {
    algorithm: "ed25519",
    signature: Buffer.from(signature).toString("base64"),
    keyId: process.env.PROOFS_SIGNING_KEY_ID ?? "rpt-signing-key"
  };
}

async function buildZipBuffer(dir: string): Promise<Buffer> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = entries.filter(entry => entry.isFile());
  const payload = await Promise.all(
    files.map(async entry => ({
      name: entry.name,
      data: await fs.readFile(path.join(dir, entry.name))
    }))
  );
  return buildZip(payload);
}

function formatFiles(files: PackFileEntry[]): PackFileEntry[] {
  return (files ?? []).map(file => ({
    name: file.name,
    size: file.size,
    sha256: file.sha256
  }));
}

function computeChecksum(files: PackFileEntry[]): string {
  const hash = createHash("sha256");
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  for (const file of sorted) {
    hash.update(file.name, "utf8");
    hash.update(file.sha256, "hex");
  }
  return hash.digest("hex");
}

export const proofsRouter = Router();

proofsRouter.use(requireAdminMfa);

proofsRouter.get("/", async (req, res) => {
  try {
    const { date, manifest, pack } = await findLatestPack();
    const files = formatFiles(pack.files ?? []);
    const checksum = pack.bundle_sha256;
    const downloadUrl = `/api/ops/compliance/proofs/${date}/download`;
    res.json({
      date,
      generatedAt: pack.generated_at ?? manifest.generated_at ?? null,
      files,
      checksum: { algorithm: "sha256", value: checksum },
      signedChecksum: signChecksum(checksum),
      metadata: {
        rulesVersion: manifest.version ?? null,
        rulesOwner: manifest.owner ?? null,
        reviewCadenceDays: manifest.review_cadence_days ?? null
      },
      downloadUrl
    });
  } catch (err: any) {
    const status = err?.status ?? 500;
    res.status(status).json({ error: err?.message ?? "INTERNAL_ERROR" });
  }
});

proofsRouter.get("/:date/download", async (req, res) => {
  try {
    const { date, dir, pack } = await ensurePack(req.params.date);
    const expected = pack.bundle_sha256;
    const files = formatFiles(pack.files ?? []);
    const recalculated = computeChecksum(files);
    if (recalculated !== expected) {
      throw buildError(500, "CHECKSUM_MISMATCH");
    }
    const zip = await buildZipBuffer(dir);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="evte-${date}.zip"`);
    res.send(zip);
  } catch (err: any) {
    const status = err?.status ?? 500;
    res.status(status).json({ error: err?.message ?? "INTERNAL_ERROR" });
  }
});
