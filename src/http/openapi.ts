import swaggerUi from "swagger-ui-express";
import { Router } from "express";

export const spec = {
  openapi: "3.0.0",
  info: { title: "APGMS", version: "1.0.0" },
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
    },
    "/api/evidence/{abn}/{pid}": {
      get: {
        parameters: [
          { name: "abn", in: "path", required: true, schema: { type: "string" } },
          { name: "pid", in: "path", required: true, schema: { type: "string" } }
        ],
        responses: { "200": { description: "OK" } }
      }
    }
  }
};

export function mountDocs(app: Router) {
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(spec as any));
}
