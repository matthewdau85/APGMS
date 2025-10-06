import { Router } from "express";
import {
  FeedType,
  ingest,
  getFeedStatuses,
  getPeriods,
  getDlq,
  replayDlq,
  transitionGate,
  TransitionRequest,
} from "../recon/store";

const validFeeds: FeedType[] = ["payroll", "pos", "bank"];

export const ingestionApi = Router();

function asFeed(value: string | undefined): FeedType | null {
  if (!value) return null;
  return validFeeds.includes(value as FeedType) ? (value as FeedType) : null;
}

ingestionApi.post("/ingest/:feed", (req, res) => {
  const feed = asFeed(String(req.params.feed || ""));
  if (!feed) {
    return res.status(404).json({ error: "UNKNOWN_FEED" });
  }
  const result = ingest(feed, req.body || {});
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  return res.json({ ok: true, period: result.period, recon: result.recon });
});

ingestionApi.get("/ingest/status", (_req, res) => {
  res.json({
    feeds: getFeedStatuses(),
    periods: getPeriods(),
    dlq: { size: getDlq().length },
  });
});

ingestionApi.get("/dlq", (_req, res) => {
  res.json({ entries: getDlq() });
});

ingestionApi.post("/dlq/replay", (_req, res) => {
  const summary = replayDlq();
  res.json({ ok: true, summary });
});

ingestionApi.post("/gate/transition", (req, res) => {
  const body = req.body as TransitionRequest;
  if (!body?.abn || !body?.taxType || !body?.periodId || !body?.event) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }
  const result = transitionGate(body);
  if (!result.ok) {
    return res.status(404).json({ error: result.error });
  }
  res.json({ ok: true, period: result.period });
});
