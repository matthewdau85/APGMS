import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PDF_HEADER = '%PDF-1.4\n';

function escapePdfText(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function markdownToLines(markdown: string): string[] {
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .map((line) => line.replace(/^#{1,6}\s*/, '').replace(/^[-*]\s+/, '- '))
    .map((line) => line.replace(/\[(.*?)\]\((.*?)\)/g, '$1'))
    .map((line) => (line.trim().length === 0 ? ' ' : line.trim()))
    .filter((_, index, arr) => {
      if (index === arr.length - 1) {
        return true;
      }
      return !(arr[index] === ' ' && arr[index + 1] === ' ');
    });
}

function buildPdf(lines: string[]): Buffer {
  const escapedLines = lines.map((line) => escapePdfText(line));

  const textStreamLines: string[] = ['BT', '/F1 12 Tf', '16 TL', '50 760 Td'];
  escapedLines.forEach((line, index) => {
    if (index === 0) {
      textStreamLines.push(`(${line}) Tj`);
    } else {
      textStreamLines.push('T*', `(${line}) Tj`);
    }
  });
  textStreamLines.push('ET');

  const textStream = textStreamLines.join('\n');
  const textStreamBuffer = Buffer.from(textStream, 'utf8');

  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = '<< /Type /Pages /Kids [3 0 R] /Count 1 >>';
  objects[3] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  objects[5] = `<< /Length ${textStreamBuffer.length} >>\nstream\n${textStream}\nendstream`;

  let body = PDF_HEADER;
  const offsets: number[] = [0];

  for (let i = 1; i < objects.length; i += 1) {
    const offset = Buffer.byteLength(body, 'utf8');
    offsets.push(offset);
    body += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(body, 'utf8');
  let xref = `xref\n0 ${objects.length}\n`;
  xref += '0000000000 65535 f \n';
  for (let i = 1; i < offsets.length; i += 1) {
    const offset = offsets[i];
    xref += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  body += xref;
  body += `trailer << /Size ${objects.length} /Root 1 0 R >>\n`;
  body += `startxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(body, 'utf8');
}

async function main(): Promise<void> {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = path.dirname(currentFile);
  const repoRoot = path.resolve(currentDir, '..', '..');
  const deckPath = path.join(repoRoot, 'docs', 'pilot', 'deck.md');
  const outputDir = path.join(repoRoot, 'artifacts');
  const outputPath = path.join(outputDir, 'pilot_deck.pdf');

  try {
    await fs.access(deckPath);
  } catch (error) {
    throw new Error(`Deck file not found at ${deckPath}`);
  }

  await fs.mkdir(outputDir, { recursive: true });

  const markdown = await fs.readFile(deckPath, 'utf8');
  const lines = markdownToLines(markdown);
  const pdfBuffer = buildPdf(lines);

  await fs.writeFile(outputPath, pdfBuffer);
  console.log(`Generated PDF at ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
