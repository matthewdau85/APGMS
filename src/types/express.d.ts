declare namespace Express {
  interface Locals {
    requestId?: string;
    simulated?: boolean;
    railsConsent?: import("../consent/service").ConsentAcceptance | null;
  }
}
