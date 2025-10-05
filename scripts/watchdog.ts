#!/usr/bin/env node
import { createRuntime, runWatchdog, type WatchdogConfig } from "../src/watchdog/monitor";

interface CliOptions {
  [key: string]: string | undefined;
}

function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq > -1) {
      const key = arg.slice(2, eq);
      options[key] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = "true";
    }
  }
  return options;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildConfig(cli: CliOptions): WatchdogConfig {
  const baseUrl = cli.base ?? process.env.WATCHDOG_BASE_URL ?? "http://localhost:3000";
  const abn = cli.abn ?? process.env.WATCHDOG_ABN ?? "12345678901";
  const taxType = cli["tax-type"] ?? process.env.WATCHDOG_TAX_TYPE ?? "GST";
  const periodId = cli["period-id"] ?? process.env.WATCHDOG_PERIOD_ID ?? "2025-09";
  const intervalMs = parseNumber(
    cli["interval-ms"] ?? process.env.WATCHDOG_INTERVAL_MS,
    60_000
  );
  const staleMinutes = parseNumber(
    cli["stale-minutes"] ?? process.env.WATCHDOG_STALE_MINUTES,
    5
  );

  return {
    baseUrl,
    abn,
    taxType,
    periodId,
    intervalMs,
    staleMinutes,
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm watchdog [options]

Options:
  --base <url>             Override base URL (default http://localhost:3000)
  --abn <value>            ABN to query (default 12345678901)
  --tax-type <value>       Tax type to query (default GST)
  --period-id <value>      Period identifier to query (default 2025-09)
  --interval-ms <number>   Polling interval in milliseconds (default 60000)
  --stale-minutes <number> Threshold before reporting stale data (default 5)
`);
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help || cli.h) {
    printHelp();
    return;
  }

  const config = buildConfig(cli);
  console.info(
    `[watchdog] Monitoring ${config.baseUrl} for ${config.abn}/${config.taxType}/${config.periodId}`
  );

  const controller = new AbortController();
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  const stop = (signal: NodeJS.Signals) => {
    if (!controller.signal.aborted) {
      console.info(`[watchdog] Received ${signal}; stopping...`);
      controller.abort();
    }
  };
  for (const signal of signals) {
    process.on(signal, stop);
  }

  try {
    const state = await runWatchdog(config, {
      signal: controller.signal,
      state: createRuntime(),
    });
    if (state.hadAlert) {
      process.exitCode = process.exitCode ?? 1;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[watchdog] Unhandled error: ${message}`);
    process.exitCode = 1;
  } finally {
    for (const signal of signals) {
      process.off(signal, stop);
    }
  }
}

void main();
