import fs from "fs";
import path from "path";
import { KmsProvider, KmsSigningMaterial, KmsPublicKey } from "./kms";

interface KeysetEntry {
  kid: string;
  publicKeyBase64: string;
  ratesVersion: string;
}

export class AwsKmsProvider implements KmsProvider {
  private signing?: KmsSigningMaterial;
  private keyset?: KmsPublicKey[];

  async getSigningMaterial(): Promise<KmsSigningMaterial> {
    if (this.signing) return this.signing;
    const secretFile = process.env.AWS_KMS_SECRET_BASE64_FILE;
    if (!secretFile) throw new Error("AWS_KMS_SECRET_BASE64_FILE not configured");
    const kid = process.env.AWS_KMS_KID || "aws-kms";
    const ratesVersion = process.env.RATES_VERSION || "v0";
    const raw = fs.readFileSync(path.resolve(secretFile), "utf8").trim();
    this.signing = {
      kid,
      ratesVersion,
      secretKey: new Uint8Array(Buffer.from(raw, "base64")),
    };
    return this.signing;
  }

  async listPublicKeys(): Promise<KmsPublicKey[]> {
    if (this.keyset) return this.keyset;
    const file = process.env.AWS_KMS_KEYSET_FILE;
    if (!file) throw new Error("AWS_KMS_KEYSET_FILE not configured");
    const parsed: KeysetEntry[] = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
    this.keyset = parsed.map((entry) => ({
      kid: entry.kid,
      ratesVersion: entry.ratesVersion,
      publicKey: new Uint8Array(Buffer.from(entry.publicKeyBase64, "base64")),
    }));
    return this.keyset;
  }
}
