import { KMSClient, VerifyCommand } from "@aws-sdk/client-kms";
import { IKms } from "./IKms";

export class AwsKmsProvider implements IKms {
  private readonly client: KMSClient;
  private readonly defaultKeyId: string;

  constructor() {
    this.client = new KMSClient({ region: process.env.AWS_REGION || "ap-southeast-2" });
    this.defaultKeyId = process.env.AWS_KMS_KEY_ID || process.env.KMS_KEY_ID || "";
    if (!this.defaultKeyId) {
      throw new Error("Set AWS_KMS_KEY_ID or KMS_KEY_ID when using the AWS KMS backend");
    }
  }

  async verify(payload: Buffer, signature: Buffer, kid?: string): Promise<boolean> {
    const keyId = kid || this.defaultKeyId;
    const response = await this.client.send(new VerifyCommand({
      KeyId: keyId,
      Message: payload,
      MessageType: "RAW",
      Signature: signature,
      SigningAlgorithm: "EDDSA",
    }));
    return Boolean(response.SignatureValid);
  }
}
