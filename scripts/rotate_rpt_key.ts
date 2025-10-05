import { promises as fs } from "fs";
import path from "path";
import nacl from "tweetnacl";
import { getKeyStorePath } from "../src/rpt/kms";
import { KeyStoreFile, KeyRecord } from "../src/rpt/types";

function base64Url(buffer: Uint8Array): string {
  return Buffer.from(buffer).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function ensureDir(filePath: string) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function loadStore(filePath: string): Promise<KeyStoreFile> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as KeyStoreFile;
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      return { active_kid: "", keys: [] };
    }
    throw err;
  }
}

async function saveStore(filePath: string, store: KeyStoreFile) {
  await ensureDir(filePath);
  await fs.writeFile(filePath, JSON.stringify(store, null, 2) + "\n");
}

async function writeJwks(keys: KeyRecord[]) {
  const jwksPath = path.resolve(process.cwd(), "public/.well-known/jwks.json");
  await ensureDir(jwksPath);
  const activeKeys = keys.filter(k => k.status === "active");
  const jwks = {
    keys: activeKeys.map(k => ({
      kty: "OKP",
      crv: "Ed25519",
      use: "sig",
      alg: "EdDSA",
      kid: k.kid,
      x: k.publicKey,
    })),
  };
  await fs.writeFile(jwksPath, JSON.stringify(jwks, null, 2) + "\n");
}

async function rotate() {
  const keystorePath = getKeyStorePath();
  const store = await loadStore(keystorePath);
  if (store.active_kid) {
    store.keys = store.keys.map(k =>
      k.kid === store.active_kid && k.status === "active" ? { ...k, status: "retired" } : k
    );
  }
  const keyPair = nacl.sign.keyPair();
  const kid = `rpt-${Date.now()}`;
  const record: KeyRecord = {
    kid,
    privateKey: base64Url(keyPair.secretKey),
    publicKey: base64Url(keyPair.publicKey),
    status: "active",
    createdAt: new Date().toISOString(),
  };
  store.active_kid = kid;
  store.keys = [...store.keys.filter(k => k.kid !== kid), record];
  await saveStore(keystorePath, store);
  await writeJwks(store.keys);
  console.log(`Rotated RPT signing key. Active kid=${kid}`);
}

rotate().catch(err => {
  console.error("Failed to rotate RPT key", err);
  process.exit(1);
});
