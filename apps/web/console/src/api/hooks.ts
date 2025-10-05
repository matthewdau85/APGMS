import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FeatureGate } from "../constants/featureGates";
import type { FeatureGateState } from "./schema";
import {
  getBasTotals,
  getFeatureGates,
  getPaymentsQueue,
  getReconciliationQueue,
  getRptEvidence,
  issueRpt,
  mapGatesByKey,
} from "./client";
import type { IssueRptPayload, IssueRptResponse } from "./client";

export const featureGatesQueryKey = ["feature-gates"] as const;
export const basTotalsQueryKey = ["bas-totals"] as const;
export const paymentsQueueQueryKey = ["payments-queue"] as const;
export const reconQueueQueryKey = ["recon-queue"] as const;
export const rptEvidenceQueryKey = ["rpt-evidence"] as const;

export function useFeatureGates() {
  return useQuery({
    queryKey: featureGatesQueryKey,
    queryFn: getFeatureGates,
  });
}

export function useBasTotals() {
  return useQuery({
    queryKey: basTotalsQueryKey,
    queryFn: getBasTotals,
  });
}

export function usePaymentsQueue() {
  return useQuery({
    queryKey: paymentsQueueQueryKey,
    queryFn: getPaymentsQueue,
  });
}

export function useReconQueue() {
  return useQuery({
    queryKey: reconQueueQueryKey,
    queryFn: getReconciliationQueue,
  });
}

export function useRptEvidence(enabled: boolean) {
  return useQuery({
    queryKey: rptEvidenceQueryKey,
    queryFn: getRptEvidence,
    enabled,
    staleTime: 0,
  });
}

export function useIssueRptMutation() {
  const client = useQueryClient();
  return useMutation<IssueRptResponse, Error, IssueRptPayload>({
    mutationKey: ["issue-rpt"],
    mutationFn: issueRpt,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: paymentsQueueQueryKey });
      void client.invalidateQueries({ queryKey: reconQueueQueryKey });
      void client.invalidateQueries({ queryKey: rptEvidenceQueryKey });
    },
  });
}

export function getGateState(
  gates: FeatureGateState[] | undefined,
  gate: FeatureGate,
  fallback = false
): boolean {
  if (!gates) return fallback;
  const map = mapGatesByKey(gates);
  return map[gate]?.enabled ?? fallback;
}
