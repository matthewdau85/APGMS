export const api = {
  balance: (abn: string) => fetch(`/api/v1/balance/${abn}`).then((r) => r.json()),
  gate: (abn: string, pid: number | string) =>
    fetch(`/gate/status?abn=${abn}&period_id=${pid}`).then((r) => r.json()),
  evidence: (abn: string, pid: number | string) =>
    fetch(`/api/v1/evidence/${abn}/${pid}`).then((r) => r.json()),
  anomalies: (abn: string, pid: number | string) =>
    fetch(`/api/v1/queues/anomalies/${abn}/${pid}`).then((r) => r.json()),
};
