import { promises as fs } from "fs";
import path from "path";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter";
import { execSync } from "child_process";

const HELP_ROOT = path.resolve(process.cwd(), "docs/help");

async function findMdxFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return findMdxFiles(fullPath);
      }
      if (entry.isFile() && fullPath.endsWith(".mdx")) {
        return [fullPath];
      }
      return [];
    })
  );
  return files.flat();
}

function gitLastUpdated(file: string): string | null {
  try {
    const output = execSync(`git log -1 --format=%cI -- "${file}"`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (output) {
      return output;
    }
  } catch (err) {
    // fall through to fs mtime / current time
  }
  return null;
}

async function stampLastUpdated() {
  try {
    await fs.access(HELP_ROOT);
  } catch (err) {
    console.warn(`[docs:lastUpdated] Skipping - help directory not found at ${HELP_ROOT}`);
    return;
  }

  const files = await findMdxFiles(HELP_ROOT);
  let updated = 0;

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8");
    const parsed = parseFrontmatter(raw);
    const stat = await fs.stat(file);
    const gitDate = gitLastUpdated(file) ?? stat.mtime.toISOString();

    if (parsed.data.lastUpdated !== gitDate) {
      const next = stringifyFrontmatter(
        { ...parsed.data, lastUpdated: gitDate },
        parsed.content,
        parsed.keys
      );
      await fs.writeFile(file, next);
      updated += 1;
    }
  }

  console.log(`[docs:lastUpdated] Processed ${files.length} MDX files; ${updated} updated.`);
}

stampLastUpdated().catch((err) => {
  console.error(`[docs:lastUpdated] Failed:`, err);
  process.exitCode = 1;
});
