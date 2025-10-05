import "../../loadEnv.js";
import { KmsPort, KmsSignParams, KmsVerifyParams } from "@core/ports";
import { KMSClient, GetPublicKeyCommand, SignCommand } from "@aws-sdk/client-kms";
import { KeyManagementServiceClient } from "@google-cloud/kms";
import * as ed from "@noble/ed25519";
import { createMockKmsPort } from "./mock";

class AwsKmsPort implements KmsPort {
  private readonly client = new KMSClient({ region: process.env.AWS_REGION || "ap-southeast-2" });

  getCapabilities(): string[] {
    return ["real", "aws-kms", "verify-ed25519", "sign-ed25519"];
  }

  async fetchPublicKey(keyId: string): Promise<Uint8Array> {
    const cached = process.env.ED25519_PUB_RAW_BASE64;
    if (cached) {
      return Uint8Array.from(Buffer.from(cached, "base64"));
    }
    const out = await this.client.send(new GetPublicKeyCommand({ KeyId: keyId }));
    if (!out.PublicKey) {
      throw new Error("AWS KMS returned no public key");
    }
    return Uint8Array.from(out.PublicKey as Buffer);
  }

  async verify({ payload, signature, keyId }: KmsVerifyParams): Promise<boolean> {
    if (!keyId) throw new Error("AWS KMS verify requires keyId");
    const message = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const sig = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
    const pub = await this.fetchPublicKey(keyId);
    return ed.verify(sig, message, pub);
  }

  async sign({ payload, keyId }: KmsSignParams): Promise<Uint8Array> {
    if (!keyId) throw new Error("AWS KMS sign requires keyId");
    const message = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const out = await this.client.send(new SignCommand({
      KeyId: keyId,
      Message: message,
      MessageType: "RAW",
      SigningAlgorithm: "EDDSA"
    }));
    if (!out.Signature) throw new Error("AWS KMS returned no signature");
    return Uint8Array.from(out.Signature as Buffer);
  }
}

class GcpKmsPort implements KmsPort {
  private readonly client = new KeyManagementServiceClient();

  getCapabilities(): string[] {
    return ["real", "gcp-kms", "verify-ed25519", "sign-ed25519"];
  }

  async verify({ payload, signature, keyId }: KmsVerifyParams): Promise<boolean> {
    if (!keyId) throw new Error("GCP KMS verify requires keyId");
    const message = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const sig = Buffer.isBuffer(signature) ? signature : Buffer.from(signature);
    const raw = process.env.ED25519_PUB_RAW_BASE64;
    if (!raw) throw new Error("Set ED25519_PUB_RAW_BASE64 when using GCP KMS");
    const pub = Uint8Array.from(Buffer.from(raw, "base64"));
    return ed.verify(sig, message, pub);
  }

  async sign({ payload, keyId }: KmsSignParams): Promise<Uint8Array> {
    if (!keyId) throw new Error("GCP KMS sign requires keyId");
    const message = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const [resp] = await this.client.asymmetricSign({ name: keyId, digest: { sha256: undefined }, data: message });
    if (!resp.signature) throw new Error("GCP KMS returned no signature");
    return Uint8Array.from(resp.signature as Buffer);
  }
}

export function createRealKmsPort(): KmsPort {
  const backend = (process.env.KMS_BACKEND ?? "local").toLowerCase();
  if (backend === "aws") {
    return new AwsKmsPort();
  }
  if (backend === "gcp") {
    return new GcpKmsPort();
  }
  // Fallback to local behaviour when no cloud backend configured.
  return createMockKmsPort();
}
