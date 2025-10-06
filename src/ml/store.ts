import crypto from "crypto";
import { InvoiceLineSuggestion } from "./types";

interface StoredFeature {
  docHash: string;
  lineHash: string;
  gstRateSuggested: number | null;
  hasAmount: boolean;
}

const featureStore: StoredFeature[] = [];

export function persistDerivedFeatures(docId: string, suggestions: InvoiceLineSuggestion[]): void {
  const docHash = hash(docId);
  for (const suggestion of suggestions) {
    featureStore.push({
      docHash,
      lineHash: hash(suggestion.desc),
      gstRateSuggested: suggestion.gstRateSuggested,
      hasAmount: suggestion.amount !== null,
    });
  }
}

export function getFeatureStoreSnapshot(): StoredFeature[] {
  return [...featureStore];
}

function hash(value: string | null | undefined): string {
  return crypto.createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}
