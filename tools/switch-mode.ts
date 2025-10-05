import { writeFile, access } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { normaliseMode, RuntimeMode } from "@core/runtime/mode";

const MODES: RuntimeMode[] = ["mock", "shadow", "real"];
const CAPABILITY_FILE = path.join(process.cwd(), ".capabilities", "real.ready");

function usage() {
  console.error(`Usage: pnpm exec tsx tools/switch-mode.ts <${MODES.join("|")}>`);
}

async function capabilityReady(): Promise<boolean> {
  try {
    await access(CAPABILITY_FILE, constants.F_OK);
    return true;
  } catch {
    return (process.env.APGMS_REAL_CAPABILITY || "").toLowerCase() === "ready";
  }
}

async function main() {
  const modeArg = process.argv[2];
  const mode = normaliseMode(modeArg);

  if (!modeArg || !MODES.includes(modeArg.toLowerCase() as RuntimeMode)) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (mode === "real" && !(await capabilityReady())) {
    console.error("Refusing to switch to real mode: capability gate not ready");
    console.error(`Create ${CAPABILITY_FILE} or set APGMS_REAL_CAPABILITY=ready`);
    process.exitCode = 1;
    return;
  }

  const profilePath = path.join(process.cwd(), ".env.profile");
  const markerPath = path.join(process.cwd(), ".apgms-mode");
  const contents = `APGMS_RUNTIME_MODE=${mode}\n`;

  await writeFile(profilePath, contents, "utf8");
  await writeFile(markerPath, mode, "utf8");

  console.log(`Runtime mode switched to ${mode}`);
}

void main();
