import { InvoiceLineSuggestion, OcrLine } from "./types";

interface CategoryRule {
  label: "taxable" | "exempt";
  rate: number;
  keywords: string[];
  confidence: number;
  rationale: string;
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    label: "exempt",
    rate: 0,
    keywords: ["water", "fresh fruit", "bread", "basic food", "medical", "rent"],
    confidence: 0.9,
    rationale: "Matches GST-exempt essentials keyword",
  },
  {
    label: "taxable",
    rate: 0.1,
    keywords: ["service", "consulting", "labour", "maintenance", "subscription"],
    confidence: 0.75,
    rationale: "Professional services attract 10% GST",
  },
  {
    label: "taxable",
    rate: 0.1,
    keywords: ["alcohol", "beer", "wine", "spirits"],
    confidence: 0.85,
    rationale: "Alcoholic beverages GST at standard rate",
  },
  {
    label: "taxable",
    rate: 0.1,
    keywords: ["software", "saas", "licence", "license"],
    confidence: 0.8,
    rationale: "Digital products taxed at 10%",
  },
];

const DEFAULT_RATE = 0.1;
const DEFAULT_CONFIDENCE = 0.5;

export function inferSuggestions(lines: OcrLine[]): InvoiceLineSuggestion[] {
  return lines.map((line) => {
    const { amount, normalized } = extractAmount(line.text);
    const keywordMatch = matchRule(normalized);

    if (keywordMatch) {
      return {
        desc: normalized,
        amount,
        gstRateSuggested: keywordMatch.rule.rate,
        confidence: Math.min(1, (line.confidence + keywordMatch.rule.confidence) / 2),
        rationale: keywordMatch.rule.rationale,
      };
    }

    return {
      desc: normalized,
      amount,
      gstRateSuggested: amount === null ? null : DEFAULT_RATE,
      confidence: Math.min(1, (line.confidence + DEFAULT_CONFIDENCE) / 2),
      rationale: amount === null ? "Insufficient transactional detail" : "Default GST rate applied",
    };
  });
}

function matchRule(text: string): { rule: CategoryRule } | null {
  const lower = text.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw))) {
      return { rule };
    }
  }
  return null;
}

function extractAmount(text: string): { amount: number | null; normalized: string } {
  const match = text.match(/(-?\d+[\d,]*(?:\.\d{1,2})?)/);
  if (!match) {
    return { amount: null, normalized: text.trim() };
  }
  const amountStr = match[0].replace(/,/g, "");
  const amount = Number.parseFloat(amountStr);
  const normalized = text.replace(match[0], "").replace(/\s+/g, " ").trim();
  return { amount: Number.isFinite(amount) ? amount : null, normalized: normalized || text.trim() };
}
