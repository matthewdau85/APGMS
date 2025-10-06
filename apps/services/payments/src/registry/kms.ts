import type { KmsProvider, KmsVerifier } from "@core/ports/kms";
import { LocalKeyProvider } from "@providers/kms/local/real";

type Backend = "local" | "aws" | "gcp" | "hsm";

/**
 * Lazy-load correct provider using ESM dynamic import().
 * Select with env KMS_BACKEND = local|aws|gcp|hsm (default: local)
 */
export async function getKms(): Promise<KmsProvider> {
  const backend = (process.env.KMS_BACKEND ?? "local").toLowerCase() as Backend;

  switch (backend) {
    case "aws": {
      const { AwsKmsProvider } = await import("@providers/kms/aws/real");
      return new AwsKmsProvider();
    }
    case "gcp": {
      const { GcpKmsProvider } = await import("@providers/kms/gcp/real");
      return new GcpKmsProvider();
    }
    case "hsm": {
      throw new Error("HSM backend not implemented yet");
    }
    case "local":
    default: {
      // LocalKeyProvider only implements verification. Cast to satisfy the return type until
      // the signing surface is wired for local development.
      return new LocalKeyProvider() as unknown as KmsProvider;
    }
  }
}

export function selectKms(): KmsVerifier {
  return new LocalKeyProvider();
}
