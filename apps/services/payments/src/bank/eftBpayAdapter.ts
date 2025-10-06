import { bpay, eft, type EftBpayRequest, type EftBpayResult } from "./adapters";

type Params = EftBpayRequest;

type Result = EftBpayResult;

const isBpayDestination = (destination: Params["destination"]) =>
  Boolean(destination.bpay_biller || destination.crn);

export async function sendEftOrBpay(p: Params): Promise<Result> {
  if (isBpayDestination(p.destination)) {
    return bpay(p);
  }
  return eft(p);
}
