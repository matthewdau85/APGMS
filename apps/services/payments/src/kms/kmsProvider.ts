// apps/services/payments/src/kms/kmsProvider.ts
import { IKms } from "./IKms";
import { AwsKmsProvider } from "./awsKms";
import { GcpKmsProvider } from "./gcpKms";
import { LocalKeyProvider } from "./localKey";

type Backend = "local" | "aws" | "gcp" | "hsm";

function resolveBackend(): Backend {
  const raw =
    process.env.RPT_KMS_BACKEND ||
    process.env.KMS_BACKEND ||
    process.env.PAYMENTS_KMS_BACKEND ||
    "local";
  const backend = raw.toLowerCase() as Backend;
  if (["local", "aws", "gcp"].includes(backend)) return backend;
  return "local";
}

function createProvider(): IKms {
  switch (resolveBackend()) {
    case "aws":
      return new AwsKmsProvider();
    case "gcp":
      return new GcpKmsProvider();
    default:
      return new LocalKeyProvider();
  }
}

let singleton: IKms | null = null;

export function selectKms(): IKms {
  if (!singleton) {
    singleton = createProvider();
  }
  return singleton;
}
