import { Router } from "express";

import { getMlFeatureStatus } from "../config/mlFeatures";
import { mlRouter } from "./ml";

export const api = Router();

api.get("/features", (_req, res) => {
  res.json(getMlFeatureStatus());
});

api.use("/ml", mlRouter);
