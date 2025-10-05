import { KmsPort, KmsSignParams, KmsVerifyParams } from "@core/ports";
import { createMockKmsPort } from "./mock";
import { createRealKmsPort } from "./real";

class ShadowKmsPort implements KmsPort {
  private readonly real: KmsPort;
  private readonly mock: KmsPort;

  constructor(real: KmsPort, mock: KmsPort) {
    this.real = real;
    this.mock = mock;
  }

  getCapabilities(): string[] {
    const realCaps = this.real.getCapabilities?.() ?? [];
    return ["shadow", ...realCaps];
  }

  async verify(params: KmsVerifyParams): Promise<boolean> {
    try {
      return await this.real.verify(params);
    } catch (error) {
      console.warn("[kms-shadow] verify fallback", error);
      return this.mock.verify(params);
    }
  }

  async sign(params: KmsSignParams): Promise<Uint8Array> {
    if (!this.real.sign) {
      throw new Error("Real KMS does not support signing in this mode");
    }
    try {
      return await this.real.sign(params);
    } catch (error) {
      console.warn("[kms-shadow] sign fallback", error);
      if (!this.mock.sign) {
        throw error;
      }
      return this.mock.sign(params);
    }
  }
}

export function createShadowKmsPort(): KmsPort {
  return new ShadowKmsPort(createRealKmsPort(), createMockKmsPort());
}
