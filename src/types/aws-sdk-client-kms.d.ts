declare module "@aws-sdk/client-kms" {
  export class KMSClient {
    constructor(config?: Record<string, any>);
    send(command: any): Promise<any>;
  }
  export class SignCommand {
    constructor(input: Record<string, any>);
  }
  export class GetPublicKeyCommand {
    constructor(input: Record<string, any>);
  }
}
