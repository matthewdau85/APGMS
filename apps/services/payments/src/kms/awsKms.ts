import { KmsProvider } from "./kmsProvider";
import * as ed from "@noble/ed25519";

export class AwsKmsProvider implements KmsProvider {
  async getPublicKey(kid: string): Promise<Uint8Array> {
    const raw = process.env.ED25519_PUB_RAW_BASE64;
    if (!raw) throw new Error("Set ED25519_PUB_RAW_BASE64 when using AWS KMS");
    return Buffer.from(raw, "base64");
  }

  async sign(_kid: string, message: Uint8Array): Promise<Uint8Array> {
    const secret = process.env.ED25519_SECRET_BASE64;
    if (!secret) throw new Error("Set ED25519_SECRET_BASE64 for AWS mock");
    const pk = Buffer.from(secret, "base64");
    const { sign } = await import("tweetnacl");
    const sig = sign.detached(message, pk);
    return new Uint8Array(sig);
  }

  async verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const pub = await this.getPublicKey(kid);
    return ed.verify(signature, message, pub);
  }
}
