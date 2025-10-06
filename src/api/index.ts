import { Router } from "express";

export const api = Router();

api.use((_req, res, next) => next());
