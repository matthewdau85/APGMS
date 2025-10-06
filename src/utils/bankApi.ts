import { withApiErrorToast } from "./apiClient";

export const submitSTPReport = withApiErrorToast("STP submission", async (data: any) => {
  console.log("Submitting STP report to ATO:", data);
  return true;
});

export const signTransaction = withApiErrorToast(
  "Transaction signing",
  async (amount: number, account: string) => `SIGNED-${amount}-${account}-${Date.now()}`
);

export const transferToOneWayAccount = withApiErrorToast(
  "One-way transfer",
  async (amount: number, from: string, to: string) => {
    const signature = await signTransaction(amount, to);
    console.log(`Transfer $${amount} from ${from} to ${to} [${signature}]`);
    return true;
  }
);

export const verifyFunds = withApiErrorToast("Fund verification", async (_paygwDue: number, _gstDue: number) => {
  // For mock: always return true
  return true;
});

export const initiateTransfer = withApiErrorToast("ATO transfer", async (_paygwDue: number, _gstDue: number) => {
  // For mock: always return true
  return true;
});
