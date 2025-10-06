import { Request, Response } from "express";

let currentMode = process.env.APP_MODE || "test";
const allowList = new Set<string>((process.env.CORS_ALLOW_LIST || "").split(",").map((v) => v.trim()).filter(Boolean));

export function toggleMode(req: Request, res: Response) {
  const { mode } = req.body as { mode?: string };
  if (!mode || !["test", "real"].includes(mode)) {
    return res.status(400).json({ error: "INVALID_MODE" });
  }
  currentMode = mode;
  process.env.APP_MODE = mode;
  return res.json({ mode: currentMode });
}

export function updateAllowList(req: Request, res: Response) {
  const { origin, action } = req.body as { origin?: string; action?: "add" | "remove" };
  if (!origin) {
    return res.status(400).json({ error: "MISSING_ORIGIN" });
  }
  if (action === "remove") {
    allowList.delete(origin);
  } else {
    allowList.add(origin);
  }
  process.env.CORS_ALLOW_LIST = Array.from(allowList).join(",");
  return res.json({ allow_list: Array.from(allowList).sort() });
}

export function getMode() {
  return currentMode;
}
