export const providers = [
  "bank",
  "kms",
  "rates",
  "idp",
  "statements",
  "anomaly",
] as const;

export type ProviderName = typeof providers[number];
