export interface AwsKmsConfig {
  keyIds: string[];
}

export interface AwsKmsPublicKey {
  kid: string;
  publicKey: Uint8Array;
}

export class AwsKmsProvider {
  private keyIds: string[];
  private client: any;

  constructor(config?: AwsKmsConfig) {
    const envIds = process.env.RPT_KMS_KEY_IDS?.split(",").map((id) => id.trim()).filter(Boolean) ?? [];
    this.keyIds = config?.keyIds?.length ? config.keyIds : envIds;
    if (!this.keyIds.length && process.env.RPT_KMS_KEY_ID) {
      this.keyIds = [process.env.RPT_KMS_KEY_ID];
    }
  }

  private async loadModule(): Promise<any> {
    try {
      return await import("@aws-sdk/client-kms");
    } catch (err) {
      throw new Error("AWS_KMS_MODULE_NOT_INSTALLED");
    }
  }

  private async ensureClient(): Promise<any> {
    if (this.client) return this.client;
    const mod = await this.loadModule();
    this.client = new mod.KMSClient({ region: process.env.AWS_REGION });
    return this.client;
  }

  async sign(payload: Uint8Array, kid?: string): Promise<{ kid: string; signature: Uint8Array }> {
    const keyId = kid ?? this.keyIds[0];
    if (!keyId) throw new Error("AWS_KMS_NO_KEY_ID");
    const mod = await this.loadModule();
    const client = await this.ensureClient();
    const { Signature } = await client.send(
      new mod.SignCommand({
        KeyId: keyId,
        Message: payload,
        MessageType: "RAW",
        SigningAlgorithm: "EDDSA",
      })
    );
    if (!Signature) throw new Error("AWS_KMS_NO_SIGNATURE");
    return { kid: keyId, signature: new Uint8Array(Signature) };
  }

  async getPublicKeys(): Promise<AwsKmsPublicKey[]> {
    const ids = this.keyIds;
    const mod = await this.loadModule();
    const client = await this.ensureClient();
    const outputs = await Promise.all(
      ids.map(async (keyId) => {
        const { PublicKey } = await client.send(new mod.GetPublicKeyCommand({ KeyId: keyId }));
        if (!PublicKey) throw new Error(`AWS_KMS_NO_PUBLIC_KEY:${keyId}`);
        return { kid: keyId, publicKey: new Uint8Array(PublicKey) };
      })
    );
    return outputs;
  }

  async getActiveKid(): Promise<string> {
    const keyId = this.keyIds[0];
    if (!keyId) throw new Error("AWS_KMS_NO_KEY_ID");
    return keyId;
  }
}
