import type { KmsProvider } from "@core/ports/kms";
import { KMSClient, GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import * as ed from "@noble/ed25519";

export class AwsKmsProvider implements KmsProvider {
  private client = new KMSClient({ region: process.env.AWS_REGION || "ap-southeast-2" });

  async getPublicKey(kid: string): Promise<Uint8Array> {
    const out = await this.client.send(new GetPublicKeyCommand({ KeyId: kid }));
    if (!out.PublicKey) throw new Error("No public key");
    const raw = process.env.ED25519_PUB_RAW_BASE64;
    if (!raw) throw new Error("Set ED25519_PUB_RAW_BASE64 when using AWS KMS");
    return Buffer.from(raw, "base64");
  }

  async sign(kid: string, message: Uint8Array): Promise<Uint8Array> {
    const out = await this.client.send(new SignCommand({
      KeyId: kid, Message: message, MessageType: "RAW", SigningAlgorithm: "EDDSA"
    }));
    if (!out.Signature) throw new Error("No signature from KMS");
    return new Uint8Array(out.Signature as Buffer);
  }

  async verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const pub = await this.getPublicKey(kid);
    return await ed.verify(signature, message, pub);
  }
}
