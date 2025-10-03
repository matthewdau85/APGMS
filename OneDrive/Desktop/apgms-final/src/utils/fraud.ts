export function detectFraud(transactions: Array<{ amount: number; type: string }>): boolean {
  return transactions.some(tx => tx.amount > 100000);
}

export {};
