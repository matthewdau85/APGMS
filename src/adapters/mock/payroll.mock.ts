import { PayrollPort } from "../../ports/payroll";

export class MockPayroll implements PayrollPort {
  async ingest(_abn: string, _grossCents: number, _paygCents: number, _occurredAtISO: string) {
    /* no-op */
  }
}
