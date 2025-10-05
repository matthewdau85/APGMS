import { AnyZodObject, ZodError } from "zod";
import { Request, Response, NextFunction } from "express";

export function validate(s: {
  body?: AnyZodObject;
  params?: AnyZodObject;
  query?: AnyZodObject;
}) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      if (s.body) req.body = s.body.parse(req.body);
      if (s.params) req.params = s.params.parse(req.params);
      if (s.query) req.query = s.query.parse(req.query);
      next();
    } catch (e) {
      const ze = e as ZodError;
      res
        .status(400)
        .json({ error: "validation_failed", issues: ze.issues });
    }
  };
}
