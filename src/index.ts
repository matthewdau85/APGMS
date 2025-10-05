﻿// src/index.ts
import dotenv from "dotenv";
import { createApp } from "./app";

dotenv.config();

const app = createApp();

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
