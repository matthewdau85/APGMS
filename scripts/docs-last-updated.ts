import { promises as fs } from "fs";
import path from "path";
import { execSync } from "child_process";
import { splitFrontMatter, serializeFrontMatter, FrontMatter } from "./frontmatter";

const DOCS_DIR = path.resolve("docs/help");

async function main() {
  const files = (await fs.readdir(DOCS_DIR)).filter((file) => file.endsWith(".mdx"));
  for (const filename of files) {
    const filePath = path.join(DOCS_DIR, filename);
    const raw = await fs.readFile(filePath, "utf8");
    const { frontMatter, body } = splitFrontMatter(raw);
    const lastUpdated = resolveGitDate(filePath);
    const updatedFrontMatter: FrontMatter = { ...frontMatter, lastUpdated };
    const fmBlock = `---\n${serializeFrontMatter(updatedFrontMatter)}\n---\n\n`;
    await fs.writeFile(filePath, `${fmBlock}${body.trim()}\n`);
    console.log(`Stamped ${filename} with lastUpdated=${lastUpdated}`);
  }
}

function resolveGitDate(filePath: string): string {
  try {
    const value = execSync(`git log -1 --format=%cs -- ${JSON.stringify(filePath)}`, {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (value) {
      return value;
    }
  } catch (error) {
    // Ignore and fall back to current date
  }
  return new Date().toISOString().split("T")[0];
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
