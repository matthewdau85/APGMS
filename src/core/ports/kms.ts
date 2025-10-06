export interface KmsSignature {
  signature: Uint8Array;
  algorithm: "ED25519";
}

export interface KmsProvider {
  getKeyAlias(alias: string): Promise<{ publicKey?: Uint8Array; privateKey?: Uint8Array }>;
  signEd25519(alias: string, payload: Uint8Array): Promise<KmsSignature>;
}

export class KmsProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmsProviderError";
  }
}
