// src/api/payments.ts
// Import Express so we can create a router dedicated to payments endpoints.
import express from "express";
// Import the Payments client abstraction that performs the underlying service calls.
import { Payments } from "../../libs/paymentsClient"; // adjust if your libs path differs
// ---
// Create a new router instance that will hold every payments-related route handler.
export const paymentsApi = express.Router();
// ---
// Document the handler for GET /api/balance which expects abn, taxType, and periodId query parameters.
paymentsApi.get("/balance", async (req, res) => {
  // Wrap the logic in a try/catch so we can return a helpful error payload.
  try {
    // Pull the expected query parameters from the request.
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    // Validate that all required query parameters were provided by the caller.
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    // Ask the Payments client for the balance data using the validated parameters.
    const data = await Payments.balance({ abn, taxType, periodId });
    // Return the result payload directly to the caller.
    res.json(data);
  } catch (err: any) {
    // If anything fails, convert the error into a 500 response with a human-readable message.
    res.status(500).json({ error: err?.message || "Balance failed" });
  }
  // Close out the GET /balance handler registration.
});
// ---
// Document the handler for GET /api/ledger which mirrors the balance endpoint.
paymentsApi.get("/ledger", async (req, res) => {
  // Use a try/catch so that runtime errors are captured and surfaced correctly.
  try {
    // Extract the expected query parameters from the request.
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    // Guard against missing inputs to keep downstream calls safe.
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }
    // Call into the Payments client to retrieve the ledger entries.
    const data = await Payments.ledger({ abn, taxType, periodId });
    // Respond with the ledger data as JSON.
    res.json(data);
  } catch (err: any) {
    // Convert thrown errors into a 500 response so the caller knows the request failed internally.
    res.status(500).json({ error: err?.message || "Ledger failed" });
  }
  // Close out the GET /ledger handler registration.
});
// ---
// Document the handler for POST /api/deposit which records a deposit against an account.
paymentsApi.post("/deposit", async (req, res) => {
  // Capture runtime failures so we can provide a structured error response.
  try {
    // Read the expected fields from the request body.
    const { abn, taxType, periodId, amountCents } = req.body || {};
    // Validate the presence of each required field and ensure amountCents is numeric.
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    // Enforce that deposits must be positive to avoid confusing downstream services.
    if (amountCents <= 0) {
      return res.status(400).json({ error: "Deposit must be positive" });
    }
    // Delegate to the Payments client to perform the deposit operation.
    const data = await Payments.deposit({ abn, taxType, periodId, amountCents });
    // Reply with the successful deposit details.
    res.json(data);
  } catch (err: any) {
    // Map thrown errors to a 400 response to reflect validation or business rule failures.
    res.status(400).json({ error: err?.message || "Deposit failed" });
  }
  // Close out the POST /deposit handler registration.
});
// ---
// Document the handler for POST /api/release which releases funds by calling payAto.
paymentsApi.post("/release", async (req, res) => {
  // Try the body parsing and service call so we can gracefully handle issues.
  try {
    // Pull the required fields from the request body payload.
    const { abn, taxType, periodId, amountCents } = req.body || {};
    // Validate each field and ensure we received a numeric amount.
    if (!abn || !taxType || !periodId || typeof amountCents !== "number") {
      return res.status(400).json({ error: "Missing fields" });
    }
    // Releases should reduce funds, so the amount must be negative.
    if (amountCents >= 0) {
      return res.status(400).json({ error: "Release must be negative" });
    }
    // Call the Payments client to trigger the payAto workflow with the provided values.
    const data = await Payments.payAto({ abn, taxType, periodId, amountCents });
    // Send the successful release response back to the caller.
    res.json(data);
  } catch (err: any) {
    // Translate unexpected errors into a 400 response that communicates the failure.
    res.status(400).json({ error: err?.message || "Release failed" });
  }
  // Close out the POST /release handler registration.
});
