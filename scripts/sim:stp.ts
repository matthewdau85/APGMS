#!/usr/bin/env tsx
import { SimPayroll, PayrollScenario } from "../src/sim/payroll/SimPayroll";

function parseArgs() {
  const [, , scenarioArg, ...rest] = process.argv;
  if (!scenarioArg) {
    throw new Error(`Usage: tsx scripts/sim:stp.ts <scenario> [--advanceWeeks=N]\nAvailable: ${SimPayroll.supportedScenarios.join(", ")}`);
  }
  const options: { advanceWeeks?: number } = {};
  const advance = rest.find((arg) => arg.startsWith("--advanceWeeks="));
  if (advance) {
    const [, value] = advance.split("=");
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      throw new Error("advanceWeeks must be numeric");
    }
    options.advanceWeeks = parsed;
  }
  return { scenario: scenarioArg as PayrollScenario, options };
}

async function main() {
  const { scenario, options } = parseArgs();
  const result = await SimPayroll.trigger(scenario, options);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
