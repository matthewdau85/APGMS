import express from "express";
import { api } from "../api";

const app = express();

app.use(express.json());
app.use("/api", api);

const port = Number(process.env.PORT || 8080);
app.listen(port, () => console.log(`server listening on ${port}`));
