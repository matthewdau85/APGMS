import swaggerUi from "swagger-ui-express";
import { Router } from "express";

export const openapiDoc = {
  openapi: "3.0.0",
  info: { title: "APGMS API", version: "1.0.0" },
  paths: {
    "/api/balance/{abn}": {
      get: {
        parameters: [
          { name: "abn", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" } }
      }
    },
    "/api/reconcile/close-and-issue": {
      post: {
        requestBody: { required: true },
        responses: { "200": { description: "OK" } }
      }
    }
  }
} as const;

export function mountOpenapi(router: Router) {
  router.use("/docs", swaggerUi.serve, swaggerUi.setup(openapiDoc as any));
}
