import { promises as fs, constants as fsConstants } from "fs";
import path from "path";

const [, , requestedVersion] = process.argv;

if (!requestedVersion) {
  console.error("Usage: pnpm rates:bump <YYYY-MM>");
  process.exit(1);
}

if (!/^\d{4}-\d{2}$/.test(requestedVersion)) {
  console.error(`Invalid rates version "${requestedVersion}". Use the format YYYY-MM.`);
  process.exit(1);
}

const projectRoot = process.cwd();
const versionFile = path.join(projectRoot, "src", "tax", "ratesVersion.ts");
const dataDir = path.join(projectRoot, "data", "ato");
const fixtureFile = path.join(projectRoot, "tests", "fixtures", "tax", "edgeCases.json");

async function readCurrentVersion(): Promise<string> {
  const source = await fs.readFile(versionFile, "utf8");
  const match = source.match(/RATES_VERSION\s*=\s*"([^"]+)"/);
  if (!match) {
    throw new Error("Unable to find RATES_VERSION in src/tax/ratesVersion.ts");
  }
  return match[1];
}

async function copyRateFile(baseName: string, currentVersion: string, nextVersion: string): Promise<void> {
  const currentPath = path.join(dataDir, `${baseName}_${currentVersion}.json`);
  const nextPath = path.join(dataDir, `${baseName}_${nextVersion}.json`);
  await fs.access(currentPath);
  try {
    await fs.access(nextPath);
    console.warn(`Skipped ${baseName}: ${nextPath} already exists.`);
  } catch {
    await fs.copyFile(currentPath, nextPath, fsConstants.COPYFILE_EXCL);
    console.log(`Copied ${baseName}_${currentVersion}.json → ${baseName}_${nextVersion}.json`);
  }
}

async function updateVersionFile(nextVersion: string): Promise<void> {
  const source = await fs.readFile(versionFile, "utf8");
  const updated = source.replace(/RATES_VERSION\s*=\s*"([^"]+)"/, `RATES_VERSION = "${nextVersion}"`);
  await fs.writeFile(versionFile, `${updated.trim()}\n`);
}

async function updateFixtureVersion(nextVersion: string): Promise<void> {
  try {
    const raw = await fs.readFile(fixtureFile, "utf8");
    const data = JSON.parse(raw);
    if (!data.meta || typeof data.meta !== "object") {
      data.meta = {};
    }
    data.meta.ratesVersion = nextVersion;
    const serialized = JSON.stringify(data, null, 2);
    await fs.writeFile(fixtureFile, `${serialized}\n`);
    console.log(`Updated fixture rates version → ${nextVersion}`);
  } catch (error) {
    console.warn(`Unable to update fixture metadata: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main(): Promise<void> {
  const currentVersion = await readCurrentVersion();
  if (currentVersion === requestedVersion) {
    console.log(`Rates already at ${requestedVersion}. Nothing to do.`);
    return;
  }

  const baseFiles = ["paygw", "gst", "penalties"] as const;
  for (const base of baseFiles) {
    await copyRateFile(base, currentVersion, requestedVersion);
  }

  await updateVersionFile(requestedVersion);
  await updateFixtureVersion(requestedVersion);
  console.log(`Updated RATES_VERSION ${currentVersion} → ${requestedVersion}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
