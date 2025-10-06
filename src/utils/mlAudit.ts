import type { MlFeature } from "../config/mlFeatures";

type MlAuditStatus = "success" | "error" | "blocked";

interface MlAuditPayload {
  feature: MlFeature;
  requestId: string;
  status: MlAuditStatus;
  detail?: Record<string, unknown> | string;
}

export function mlAuditLog(payload: MlAuditPayload): void {
  const { feature, requestId, status, detail } = payload;
  const base = `[ml] request_id=${requestId} feature=${feature} status=${status}`;
  if (detail == null) {
    console.info(base);
    return;
  }

  if (typeof detail === "string") {
    console.info(`${base} detail=${detail}`);
    return;
  }

  try {
    const meta = JSON.stringify(detail);
    console.info(`${base} detail=${meta}`);
  } catch (err) {
    console.info(base, detail, err);
  }
}
