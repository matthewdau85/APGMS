import { spawn } from "child_process";
import { tmpdir } from "os";
import { promises as fs } from "fs";
import { join } from "path";
import { OcrLine } from "./types";

interface OcrEngine {
  extractLines(buffer: Buffer, mime: string): Promise<OcrLine[]>;
}

class TesseractEngine implements OcrEngine {
  async extractLines(buffer: Buffer, mime: string): Promise<OcrLine[]> {
    // Tesseract does not read PDFs from stdin; if we detect a PDF we create a temp file.
    const isPdf = mime === "application/pdf";

    if (isPdf) {
      const tmpFile = join(tmpdir(), `invoice-${Date.now()}.pdf`);
      await fs.writeFile(tmpFile, buffer);
      try {
        return await this.runProcess(tmpFile);
      } finally {
        await fs.unlink(tmpFile).catch(() => undefined);
      }
    }

    return await this.runProcess(buffer);
  }

  private runProcess(input: Buffer | string): Promise<OcrLine[]> {
    return new Promise((resolve, reject) => {
      const proc = spawn("tesseract", ["stdin", "stdout", "-l", "eng", "--psm", "6"], {
        stdio: ["pipe", "pipe", "pipe"],
      });

      const chunks: Buffer[] = [];
      proc.stdout.on("data", (chunk) => chunks.push(Buffer.from(chunk)));

      let stderr = "";
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      let settled = false;
      const finish = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      proc.on("error", (err) => finish(() => reject(err)));

      proc.on("close", (code) => {
        finish(() => {
          if (code !== 0) {
            return reject(new Error(`tesseract exited with code ${code}: ${stderr}`));
          }
          const text = Buffer.concat(chunks).toString("utf8");
          resolve(
            text
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
              .map((line) => ({ text: line, confidence: 0.7 }))
          );
        });
      });

      if (typeof input === "string") {
        fs.readFile(input)
          .then((data) => {
            proc.stdin.write(data);
            proc.stdin.end();
          })
          .catch((err) => {
            finish(() => reject(err));
            proc.kill();
          });
      } else {
        proc.stdin.write(input);
        proc.stdin.end();
      }
    });
  }
}

class FallbackEngine implements OcrEngine {
  async extractLines(buffer: Buffer, _mime: string): Promise<OcrLine[]> {
    const text = buffer.toString("utf8");
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.map((line) => ({ text: line, confidence: 0.4 }));
  }
}

let cachedEngine: OcrEngine | null = null;

export async function extractOcrLines(buffer: Buffer, mime: string): Promise<OcrLine[]> {
  if (!cachedEngine) {
    cachedEngine = await resolveEngine();
  }
  return cachedEngine.extractLines(buffer, mime);
}

async function resolveEngine(): Promise<OcrEngine> {
  try {
    await assertTesseract();
    return new TesseractEngine();
  } catch (err) {
    console.warn("[ml] Falling back to text OCR engine:", err);
    return new FallbackEngine();
  }
}

async function assertTesseract(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("tesseract", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    let settled = false;
    const finish = (fn: () => void) => {
      if (!settled) {
        settled = true;
        fn();
      }
    };
    proc.on("error", (err) => finish(() => reject(err)));
    proc.on("close", (code) => {
      finish(() => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error("tesseract not available"));
        }
      });
    });
  });
}
