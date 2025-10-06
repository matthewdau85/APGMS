import type { Request, Response } from "express";
import { pool } from "../index.js";

/**
 * @openapi
 * {
 *   "paths": {
 *     "/balance": {
 *       "get": {
 *         "summary": "Retrieve the OWA ledger balance for a BAS period",
 *         "description": "Returns the aggregated balance for the specified ABN, tax type and period from the OWA ledger.",
 *         "parameters": [
 *           {
 *             "in": "query",
 *             "name": "abn",
 *             "required": true,
 *             "schema": { "type": "string" },
 *             "description": "Australian Business Number identifying the entity"
 *           },
 *           {
 *             "in": "query",
 *             "name": "taxType",
 *             "required": true,
 *             "schema": { "type": "string", "enum": ["GST", "PAYGW"] },
 *             "description": "Tax type for the BAS period"
 *           },
 *           {
 *             "in": "query",
 *             "name": "periodId",
 *             "required": true,
 *             "schema": { "type": "string" },
 *             "description": "BAS period identifier (e.g. 2025-09)"
 *           }
 *         ],
 *         "responses": {
 *           "200": {
 *             "description": "Balance information",
 *             "content": {
 *               "application/json": {
 *                 "schema": { "$ref": "#/components/schemas/BalanceResponse" }
 *               }
 *             }
 *           },
 *           "400": {
 *             "description": "Missing or invalid query parameters",
 *             "content": {
 *               "application/json": {
 *                 "schema": { "$ref": "#/components/schemas/ErrorResponse" }
 *               }
 *             }
 *           },
 *           "500": {
 *             "description": "Unexpected failure whilst computing the balance",
 *             "content": {
 *               "application/json": {
 *                 "schema": { "$ref": "#/components/schemas/ErrorResponse" }
 *               }
 *             }
 *           }
 *         }
 *       }
 *     }
 *   },
 *   "components": {
 *     "schemas": {
 *       "BalanceResponse": {
 *         "type": "object",
 *         "required": ["abn", "taxType", "periodId", "balance_cents", "has_release"],
 *         "properties": {
 *           "abn": { "type": "string" },
 *           "taxType": { "type": "string" },
 *           "periodId": { "type": "string" },
 *           "balance_cents": { "type": "integer" },
 *           "has_release": { "type": "boolean" }
 *         }
 *       },
 *       "ErrorResponse": {
 *         "type": "object",
 *         "required": ["error"],
 *         "properties": {
 *           "error": { "type": "string" },
 *           "detail": { "type": "string" }
 *         }
 *       }
 *     }
 *   }
 * }
 */
export async function balance(req: Request, res: Response) {
  try {
    const { abn, taxType, periodId } = req.query as Record<string, string>;
    if (!abn || !taxType || !periodId) {
      return res.status(400).json({ error: "Missing abn/taxType/periodId" });
    }

    const q = `
      SELECT
        COALESCE(SUM(amount_cents), 0)::bigint AS balance_cents,
        BOOL_OR(amount_cents < 0) AS has_release
      FROM owa_ledger
      WHERE abn=$1 AND tax_type=$2 AND period_id=$3
    `;
    const { rows } = await pool.query(q, [abn, taxType, periodId]);
    const row = rows[0] || { balance_cents: 0, has_release: false };

    res.json({
      abn, taxType, periodId,
      balance_cents: Number(row.balance_cents),
      has_release: !!row.has_release
    });
  } catch (e: any) {
    res.status(500).json({ error: "balance query failed", detail: String(e?.message || e) });
  }
}
