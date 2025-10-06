import axios, { AxiosInstance } from "axios";
import { AnomalyPort, AnomalyScore } from "@core/ports";

function buildClient(): AxiosInstance {
  const baseURL = process.env.ANOMALY_API_BASE;
  if (!baseURL) {
    throw new Error("ANOMALY_API_BASE must be set to use the real anomaly provider");
  }
  return axios.create({ baseURL, timeout: Number(process.env.ANOMALY_TIMEOUT_MS ?? "5000") });
}

class RealAnomalyPort implements AnomalyPort {
  private readonly client = buildClient();

  getCapabilities(): string[] {
    return ["real", "remote-anomaly"];
  }

  async score(params: { abn: string; taxType: string; periodId: string; ledgerHash?: string }): Promise<AnomalyScore> {
    const { data } = await this.client.post("/anomaly/score", params);
    return data as AnomalyScore;
  }
}

export function createRealAnomalyPort(): AnomalyPort {
  return new RealAnomalyPort();
}
