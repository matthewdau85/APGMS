import { PayrollPort } from "../../ports/payroll";

export class MockPayroll implements PayrollPort {
  async ingestStp(): Promise<void> {
    return Promise.resolve();
  }
}
