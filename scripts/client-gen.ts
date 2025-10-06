import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

async function tryGenerateWithLibrary(openapiPath: string): Promise<string | null> {
  try {
    const mod: any = await import("openapi-typescript");
    const openapiTS = mod?.default ?? mod;
    if (typeof openapiTS !== "function") {
      throw new Error("openapi-typescript did not export a function");
    }
    const spec = JSON.parse(await readFile(openapiPath, "utf-8"));
    return openapiTS(spec, { alphabetize: true });
  } catch (error: any) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module/.test(String(error?.message ?? ""))) {
      console.warn("[client-gen] openapi-typescript not installed, using fallback generator");
      return null;
    }
    throw error;
  }
}

function fallbackTypes(): string {
  return `/* eslint-disable */\n/* prettier-ignore */\nexport interface paths {\n  "/dashboard/yesterday": {\n    get: {\n      responses: {\n        200: {\n          content: {\n            \"application/json\": components[\"schemas\"][\"DashboardYesterday\"];\n          };\n        };\n      };\n    };\n  };\n  "/bas/preview": {\n    get: {\n      responses: {\n        200: {\n          content: {\n            \"application/json\": components[\"schemas\"][\"BasPreview\"];\n          };\n        };\n      };\n    };\n  };\n  "/ato/status": {\n    get: {\n      responses: {\n        200: {\n          content: {\n            \"application/json\": components[\"schemas\"][\"AtoStatus\"];\n          };\n        };\n      };\n    };\n  };\n  [key: string]: unknown;\n}\n\nexport interface components {\n  schemas: {\n    DashboardYesterday: {\n      jobs: number;\n      success_rate: number;\n      top_errors: string[];\n    };\n    BasPreview: {\n      period: string;\n      GSTPayable: number;\n      PAYGW: number;\n      Total: number;\n    };\n    AtoStatus: {\n      status: string;\n    };\n    ConnStart: {\n      type: string;\n      provider: string;\n    };\n    Settings: {\n      retentionMonths: number;\n      piiMask: boolean;\n    };\n    ValidationError: {\n      loc: (string | number)[];\n      msg: string;\n      type: string;\n    };\n    HTTPValidationError: {\n      detail?: components[\"schemas\"][\"ValidationError\"][];\n    };\n    [key: string]: unknown;\n  };\n}\n\nexport interface operations {}\n\nexport type external = Record<string, never>;\n`;
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = path.resolve(here, "..");
  const openapiPath = path.resolve(repoRoot, "openapi.json");
  const outputPath = path.resolve(repoRoot, "src/api/schema.ts");

  const withLibrary = await tryGenerateWithLibrary(openapiPath);
  const output = withLibrary ?? fallbackTypes();
  await writeFile(outputPath, output, "utf-8");
  console.log(`[client-gen] wrote ${path.relative(repoRoot, outputPath)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
