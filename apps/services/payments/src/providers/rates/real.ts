import axios, { AxiosInstance } from "axios";
import { RatesPort, RateQuote } from "@core/ports";

function buildClient(): AxiosInstance {
  const baseURL = process.env.RATES_API_BASE;
  if (!baseURL) {
    throw new Error("RATES_API_BASE must be set to use the real rates provider");
  }
  return axios.create({ baseURL, timeout: Number(process.env.RATES_TIMEOUT_MS ?? "3000") });
}

class RealRatesPort implements RatesPort {
  private readonly client: AxiosInstance = buildClient();

  getCapabilities(): string[] {
    return ["real", "remote-rates"];
  }

  async quote(params: { taxType: string; periodId: string; abn?: string }): Promise<RateQuote | null> {
    const { data } = await this.client.get("/rates", { params });
    if (!data) return null;
    return data as RateQuote;
  }

  async list(taxType: string): Promise<RateQuote[]> {
    const { data } = await this.client.get("/rates", { params: { taxType } });
    return Array.isArray(data) ? (data as RateQuote[]) : [];
  }
}

export function createRealRatesPort(): RatesPort {
  return new RealRatesPort();
}
