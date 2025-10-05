import { KeyManagementServiceClient } from "@google-cloud/kms";
import { IKms } from "./IKms";

export class GcpKmsProvider implements IKms {
  private readonly client = new KeyManagementServiceClient();
  private readonly defaultKeyName: string;

  constructor() {
    this.defaultKeyName = process.env.GCP_KMS_KEY_NAME || process.env.KMS_KEY_ID || "";
    if (!this.defaultKeyName) {
      throw new Error("Set GCP_KMS_KEY_NAME or KMS_KEY_ID when using the GCP KMS backend");
    }
  }

  async verify(payload: Buffer, signature: Buffer, kid?: string): Promise<boolean> {
    const name = kid || this.defaultKeyName;
    const [result] = await this.client.verify({ name, data: payload, signature });
    return Boolean(result.verified);
  }
}
