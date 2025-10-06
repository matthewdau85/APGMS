import { providerRegistry } from "@core/providerRegistry";
import { BankRail } from "@core/ports";

export async function resolveDestination(abn: string, rail: BankRail, reference: string) {
  const provider = providerRegistry.get("bank");
  return provider.resolveDestination(abn, rail, reference);
}

export async function releasePayment(
  abn: string,
  taxType: string,
  periodId: string,
  amountCents: number,
  rail: BankRail,
  reference: string
) {
  const provider = providerRegistry.get("bank");
  return provider.releasePayment(abn, taxType, periodId, amountCents, rail, reference);
}
