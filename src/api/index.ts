import { Router } from "express";
import { v1 } from "./v1";
import { v2 } from "./v2";
import { FEATURES } from "../config/features";
export const api = Router();
api.use("/v1", v1);
if (FEATURES.API_V2) api.use("/v2", v2);
