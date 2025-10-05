import http from "http";

const PORT = Number(process.env.PORT || 8080);

function call(method: string, path: string, body?: any) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port: PORT,
        path,
        method,
        headers: {
          "content-type": "application/json",
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString() || "{}";
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            resolve({ status: res.statusCode });
          }
        });
      }
    );

    request.on("error", reject);

    if (payload) {
      request.write(payload);
    }

    request.end();
  });
}

(async () => {
  const abn = "11122233344";
  const periodId = 1;

  await call("POST", "/api/payments/deposit", {
    abn,
    amount: 100,
    idempotencyKey: "smoke-1",
    period_id: periodId,
  });

  const close = await call("POST", "/api/v1/reconcile/close-and-issue", {
    abn,
    period_id: periodId,
  });

  const evidence = await call("GET", `/api/v1/evidence/${abn}/${periodId}`);

  console.log({ close, evidence });
})();
