import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export class Recorder<T extends object> {
  constructor(private inner: T) {}

  private cassettePath(method: string, payload: unknown) {
    const hash = crypto
      .createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex")
      .slice(0, 24);
    return path.join(".sim", "cassettes", method, `${hash}.json`);
  }

  private async call(method: string, payload: unknown, fn: Function | undefined) {
    if (typeof fn !== "function") {
      throw new Error(`Recorder inner missing method: ${method}`);
    }

    const cassette = this.cassettePath(method, payload);

    if (process.env.SIM_REPLAY === "true" && fs.existsSync(cassette)) {
      const contents = fs.readFileSync(cassette, "utf8");
      return JSON.parse(contents);
    }

    const result = await fn.call(this.inner, payload);

    if (process.env.SIM_RECORD === "true") {
      fs.mkdirSync(path.dirname(cassette), { recursive: true });
      fs.writeFileSync(cassette, JSON.stringify(result, null, 2));
    }

    return result;
  }

  eft(payload: unknown) {
    return this.call("eft", payload, (this.inner as any).eft);
  }

  bpay(payload: unknown) {
    return this.call("bpay", payload, (this.inner as any).bpay);
  }

  payToSweep(payload: unknown) {
    return this.call("payToSweep", payload, (this.inner as any).payToSweep);
  }
}
