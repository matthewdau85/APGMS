import type { PayToPort } from "@core/ports/types/payto";
import { createMockPayTo } from "./mock";
import { createRealPayTo } from "./real";

export function createShadowPayTo(): PayToPort {
  const real = createRealPayTo();
  const mock = createMockPayTo();

  return {
    async createMandate(input) {
      const [realRes, mockRes] = await Promise.all([
        real.createMandate(input),
        mock.createMandate(input),
      ]);
      if (realRes.ok !== mockRes.ok) {
        console.warn("[payto-shadow] createMandate divergence", { realRes, mockRes });
      }
      return realRes;
    },
    async verifyMandate(id) {
      const [realRes, mockRes] = await Promise.all([
        real.verifyMandate(id),
        mock.verifyMandate(id),
      ]);
      if (realRes.ok !== mockRes.ok) {
        console.warn("[payto-shadow] verifyMandate divergence", { realRes, mockRes });
      }
      return realRes;
    },
    async debitMandate(id, amountCents, metadata) {
      const [realRes, mockRes] = await Promise.all([
        real.debitMandate(id, amountCents, metadata),
        mock.debitMandate(id, amountCents, metadata),
      ]);
      if (realRes.ok !== mockRes.ok) {
        console.warn("[payto-shadow] debitMandate divergence", { realRes, mockRes });
      }
      return realRes;
    },
    async cancelMandate(id) {
      const [realRes, mockRes] = await Promise.all([
        real.cancelMandate(id),
        mock.cancelMandate(id),
      ]);
      if (realRes.ok !== mockRes.ok) {
        console.warn("[payto-shadow] cancelMandate divergence", { realRes, mockRes });
      }
      return realRes;
    },
  } satisfies PayToPort;
}
