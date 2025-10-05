import { Router } from "express";
import { evidence } from "./reconcile";

export const router = Router();
router.get("/", evidence);
