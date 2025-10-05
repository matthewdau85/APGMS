import { PosPort } from "../../ports/pos";

export class MockPos implements PosPort {
  async ingestSale(): Promise<void> {
    return Promise.resolve();
  }
}
