import nacl from "tweetnacl";

export interface Kms {
  sign(payload: string): Promise<string>;
  verify(payload: string, signature: string): Promise<boolean>;
}

export class LocalEd25519Kms implements Kms {
  public readonly privateKey: Uint8Array;
  public readonly publicKey: Uint8Array;

  constructor(secretHex: string) {
    const seed = Buffer.from(secretHex, "hex");
    if (seed.length !== nacl.sign.seedLength) {
      throw new Error(
        `LocalEd25519Kms expects a ${nacl.sign.seedLength * 2}-character hex seed`
      );
    }

    const keyPair = nacl.sign.keyPair.fromSeed(seed);
    this.privateKey = keyPair.secretKey;
    this.publicKey = keyPair.publicKey;
  }

  async sign(payload: string): Promise<string> {
    const message = Buffer.from(payload);
    const signature = nacl.sign.detached(message, this.privateKey);
    return Buffer.from(signature).toString("base64");
  }

  async verify(payload: string, signature: string): Promise<boolean> {
    const message = Buffer.from(payload);
    const signatureBytes = Buffer.from(signature, "base64");
    return nacl.sign.detached.verify(message, signatureBytes, this.publicKey);
  }
}
