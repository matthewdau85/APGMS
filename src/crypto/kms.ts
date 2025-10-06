import path from "path";
import { promises as fs } from "fs";
import { createHash } from "crypto";
import nacl from "tweetnacl";

import { LocalEd25519Provider, LocalStoredKey, KmsPublicKeyRecord } from "./providers/localEd25519";
import { AwsKmsProvider } from "./providers/awsKms";

export interface SignResult {
  kid: string;
  signature: Uint8Array;
}

export interface PublicKeyDescriptor {
  kid: string;
  publicKey: Uint8Array;
  status?: string;
  graceEndsAt?: string | null;
}

export interface RotationDrillArtifact {
  kidOld?: string | null;
  kidNew: string;
  start: string;
  end: string;
  sampleTokens: Array<{
    id: string;
    kid: string;
    payloadHash: string;
    verifiedDuringGrace: boolean;
    verifiedPostGrace: boolean;
  }>;
  verificationSummary: {
    duringGrace: boolean;
    afterGrace: boolean;
  };
  artifactPath: string;
}

let providerPromise: Promise<any> | null = null;

function featureEnabled(): boolean {
  return String(process.env.FEATURE_KMS ?? "false").toLowerCase() === "true";
}

function resolveBackend(): "aws" | "local" {
  const backend = (process.env.KMS_PROVIDER ?? process.env.KMS_BACKEND ?? "local").toLowerCase();
  if (backend === "aws") return "aws";
  return "local";
}

async function buildProvider() {
  if (!featureEnabled()) {
    return new LocalEd25519Provider();
  }
  const backend = resolveBackend();
  switch (backend) {
    case "aws":
      return new AwsKmsProvider();
    case "local":
    default:
      return new LocalEd25519Provider();
  }
}

async function getProvider<T = any>(): Promise<T> {
  if (!providerPromise) {
    providerPromise = buildProvider();
  }
  return providerPromise as Promise<T>;
}

export async function resetProviderForTests() {
  providerPromise = null;
}

export async function sign(payload: Uint8Array, kid?: string): Promise<SignResult> {
  const provider = await getProvider<any>();
  if (!provider?.sign) throw new Error("KMS_PROVIDER_SIGN_UNDEFINED");
  return provider.sign(payload, kid);
}

export async function getPublicKeys(): Promise<PublicKeyDescriptor[]> {
  const provider = await getProvider<any>();
  const records: KmsPublicKeyRecord[] | PublicKeyDescriptor[] = await provider.getPublicKeys();
  return records.map((rec: any) => ({
    kid: rec.kid,
    publicKey: rec.publicKey,
    status: rec.status,
    graceEndsAt: rec.graceEndsAt ?? null,
  }));
}

export async function listKeys(): Promise<PublicKeyDescriptor[]> {
  const provider = await getProvider<any>();
  if (!provider?.listKeys) {
    const current = await getPublicKeys();
    return current;
  }
  const records = await provider.listKeys();
  return records.map((rec: any) => ({
    kid: rec.kid,
    publicKey: rec.publicKey,
    status: rec.status,
    graceEndsAt: rec.graceEndsAt ?? null,
  }));
}

export async function getActiveKid(): Promise<string> {
  const provider = await getProvider<any>();
  if (provider?.getActiveKid) {
    return provider.getActiveKid();
  }
  const keys = await getPublicKeys();
  if (!keys.length) throw new Error("KMS_NO_ACTIVE_KEY");
  return keys[0].kid;
}

export async function addKey(): Promise<LocalStoredKey> {
  const provider = await getProvider<any>();
  if (!provider?.addKey) throw new Error("KMS_PROVIDER_ADD_KEY_UNSUPPORTED");
  return provider.addKey();
}

export async function activateKey(kid: string, graceUntil: Date | null) {
  const provider = await getProvider<any>();
  if (!provider?.activateKey) throw new Error("KMS_PROVIDER_ACTIVATE_UNSUPPORTED");
  return provider.activateKey(kid, graceUntil);
}

export async function retireKey(kid: string) {
  const provider = await getProvider<any>();
  if (!provider?.retireKey) throw new Error("KMS_PROVIDER_RETIRE_UNSUPPORTED");
  return provider.retireKey(kid);
}

export function decodeSignature(signatureB64: string): Uint8Array {
  const normalized = signatureB64.includes("-") || signatureB64.includes("_")
    ? signatureB64
    : signatureB64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  return new Uint8Array(Buffer.from(normalized, "base64url"));
}

export async function verifySignature(payload: Uint8Array, signature: Uint8Array, kid: string): Promise<boolean> {
  const keys = await getPublicKeys();
  const key = keys.find((k) => k.kid === kid);
  if (!key) return false;
  return nacl.sign.detached.verify(payload, signature, key.publicKey);
}

async function ensureArtifactsDir(): Promise<string> {
  const dir = path.resolve(process.cwd(), "ops/artifacts");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function buildPdf(lines: string[]): Buffer {
  const contentLines = lines
    .map((line, idx) => (idx === 0 ? `(${escapePdfText(line)}) Tj` : `T* (${escapePdfText(line)}) Tj`))
    .join("\n");
  const content = [`BT`, `/F1 12 Tf`, `72 720 Td`, contentLines, `ET`].join("\n");
  const contentBuffer = Buffer.from(content, "utf8");
  const objects: string[] = [];
  objects.push("1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj");
  objects.push("2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj");
  objects.push("3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj");
  objects.push(`4 0 obj<< /Length ${contentBuffer.length} >>stream\n${content}\nendstreamendobj`);
  objects.push("5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj");
  const offsets: number[] = [];
  let cursor = "%PDF-1.4\n".length;
  const pieces = ["%PDF-1.4\n"];
  objects.forEach((obj) => {
    offsets.push(cursor);
    pieces.push(obj + "\n");
    cursor += obj.length + 1;
  });
  const xrefOffset = cursor;
  const xrefLines = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f "];
  offsets.forEach((offset) => {
    xrefLines.push(offset.toString().padStart(10, "0") + " 00000 n ");
  });
  const trailer = [
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF",
  ];
  const pdf = pieces.join("") + xrefLines.join("\n") + "\n" + trailer.join("\n") + "\n";
  return Buffer.from(pdf, "utf8");
}

async function writePdf(summary: RotationDrillArtifact): Promise<string> {
  const dir = await ensureArtifactsDir();
  const filename = `kms-rotation-${summary.start.replace(/[:T]/g, "-").replace(/\..*/, "")}.pdf`;
  const fullPath = path.join(dir, filename);
  const lines: string[] = [
    "APGMS KMS Rotation Drill",
    `Started: ${summary.start}`,
    `Completed: ${summary.end}`,
    `New KID: ${summary.kidNew}`,
    `Old KID: ${summary.kidOld ?? "n/a"}`,
    `Grace verification: ${summary.verificationSummary.duringGrace ? "pass" : "fail"}`,
    `Post-grace verification: ${summary.verificationSummary.afterGrace ? "pass" : "fail"}`,
    "Sample tokens:",
  ];
  summary.sampleTokens.forEach((sample, idx) => {
    lines.push(` ${idx + 1}. ${sample.id} [kid=${sample.kid}] grace=${sample.verifiedDuringGrace} post=${sample.verifiedPostGrace}`);
  });
  const pdf = buildPdf(lines);
  await fs.writeFile(fullPath, pdf);
  return fullPath;
}

async function writeSummary(summary: RotationDrillArtifact): Promise<void> {
  const dir = await ensureArtifactsDir();
  const jsonPath = path.join(dir, "last-rotation.json");
  await fs.writeFile(jsonPath, JSON.stringify(summary, null, 2));
}

export async function runRotationDrill(): Promise<RotationDrillArtifact> {
  const start = new Date();
  const graceDays = Number(process.env.RPT_KID_GRACE_DAYS ?? "7");
  const graceUntil = new Date(start.getTime() + graceDays * 86400000);

  const created = await addKey();
  const activation = await activateKey(created.kid, graceUntil);
  const kidOld = activation?.previousKid ?? null;

  const sampleTokens: RotationDrillArtifact["sampleTokens"] = [];

  const sampleNewPayload = Buffer.from(`drill-new-${created.kid}`);
  const signedNew = await sign(sampleNewPayload, created.kid);
  const hashNew = createHash("sha256").update(sampleNewPayload).digest("hex");
  const sampleNewId = `sample-${created.kid}`;

  const graceVerifiedNew = await verifySignature(sampleNewPayload, signedNew.signature, signedNew.kid);
  let postGraceVerifiedNew = graceVerifiedNew;

  sampleTokens.push({
    id: sampleNewId,
    kid: signedNew.kid,
    payloadHash: hashNew,
    verifiedDuringGrace: graceVerifiedNew,
    verifiedPostGrace: postGraceVerifiedNew,
  });

  if (kidOld) {
    const sampleOldPayload = Buffer.from(`drill-old-${kidOld}`);
    const signedOld = await sign(sampleOldPayload, kidOld);
    const hashOld = createHash("sha256").update(sampleOldPayload).digest("hex");
    const sampleOldId = `sample-${kidOld}`;
    const graceVerifiedOld = await verifySignature(sampleOldPayload, signedOld.signature, kidOld);

    await retireKey(kidOld);

    const postGraceOld = await verifySignature(sampleOldPayload, signedOld.signature, kidOld);

    sampleTokens.push({
      id: sampleOldId,
      kid: kidOld,
      payloadHash: hashOld,
      verifiedDuringGrace: graceVerifiedOld,
      verifiedPostGrace: postGraceOld,
    });

    postGraceVerifiedNew = await verifySignature(sampleNewPayload, signedNew.signature, signedNew.kid);
    sampleTokens[0].verifiedPostGrace = postGraceVerifiedNew;
  }

  const end = new Date();

  const summary: RotationDrillArtifact = {
    kidOld,
    kidNew: created.kid,
    start: start.toISOString(),
    end: end.toISOString(),
    sampleTokens,
    verificationSummary: {
      duringGrace: sampleTokens.every((t) => t.verifiedDuringGrace),
      afterGrace: sampleTokens.every((t) => t.verifiedPostGrace),
    },
    artifactPath: "",
  };

  const artifactPath = await writePdf(summary);
  summary.artifactPath = artifactPath;
  await writeSummary(summary);

  return summary;
}

export async function getLastRotationDrill(): Promise<RotationDrillArtifact | null> {
  try {
    const dir = await ensureArtifactsDir();
    const file = path.join(dir, "last-rotation.json");
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as RotationDrillArtifact;
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}
