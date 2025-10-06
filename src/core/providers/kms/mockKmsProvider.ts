import { randomBytes } from "crypto";
import nacl from "tweetnacl";
import { KmsProvider, KmsProviderError, KmsSignature } from "@core/ports";

export interface MockKmsProviderOptions {
  privateKey?: Uint8Array;
}

export function createMockKmsProvider(options: MockKmsProviderOptions = {}): KmsProvider {
  const secret = options.privateKey ?? new Uint8Array(randomBytes(64));
  return {
    async getKeyAlias(alias: string) {
      if (!alias) {
        throw new KmsProviderError("ALIAS_REQUIRED");
      }
      return { privateKey: secret };
    },
    async signEd25519(alias: string, payload: Uint8Array): Promise<KmsSignature> {
      if (!alias) {
        throw new KmsProviderError("ALIAS_REQUIRED");
      }
      const signature = nacl.sign.detached(payload, secret);
      return { signature, algorithm: "ED25519" };
    },
  };
}
