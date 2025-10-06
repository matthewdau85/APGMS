const env = (globalThis as any)?.process?.env ?? {};

export const DEFAULT_ABN = env.REACT_APP_APGMS_ABN ?? "53004085616";
export const DEFAULT_TAX_TYPE = env.REACT_APP_APGMS_TAX_TYPE ?? "PAYG";
export const DEFAULT_PERIOD_ID = env.REACT_APP_APGMS_PERIOD_ID ?? "2024Q4";
