import pg from "pg";
import {KmsProvider} from "./kmsProvider";
import * as ed from "@noble/ed25519";
import { KeyManagementServiceClient } from "@google-cloud/kms";

export class GcpKmsProvider implements KmsProvider {
  private client = new KeyManagementServiceClient();

  async getPublicKey(kid: string): Promise<Uint8Array> {
    const raw = process.env.ED25519_PUB_RAW_BASE64;
    if (!raw) throw new Error("Set ED25519_PUB_RAW_BASE64 when using GCP KMS");
    return Buffer.from(raw, "base64");
  }

  async sign(kid: string, message: Uint8Array): Promise<Uint8Array> {
    const [resp] = await this.client.asymmetricSign({ name: kid, digest: { sha256: undefined }, data: message });
    if (!resp.signature) throw new Error("No signature from KMS");
    return new Uint8Array(resp.signature as Buffer);
  }

  async verify(kid: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const pub = await this.getPublicKey(kid);
    return await ed.verify(signature, message, pub);
  }
}
