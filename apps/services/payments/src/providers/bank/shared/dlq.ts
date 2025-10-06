import { promises as fs } from "node:fs";
import path from "node:path";

export class DeadLetterQueue<T = unknown> {
  private readonly dir: string;
  private readonly prefix: string;

  constructor(options?: { directory?: string; prefix?: string }) {
    this.dir = options?.directory ?? path.resolve(process.cwd(), "var/bank-egress-dlq");
    this.prefix = options?.prefix ?? "bank-egress";
  }

  async push(event: T & { error?: string; ts?: string }): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(this.dir, `${this.prefix}-${stamp}.json`);
    const payload = { ...event, ts: event?.ts ?? new Date().toISOString() };
    await fs.writeFile(file, JSON.stringify(payload, null, 2), "utf8");
  }
}
