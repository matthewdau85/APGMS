import { promises as fs } from "fs";
import path from "path";
import { splitFrontMatter } from "./frontmatter";

const DOCS_DIR = path.resolve("docs/help");

async function main() {
  const files = (await fs.readdir(DOCS_DIR)).filter((file) => file.endsWith(".mdx"));
  const docs = await Promise.all(
    files.map(async (filename) => {
      const filePath = path.join(DOCS_DIR, filename);
      const content = await fs.readFile(filePath, "utf8");
      const { frontMatter } = splitFrontMatter(content);
      return { filename, filePath, content, slug: frontMatter.slug as string | undefined };
    })
  );

  const knownSlugs = new Set(docs.map((doc) => doc.slug).filter(Boolean) as string[]);
  const failures: string[] = [];

  for (const doc of docs) {
    const matches = doc.content.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g);
    for (const match of matches) {
      const target = match[1];
      if (target.startsWith("http")) continue;
      if (target.startsWith("#")) continue;
      if (target.startsWith("/help/")) {
        if (!knownSlugs.has(target)) {
          failures.push(`${doc.filename} links to missing slug ${target}`);
        }
      } else {
        const resolved = path.join(path.dirname(doc.filePath), target);
        try {
          await fs.access(resolved);
        } catch {
          failures.push(`${doc.filename} links to missing file ${target}`);
        }
      }
    }
  }

  if (failures.length) {
    console.error("Broken documentation links detected:");
    for (const failure of failures) {
      console.error(` - ${failure}`);
    }
    process.exit(1);
  }

  console.log("All internal help links resolved successfully.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
