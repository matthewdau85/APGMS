import { issueRpt as issueRptService, IssueRptArgs } from "../services/rptService";

export async function issueRPT(
  abn: string,
  taxType: "PAYGW" | "GST",
  periodId: string,
  thresholds: Record<string, number>,
) {
  const args: IssueRptArgs = { abn, taxType, periodId, thresholds };
  return issueRptService(args);
}

