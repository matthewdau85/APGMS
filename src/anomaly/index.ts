import { mockAnomalyPort } from "./mock";
import { RealAnomalyPort } from "./real";
import { AnomalyPort } from "./port";

const implementation = (process.env.ANOMALY_PORT_IMPL || "mock").toLowerCase();

let selectedPort: AnomalyPort;

switch (implementation) {
  case "real":
    selectedPort = new RealAnomalyPort();
    break;
  case "mock":
    selectedPort = mockAnomalyPort;
    break;
  default:
    selectedPort = mockAnomalyPort;
}

export const anomalyPort: AnomalyPort = selectedPort;

export { MockAnomalyPort, mockAnomalyPort } from "./mock";
export { RealAnomalyPort } from "./real";
export * from "./port";
