import http from "http";
function req(method:string, path:string, body?:any): Promise<any> {
  return new Promise((resolve,reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : undefined;
    const r = http.request({ hostname: "127.0.0.1", port: Number(process.env.PORT||8080), path, method, headers: { "content-type":"application/json", "authorization": `Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzbW9rZSIsInJvbGVzIjpbImFjY291bnRhbnQiLCJhdWRpdG9yIl19._dev` }}, (res) => {
      const chunks: Buffer[] = []; res.on("data", d => chunks.push(d)); res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString()||"{}")); } catch { resolve({ status: res.statusCode }); }
      });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
(async () => {
  const abn = "11122233344"; const pid = Number(process.argv[2] || 1);
  console.log("deposit"); await req("POST","/api/v1/deposit",{ abn, amount: 10000, idempotencyKey: "smoke-1", period_id: pid });
  console.log("close-and-issue"); const res = await req("POST","/api/v1/reconcile/close-and-issue",{ abn, period_id: pid }); console.log(res);
  console.log("evidence"); const ev = await req("GET",`/api/v1/evidence/${abn}/${pid}`); console.log(ev);
})();
