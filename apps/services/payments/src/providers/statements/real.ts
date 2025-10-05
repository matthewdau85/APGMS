import axios, { AxiosInstance } from "axios";
import { StatementsPort, StatementRecord } from "@core/ports";

function buildClient(): AxiosInstance {
  const baseURL = process.env.STATEMENTS_API_BASE;
  if (!baseURL) {
    throw new Error("STATEMENTS_API_BASE must be set to use the real statements provider");
  }
  return axios.create({ baseURL, timeout: Number(process.env.STATEMENTS_TIMEOUT_MS ?? "5000") });
}

class RealStatementsPort implements StatementsPort {
  private readonly client = buildClient();

  getCapabilities(): string[] {
    return ["real", "remote-statements"];
  }

  async fetchStatements(params: { abn: string; taxType: string; periodId: string }): Promise<StatementRecord[]> {
    const { data } = await this.client.get("/statements", { params });
    if (!data) return [];
    return Array.isArray(data) ? (data as StatementRecord[]) : [data as StatementRecord];
  }
}

export function createRealStatementsPort(): StatementsPort {
  return new RealStatementsPort();
}
