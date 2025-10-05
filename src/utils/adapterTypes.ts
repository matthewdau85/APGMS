import { AdapterMode, AdapterName } from "../simulator/types";

export type AdapterLogger = (
  adapter: AdapterName,
  mode: AdapterMode,
  payload: unknown,
  result: { response?: unknown; error?: string }
) => void;

export interface AdapterCallOptions {
  mode: AdapterMode;
  log: AdapterLogger;
}
