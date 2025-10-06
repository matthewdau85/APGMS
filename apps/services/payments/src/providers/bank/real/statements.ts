import { watch, FSWatcher } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BankStatementBatch, BankStatementsPort, StatementIngestPayload } from "../port.js";
import { parseFile, parseStatementPayload } from "../shared/statements.js";

export class RealBankStatements implements BankStatementsPort {
  private handlers: Array<(batch: BankStatementBatch) => Promise<void> | void> = [];
  private watcher?: FSWatcher;
  private started = false;
  private readonly dir: string;

  constructor(directory?: string) {
    this.dir = directory ?? process.env.BANK_STATEMENTS_DIR ?? path.resolve(process.cwd(), "var/bank-statements");
  }

  register(handler: (batch: BankStatementBatch) => Promise<void> | void): void {
    this.handlers.push(handler);
  }

  async start(): Promise<void> {
    if (this.started) return;
    await fs.mkdir(this.dir, { recursive: true });
    this.watcher = watch(this.dir, async (_event, filename) => {
      if (!filename) return;
      const filePath = path.join(this.dir, filename);
      try {
        const batch = await parseFile("direct-entry", filePath);
        await this.emit(batch);
      } catch (error) {
        console.error("[bank] failed to parse statement", filePath, error);
      }
    });
    this.started = true;
  }

  async stop(): Promise<void> {
    this.started = false;
    await new Promise<void>(resolve => {
      if (!this.watcher) return resolve();
      this.watcher.close();
      this.watcher = undefined;
      resolve();
    });
  }

  async ingestHttp(payload: StatementIngestPayload): Promise<void> {
    const batch = await parseStatementPayload("direct-entry", "http", payload);
    await this.emit(batch);
  }

  private async emit(batch: BankStatementBatch) {
    for (const handler of this.handlers) {
      await handler(batch);
    }
  }
}
