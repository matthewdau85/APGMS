// apps/services/payments/src/kms/kmsProvider.ts

export interface ManagedKms {
  getPublicKey(kid: string): Promise<Uint8Array>;
  sign(kid: string, message: Uint8Array): Promise<Uint8Array>;
  verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean>;
}

type Backend = "local" | "aws" | "gcp" | "hsm";

let cachedProvider: Promise<ManagedKms> | null = null;

function resolveBackend(): Backend {
  const raw = (process.env.KMS_BACKEND ?? process.env.KMS_PROVIDER ?? "local").toLowerCase();
  if (raw === "aws" || raw === "gcp" || raw === "hsm" || raw === "local") {
    return raw as Backend;
  }
  return "local";
}

async function instantiate(backend: Backend): Promise<ManagedKms> {
  switch (backend) {
    case "aws": {
      const mod = await import("./awsKms.js").catch(() => import("./awsKms"));
      return new mod.AwsKmsProvider();
    }
    case "gcp": {
      const mod = await import("./gcpKms.js").catch(() => import("./gcpKms"));
      return new mod.GcpKmsProvider();
    }
    case "hsm": {
      throw new Error("HSM backend is not implemented in this environment");
    }
    case "local":
    default: {
      const mod = await import("./localKey.js").catch(() => import("./localKey"));
      return new mod.LocalKeyProvider();
    }
  }
}

export async function getManagedKms(): Promise<ManagedKms> {
  if (!cachedProvider) {
    cachedProvider = instantiate(resolveBackend());
  }
  return cachedProvider;
}

export function getActiveKeyId(): string {
  return (
    process.env.RPT_ACTIVE_KID ||
    process.env.KMS_KEY_ID ||
    process.env.RPT_KMS_KEY_ID ||
    "local-ed25519"
  );
}

export async function signWithManagedKms(message: Uint8Array, keyId?: string): Promise<{ kid: string; signature: Uint8Array }>
{
  const kms = await getManagedKms();
  const kid = keyId ?? getActiveKeyId();
  const signature = await kms.sign(kid, message);
  return { kid, signature };
}

export async function verifyWithManagedKms(
  message: Uint8Array,
  signature: Uint8Array,
  keyId: string
): Promise<boolean> {
  const kms = await getManagedKms();
  return kms.verify(keyId, message, signature);
}
