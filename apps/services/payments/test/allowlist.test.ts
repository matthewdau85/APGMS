import { AllowlistProvider, isAllowlisted, setAllowlistProvider } from "../src/utils/allowlist";

type Row = {
  abn: string;
  rail: "BPAY" | "EFT";
  reference?: string;
  bpay_biller?: string;
  bsb?: string;
  acct?: string;
};

class MemoryProvider implements AllowlistProvider {
  constructor(private readonly rows: Row[]) {}

  async isAllowlisted(abn: string, dest: any): Promise<boolean> {
    return this.rows.some((row) => {
      if (row.abn !== abn || row.rail !== dest.rail) return false;
      if (row.rail === "BPAY") {
        return row.reference === dest.reference && (!row.bpay_biller || row.bpay_biller === dest.bpay_biller);
      }
      return row.bsb === dest.bsb && row.acct === dest.acct;
    });
  }
}

describe("allowlist lookups", () => {
  beforeAll(() => {
    setAllowlistProvider(
      new MemoryProvider([
        { abn: "123", rail: "BPAY", reference: "12345678901", bpay_biller: "75556" },
        { abn: "123", rail: "EFT", bsb: "092009", acct: "12345678" }
      ])
    );
  });

  afterAll(() => setAllowlistProvider(null));

  test("allowlist ok for ATO BPAY", async () => {
    await expect(isAllowlisted("123", { bpay_biller: "75556", crn: "12345678901" })).resolves.toBe(true);
  });

  test("deny non-ATO", async () => {
    await expect(isAllowlisted("123", { bsb: "012-345", acct: "999999" })).resolves.toBe(false);
  });
});
