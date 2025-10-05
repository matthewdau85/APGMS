import type { RequestHandler } from "express";

export type ValidationIssue = {
  path: (string | number)[];
  message: string;
  code: string;
};

export interface Schema<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: ValidationIssue[] } };
}

export type RequestLocation = "body" | "query" | "params";

export function validate<T>(schema: Schema<T>, location: RequestLocation = "body"): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse((req as any)[location]);
    if (!result.success) {
      return res.status(400).json({ error: "INVALID_REQUEST", issues: result.error.issues });
    }
    (req as any)[location] = result.data;
    return next();
  };
}
