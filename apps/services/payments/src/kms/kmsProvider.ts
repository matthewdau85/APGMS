// apps/services/payments/src/kms/kmsProvider.ts
import { IKms } from "./IKms";
import { LocalKeyProvider } from "./localKey";
export interface KmsProvider {
  getKeyId(): string;
  signEd25519(data: Uint8Array, keyIdOverride?: string): Promise<Uint8Array>;
  verifyEd25519(data: Uint8Array, sig: Uint8Array, pubKey: Uint8Array): Promise<boolean>;
}

type Backend = "local" | "aws" | "gcp" | "hsm";

/**
 * Lazy-load correct provider using ESM dynamic import().
 * Select with env KMS_BACKEND = local|aws|gcp|hsm (default: local)
 */
export async function getKms(): Promise<KmsProvider> {
  const backend = (process.env.KMS_BACKEND ?? "local").toLowerCase() as Backend;

  switch (backend) {
    case "aws": {
      const { AwsKmsProvider } = await import("./awsKms.js").catch(() => import("./awsKms"));
      return new AwsKmsProvider();
    }
    case "gcp": {
      const { GcpKmsProvider } = await import("./gcpKms.js").catch(() => import("./gcpKms"));
      return new GcpKmsProvider();
    }
    case "hsm": {
      const { HsmProvider } = await import("./hsm.js").catch(() => import("./hsm"));
      return new HsmProvider();
    }
    case "local":
    default: {
      const { LocalKeyProvider } = await import("./localKey.js").catch(() => import("./localKey"));
      return new LocalKeyProvider();
    }
  }
}

export function selectKms(): IKms {
  const override = (globalThis as any).__APGMS_TEST_KMS__ as IKms | undefined;
  if (override) return override;
  return new LocalKeyProvider();
}
