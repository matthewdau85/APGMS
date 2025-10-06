declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "@aws-sdk/client-kms" {
  export class KMSClient {
    constructor(config?: any);
    send(command: any): Promise<any>;
  }
  export class SignCommand {
    constructor(input: any);
  }
  export class VerifyCommand {
    constructor(input: any);
  }
}

declare module "@google-cloud/kms" {
  export class KeyManagementServiceClient {
    constructor(config?: any);
    asymmetricSign(request: any): Promise<any[]>;
    getPublicKey(request: any): Promise<any[]>;
  }
}
