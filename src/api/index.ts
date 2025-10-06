// src/api/index.ts
import { Router } from "express";

import { paymentsApi } from "./payments";

export const api = Router();

api.use("/payments", paymentsApi);

export { paymentsApi } from "./payments";
