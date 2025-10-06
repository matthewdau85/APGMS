declare module "@aws-sdk/client-kms" {
  export class KMSClient {
    constructor(config?: any);
    send(command: any): Promise<any>;
  }
  export class EncryptCommand {
    constructor(input: any);
  }
  export class DecryptCommand {
    constructor(input: any);
  }
}
