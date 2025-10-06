import { AwsKmsProvider } from "./awskms";
import { GcpKmsProvider } from "./gcpkms";
import { LocalEd25519Provider } from "./localEd25519";

export interface KmsSigningMaterial {
  kid: string;
  ratesVersion: string;
  secretKey: Uint8Array;
}

export interface KmsPublicKey {
  kid: string;
  ratesVersion: string;
  publicKey: Uint8Array;
}

export interface KmsProvider {
  getSigningMaterial(): Promise<KmsSigningMaterial>;
  listPublicKeys(): Promise<KmsPublicKey[]>;
}

export function selectKmsProvider(): KmsProvider {
  const feature = (process.env.FEATURE_KMS || "local").toLowerCase();
  if (feature === "aws" || feature === "awskms") {
    return new AwsKmsProvider();
  }
  if (feature === "gcp" || feature === "gcpkms") {
    return new GcpKmsProvider();
  }
  return new LocalEd25519Provider();
}
