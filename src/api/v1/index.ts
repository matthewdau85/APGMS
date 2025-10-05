import { Router } from "express";
import { router as settlementRouter } from "../../routes/settlement";

export const v1 = Router();

v1.use("/settlement", settlementRouter);

export default v1;
