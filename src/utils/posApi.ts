import { withApiErrorToast } from "./apiClient";

export interface PosSyncResult {
  transactionsSynced: number;
  lastSync: string;
}

export const syncPosTransactions = withApiErrorToast(
  "POS sync",
  async (): Promise<PosSyncResult> => ({
    transactionsSynced: 0,
    lastSync: new Date().toISOString(),
  })
);
