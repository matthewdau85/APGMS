import fs from "fs";
import path from "path";
import { StatementLine, StatementsProvider, StatementsProviderError } from "@core/ports";

export interface LocalStatementsProviderOptions {
  directory?: string;
}

export function createLocalStatementsProvider(options: LocalStatementsProviderOptions = {}): StatementsProvider {
  const baseDir = options.directory ?? path.resolve(process.cwd(), "samples/statements");

  return {
    async fetchStatements(abn: string, periodId: string) {
      const fileName = `${abn}_${periodId}.json`;
      const filePath = path.join(baseDir, fileName);
      if (!fs.existsSync(filePath)) {
        throw new StatementsProviderError("STATEMENTS_NOT_FOUND");
      }
      const raw = await fs.promises.readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as Array<Omit<StatementLine, "postedAt"> & { postedAt: string }>;
      return data.map((line) => ({ ...line, postedAt: new Date(line.postedAt) }));
    },
  };
}
