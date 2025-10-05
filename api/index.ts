// server/index.ts
import express from "express";
import bodyParser from "body-parser";
import { router as paymentsApi } from "./api/payments";

const app = express();
app.use(bodyParser.json());
app.use("/api/payments", paymentsApi);

app.listen(8080, () => console.log("App on http://localhost:8080"));
