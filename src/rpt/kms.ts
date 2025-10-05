import { promises as fs } from "fs";
import path from "path";
import nacl from "tweetnacl";
import { TextEncoder } from "util";
import { KeyRecord, KeyStoreFile, RptPayloadV01 } from "./types";

const encoder = new TextEncoder();

function base64UrlEncode(input: Uint8Array | Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : Buffer.from(input);
  return buf.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  const final = padded + "=".repeat(pad);
  return new Uint8Array(Buffer.from(final, "base64"));
}

function base64UrlDecodeToString(input: string): string {
  return Buffer.from(base64UrlDecode(input)).toString("utf-8");
}

export function getKeyStorePath(): string {
  const configured = process.env.RPT_KEYSTORE_PATH;
  if (configured) return configured;
  return path.resolve(process.cwd(), "infra/kms/rpt_keys.json");
}

async function readKeyStore(): Promise<KeyStoreFile> {
  const filePath = getKeyStorePath();
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw) as KeyStoreFile;
}

export async function getActiveKid(): Promise<string> {
  const store = await readKeyStore();
  if (!store.active_kid) {
    throw new Error("RPT_KMS_NO_ACTIVE_KID");
  }
  return store.active_kid;
}

export async function getKeyRecord(kid: string): Promise<KeyRecord> {
  const store = await readKeyStore();
  const record = store.keys.find(k => k.kid === kid);
  if (!record) {
    throw new Error(`RPT_KMS_UNKNOWN_KID:${kid}`);
  }
  return record;
}

export async function getPublicKey(kid: string): Promise<Uint8Array> {
  const record = await getKeyRecord(kid);
  if (record.status === "revoked") {
    throw new Error(`RPT_KMS_KID_REVOKED:${kid}`);
  }
  return base64UrlDecode(record.publicKey);
}

export async function getPrivateKey(kid: string): Promise<Uint8Array> {
  const record = await getKeyRecord(kid);
  if (record.status === "revoked") {
    throw new Error(`RPT_KMS_KID_REVOKED:${kid}`);
  }
  return base64UrlDecode(record.privateKey);
}

export async function signJWS(payload: RptPayloadV01, kid: string): Promise<string> {
  const privateKey = await getPrivateKey(kid);
  const header = { alg: "EdDSA", typ: "JWT", kid };
  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadWithKid = { ...payload, kid };
  const payloadB64 = base64UrlEncode(JSON.stringify(payloadWithKid));
  const signingInput = `${headerB64}.${payloadB64}`;
  const sig = nacl.sign.detached(encoder.encode(signingInput), privateKey);
  const sigB64 = base64UrlEncode(sig);
  return `${signingInput}.${sigB64}`;
}

export async function verifyJWS(jws: string, expectedKid?: string): Promise<RptPayloadV01> {
  const parts = jws.split(".");
  if (parts.length !== 3) {
    throw new Error("RPT_JWS_FORMAT");
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const headerJson = base64UrlDecodeToString(headerB64);
  const header = JSON.parse(headerJson);
  if (header.alg !== "EdDSA") throw new Error("RPT_JWS_UNSUPPORTED_ALG");
  if (expectedKid && header.kid !== expectedKid) throw new Error("RPT_JWS_KID_MISMATCH");
  const kid = header.kid as string;
  const payloadJson = base64UrlDecodeToString(payloadB64);
  const payload = JSON.parse(payloadJson) as RptPayloadV01;
  const publicKey = await getPublicKey(kid);
  const signingInput = `${headerB64}.${payloadB64}`;
  const ok = nacl.sign.detached.verify(encoder.encode(signingInput), base64UrlDecode(sigB64), publicKey);
  if (!ok) throw new Error("RPT_JWS_INVALID_SIG");
  if (payload.kid !== kid) throw new Error("RPT_JWS_PAYLOAD_KID_MISMATCH");
  return payload;
}
