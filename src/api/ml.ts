import type { Request, Response } from "express";
import { Router } from "express";
import { v4 as uuidv4 } from "uuid";

import { evaluateMlFeature, type MlFeature } from "../config/mlFeatures";
import { mlAuditLog } from "../utils/mlAudit";

export const mlRouter = Router();

type MlHandlerContext = { requestId: string };
type MlHandler = (req: Request, res: Response, context: MlHandlerContext) => Promise<void> | void;

function getRequestId(req: Request): string {
  const header = req.headers["x-request-id"];
  if (Array.isArray(header)) {
    const value = header.find((item) => typeof item === "string" && item.trim());
    if (value) return value.trim();
  } else if (typeof header === "string" && header.trim()) {
    return header.trim();
  }
  return uuidv4();
}

function withMl(feature: MlFeature, handler: MlHandler) {
  return async (req: Request, res: Response) => {
    const requestId = getRequestId(req);
    res.setHeader("x-request-id", requestId);

    const evaluation = evaluateMlFeature(feature);
    if (!evaluation.enabled) {
      const reason = evaluation.reason ?? "disabled";
      mlAuditLog({ feature, requestId, status: "blocked", detail: { reason } });
      res.status(503).json({ error: "ML_FEATURE_DISABLED", feature, requestId, reason });
      return;
    }

    try {
      await handler(req, res, { requestId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      mlAuditLog({ feature, requestId, status: "error", detail: { message } });
      if (!res.headersSent) {
        res.status(500).json({ error: "ML_INTERNAL_ERROR", message, requestId });
      }
    }
  };
}

mlRouter.post(
  "/recon-scorer",
  withMl("recon_scorer", async (req, res, { requestId }) => {
    const { periodId, metrics = {} } = (req.body as any) ?? {};
    const anomalyScore = Number(metrics.anomalyScore ?? 0);
    const paygwVariance = Number(metrics.paygwVariance ?? 0);
    const gstVariance = Number(metrics.gstVariance ?? 0);
    const unmatchedTransactions = Number(metrics.unmatchedTransactions ?? 0);

    const varianceImpact = Math.min(1, Math.abs(paygwVariance + gstVariance) / 10000);
    const unmatchedImpact = Math.min(1, Math.abs(unmatchedTransactions) / 10);
    const rawScore = 1 - (anomalyScore * 0.5 + varianceImpact * 0.3 + unmatchedImpact * 0.2);
    const score = Math.max(0, Math.min(1, rawScore));
    const risk = score >= 0.75 ? "low" : score >= 0.45 ? "medium" : "high";

    const response = {
      requestId,
      feature: "recon_scorer" as const,
      periodId: periodId ?? null,
      score: Number(score.toFixed(3)),
      risk,
      explanation: [
        `Anomaly score ${anomalyScore.toFixed(2)}`,
        `Variance impact ${(varianceImpact * 100).toFixed(0)}%`,
        `Unmatched transactions ${unmatchedTransactions}`,
      ],
    };

    mlAuditLog({
      feature: "recon_scorer",
      requestId,
      status: "success",
      detail: { risk, score: response.score, unmatchedTransactions },
    });

    res.json(response);
  })
);

mlRouter.post(
  "/bank-matcher",
  withMl("bank_matcher", async (req, res, { requestId }) => {
    const body = (req.body as any) ?? {};
    const bankTransactions: any[] = Array.isArray(body.bankTransactions) ? body.bankTransactions : [];
    const ledgerEntries: any[] = Array.isArray(body.ledgerEntries) ? body.ledgerEntries : [];

    const matches: Array<{
      bankTransactionId: string | number;
      ledgerEntryId: string | number;
      confidence: number;
      amountDelta: number;
      description: string;
    }> = [];

    const maxMatches = Math.min(bankTransactions.length, ledgerEntries.length);
    for (let i = 0; i < maxMatches; i += 1) {
      const bankTx = bankTransactions[i] ?? {};
      const ledger = ledgerEntries[i] ?? {};
      const bankAmount = Number(bankTx.amount ?? 0);
      const ledgerAmount = Number(ledger.amount ?? 0);
      const amountDelta = Math.abs(bankAmount - ledgerAmount);
      const baseConfidence = Math.max(0, 1 - Math.min(1, amountDelta / Math.max(1, Math.abs(bankAmount))));
      const narrativeBonus = bankTx.description && ledger.description &&
        String(bankTx.description).toLowerCase().includes(String(ledger.description).toLowerCase())
        ? 0.1
        : 0;
      const confidence = Math.min(0.99, baseConfidence + narrativeBonus);

      matches.push({
        bankTransactionId: bankTx.id ?? bankTx.reference ?? `bank-${i}`,
        ledgerEntryId: ledger.id ?? ledger.reference ?? `ledger-${i}`,
        confidence: Number(confidence.toFixed(2)),
        amountDelta: Number(amountDelta.toFixed(2)),
        description: String(bankTx.description ?? ledger.description ?? ""),
      });
    }

    const unmatchedBank = bankTransactions
      .slice(maxMatches)
      .map((tx, idx) => ({ id: tx.id ?? tx.reference ?? `bank-unmatched-${idx}`, amount: tx.amount ?? null }));
    const unmatchedLedger = ledgerEntries
      .slice(maxMatches)
      .map((entry, idx) => ({ id: entry.id ?? entry.reference ?? `ledger-unmatched-${idx}`, amount: entry.amount ?? null }));

    const response = {
      requestId,
      feature: "bank_matcher" as const,
      matches,
      unmatchedBank,
      unmatchedLedger,
    };

    mlAuditLog({
      feature: "bank_matcher",
      requestId,
      status: "success",
      detail: {
        matches: matches.length,
        unmatchedBank: unmatchedBank.length,
        unmatchedLedger: unmatchedLedger.length,
      },
    });

    res.json(response);
  })
);

mlRouter.get(
  "/forecast",
  withMl("forecast", async (req, res, { requestId }) => {
    const monthsParam = Number.parseInt(String((req.query ?? {}).months ?? "3"), 10);
    const horizon = Number.isFinite(monthsParam) && monthsParam > 0 ? Math.min(monthsParam, 12) : 3;

    const baselineRevenue = 52000;
    const baselineExpenses = 34000;
    const forecast = Array.from({ length: horizon }, (_, idx) => {
      const monthDate = new Date();
      monthDate.setMonth(monthDate.getMonth() + idx + 1);
      const revenue = Math.round((baselineRevenue + idx * 1800) * 100) / 100;
      const expenses = Math.round((baselineExpenses + idx * 1200) * 100) / 100;
      const net = Math.round((revenue - expenses) * 100) / 100;
      return {
        month: monthDate.toLocaleDateString("en-AU", { month: "short", year: "numeric" }),
        revenue,
        expenses,
        net,
      };
    });

    mlAuditLog({
      feature: "forecast",
      requestId,
      status: "success",
      detail: {
        horizonMonths: horizon,
        projectedNet: forecast.reduce((sum, point) => sum + point.net, 0),
      },
    });

    res.json({ requestId, feature: "forecast" as const, horizonMonths: horizon, forecast });
  })
);

mlRouter.post(
  "/invoice-ner",
  withMl("invoice_ner", async (req, res, { requestId }) => {
    const text = typeof (req.body as any)?.text === "string" ? String((req.body as any).text) : "";

    if (!text.trim()) {
      const message = "Invoice text is required";
      mlAuditLog({ feature: "invoice_ner", requestId, status: "error", detail: { message } });
      res.status(400).json({ error: "TEXT_REQUIRED", message, requestId });
      return;
    }

    const abnMatch = text.match(/\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/);
    const totalMatch = text.match(/total(?:\s+due)?\s*[:$]*\s*([\d,.]+)/i);
    const gstMatch = text.match(/gst\s*[:$]*\s*([\d,.]+)/i);
    const dueMatch = text.match(/due(?:\s+date)?\s*[:\-]?\s*([0-9]{1,2} [A-Za-z]+ ?[0-9]{4}|[0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    const supplierMatch = text.match(/from[:\-]?\s*([A-Za-z0-9 &'\-]+)/i) ?? text.match(/supplier[:\-]?\s*([A-Za-z0-9 &'\-]+)/i);

    const entities = {
      supplier: supplierMatch ? supplierMatch[1].trim() : null,
      abn: abnMatch ? abnMatch[0].replace(/\s+/g, "") : null,
      total: totalMatch ? Number(totalMatch[1].replace(/,/g, "")) : null,
      gst: gstMatch ? Number(gstMatch[1].replace(/,/g, "")) : null,
      dueDate: dueMatch ? dueMatch[1].trim() : null,
    };

    const confidence = {
      supplier: entities.supplier ? 0.8 : 0.2,
      abn: entities.abn ? 0.95 : 0,
      total: entities.total != null ? 0.9 : 0,
      gst: entities.gst != null ? 0.7 : 0,
      dueDate: entities.dueDate ? 0.6 : 0.1,
    };

    const extractedFields = Object.entries(entities)
      .filter(([, value]) => value != null)
      .map(([key]) => key);

    mlAuditLog({
      feature: "invoice_ner",
      requestId,
      status: "success",
      detail: { fields: extractedFields },
    });

    res.json({ requestId, feature: "invoice_ner" as const, entities, confidence });
  })
);
