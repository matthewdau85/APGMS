const flag = (value: string | undefined) => {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export const FEATURES = {
  DRY_RUN: flag(process.env.FEATURE_DRY_RUN),
  BANKING: flag(process.env.FEATURE_BANKING),
  STP: flag(process.env.FEATURE_STP),
  ATO_TABLES: flag(process.env.FEATURE_ATO_TABLES),
};
