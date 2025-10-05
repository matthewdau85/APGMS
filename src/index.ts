// src/index.ts
// Import the Express web framework so we can create an HTTP server instance.
import express from "express";
// Import dotenv to populate process.env from the .env file at startup.
import dotenv from "dotenv";
// ---
// Bring in the idempotency middleware that guards against duplicate POSTs.
import { idempotency } from "./middleware/idempotency";
// Import all of the reconciliation route handlers for the explicit API endpoints.
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
// Import the payments API router and note it must be mounted before the generic API router.
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
// Import the existing API router that contains the rest of the application endpoints.
import { api } from "./api";                  // your existing API router(s)
// ---
// Initialize dotenv immediately so that environment variables are ready for the rest of the file.
dotenv.config();
// ---
// Create a new Express application instance that will process incoming HTTP requests.
const app = express();
// Register JSON body parsing middleware with a 2 MB limit to keep payload sizes reasonable.
app.use(express.json({ limit: "2mb" }));
// ---
// Register a minimal logger middleware to print each request method and path for debugging.
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });
// ---
// Define a quick health check endpoint that reports service readiness.
app.get("/health", (_req, res) => res.json({ ok: true }));
// ---
// Mount individual endpoints that exist outside of the router objects for historical reasons.
app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
app.get("/api/evidence", evidence);
// ---
// Mount the payments API router first so its specific routes win before the generic router below.
app.use("/api", paymentsApi);
// ---
// Mount the general API router afterwards to catch the remaining endpoints.
app.use("/api", api);
// ---
// Add a final 404 handler so unmatched requests return a not-found response instead of hanging.
app.use((_req, res) => res.status(404).send("Not found"));
// ---
// Read the listening port from the environment (defaulting to 3000) and start the server.
const port = Number(process.env.PORT) || 3000;
// Begin listening and log the port to the console for visibility.
app.listen(port, () => console.log("APGMS server listening on", port));
