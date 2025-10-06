import { runAllScorecards } from "../../scripts/scorecard/checks";

export interface ReadinessSnapshot {
  rubric: { version: string };
  prototype: Awaited<ReturnType<typeof runAllScorecards>>["prototype"];
  real: Awaited<ReturnType<typeof runAllScorecards>>["real"];
  timestamp: string;
  appMode: string;
}

export async function getReadinessSnapshot(): Promise<ReadinessSnapshot> {
  const { prototype, real } = await runAllScorecards({ lite: true });

  return {
    rubric: { version: "1.0" },
    prototype,
    real,
    timestamp: new Date().toISOString(),
    appMode: process.env.APP_MODE || "prototype",
  };
}
