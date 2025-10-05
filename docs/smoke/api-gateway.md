# API Gateway Smoke Plan

This checklist exercises the Express gateway to make sure the legacy routes
still load without runtime import failures after refactoring.

1. `pnpm install` (first run only) and `pnpm dev` from the repository root.
2. In another terminal run the following requests. Each command should respond
   with a structured JSON error (400/422 is fine) rather than crashing, which
   confirms the handler and its imports resolved correctly.

   ```bash
   curl -i http://localhost:3000/api/pay -X POST -H 'content-type: application/json' -d '{}'
   curl -i http://localhost:3000/api/close-issue -X POST -H 'content-type: application/json' -d '{}'
   curl -i http://localhost:3000/api/payto/sweep -X POST -H 'content-type: application/json' -d '{}'
   curl -i http://localhost:3000/api/settlement/webhook -X POST -H 'content-type: application/json' -d '{"csv":""}'
   curl -i "http://localhost:3000/api/evidence?abn=123&taxType=GST&periodId=2024-Q1"
   ```
3. Stop the dev server with `Ctrl+C`.

If any command returns a 500 or stack trace, investigate the handler imports
and ensure they are exported from `src/api/index.ts` and its dependencies.
