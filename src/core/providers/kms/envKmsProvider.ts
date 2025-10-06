import nacl from "tweetnacl";
import { KmsProvider, KmsProviderError, KmsSignature } from "@core/ports";

function getSecret(alias: string): Uint8Array {
  const envVar = `${alias.toUpperCase()}_BASE64`;
  const value = process.env[envVar];
  if (!value) {
    throw new KmsProviderError(`Missing secret for alias ${alias}`);
  }
  return new Uint8Array(Buffer.from(value, "base64"));
}

export function createEnvKmsProvider(): KmsProvider {
  return {
    async getKeyAlias(alias: string) {
      return { privateKey: getSecret(alias) };
    },
    async signEd25519(alias: string, payload: Uint8Array): Promise<KmsSignature> {
      const secret = getSecret(alias);
      const signature = nacl.sign.detached(payload, secret);
      return { signature, algorithm: "ED25519" };
    },
  };
}
