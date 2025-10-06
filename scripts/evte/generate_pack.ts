import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { buildZip } from "../../libs/zip";

interface PackOptions {
  date?: string;
  root?: string;
  quiet?: boolean;
}

interface PackFileEntry {
  name: string;
  size: number;
  sha256: string;
}

export interface PackResult {
  date: string;
  generatedAt: string;
  packDir: string;
  files: PackFileEntry[];
  bundleSha256: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "../..");
const dataDir = path.join(repoRoot, "ops", "data");
const rulesDir = path.join(repoRoot, "rules", "manifest");

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function resolveBaseDate(dateStr: string): Date {
  if (!DATE_REGEX.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  const base = new Date(`${dateStr}T12:00:00Z`);
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Unable to parse date: ${dateStr}`);
  }
  return base;
}

function subtractDays(base: Date, days: number): Date {
  const copy = new Date(base);
  copy.setUTCDate(copy.getUTCDate() - days);
  return copy;
}

function subtractHours(base: Date, hours: number): Date {
  const copy = new Date(base);
  copy.setUTCHours(copy.getUTCHours() - hours);
  return copy;
}

function markdownEscape(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function createSecurityWorkbook(rows: Array<Record<string, string>>): Buffer {
  if (rows.length === 0) {
    const empty = [{ Control: "", Description: "", Coverage: "", Owner: "", Monitor: "", LastAudit: "", Status: "" }];
    return createSecurityWorkbook(empty);
  }

  const headers = Object.keys(rows[0]);
  const sheetRows: string[] = [];
  const headerCells = headers
    .map((header, idx) => `<c r="${columnName(idx)}1" t="str"><v>${xmlEscape(header)}</v></c>`)
    .join("");
  sheetRows.push(`<row r="1">${headerCells}</row>`);

  rows.forEach((row, rowIdx) => {
    const cells = headers
      .map((header, idx) => {
        const value = row[header] ?? "";
        return `<c r="${columnName(idx)}${rowIdx + 2}" t="str"><v>${xmlEscape(String(value))}</v></c>`;
      })
      .join("");
    sheetRows.push(`<row r="${rowIdx + 2}">${cells}</row>`);
  });

  const sheet = `<?xml version="1.0" encoding="UTF-8"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n  <sheetData>${sheetRows.join("")}</sheetData>\n</worksheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <sheets>\n    <sheet name="Security Controls" sheetId="1" r:id="rId1"/>\n  </sheets>\n</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\n  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\n</Relationships>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\n</Relationships>`;

  const styles = `<?xml version="1.0" encoding="UTF-8"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n  <fonts count="1">\n    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>\n  </fonts>\n  <fills count="1">\n    <fill><patternFill patternType="none"/></fill>\n  </fills>\n  <borders count="1">\n    <border><left/><right/><top/><bottom/><diagonal/></border>\n  </borders>\n  <cellStyleXfs count="1">\n    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>\n  </cellStyleXfs>\n  <cellXfs count="1">\n    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>\n  </cellXfs>\n  <cellStyles count="1">\n    <cellStyle name="Normal" xfId="0" builtinId="0"/>\n  </cellStyles>\n</styleSheet>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="xml" ContentType="application/xml"/>\n  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\n  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\n</Types>`;

  return buildZip([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/styles.xml", data: styles },
    { name: "xl/worksheets/sheet1.xml", data: sheet }
  ]);
}

function escapePdfText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapText(value: string, width = 90): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let current = words.shift() ?? "";
  for (const word of words) {
    const candidate = `${current} ${word}`;
    if (candidate.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

function createPiaPdfBuffer(pia: { version: string; link: string; summary: string; approved_at: string; owner: string }): Buffer {
  const lines: string[] = [
    "BT",
    "/F1 16 Tf",
    "16 TL",
    "72 760 Td",
    `(Privacy Impact Assessment) Tj`,
    "T*",
    "/F1 12 Tf",
    `(Version: ${escapePdfText(pia.version)}) Tj`,
    "T*",
    `(Approved: ${escapePdfText(new Date(pia.approved_at).toUTCString())}) Tj`,
    "T*",
    `(Owner: ${escapePdfText(pia.owner)}) Tj`,
    "T*",
    `(Summary:) Tj`,
    "T*"
  ];

  for (const line of wrapText(pia.summary)) {
    lines.push(`(${escapePdfText(line)}) Tj`);
    lines.push("T*");
  }

  lines.push(`(Link: ${escapePdfText(pia.link)}) Tj`);
  lines.push("ET");

  const content = lines.join("\n");
  const contentBuffer = Buffer.from(content, "utf8");

  const objects: string[] = [];
  objects.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.push("2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n");
  objects.push(
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
  );
  objects.push(
    `4 0 obj\n<< /Length ${contentBuffer.length} >>\nstream\n${content}\nendstream\nendobj\n`
  );
  objects.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i += 1) {
    const offset = offsets[i];
    pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

async function writeControlsMatrix(targetDir: string, generatedAt: string) {
  const controlsRaw = await fs.readFile(path.join(dataDir, "dsp_controls.json"), "utf-8");
  const controls: Array<{
    id: string;
    title: string;
    components: string[];
    owner: string;
    status: string;
    evidence: string;
    updated_at: string;
  }> = JSON.parse(controlsRaw);

  const lines: string[] = [];
  lines.push("# DSP Controls mapped to APGMS components");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push("| Control | Title | Components | Owner | Status | Evidence |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const control of controls) {
    lines.push(
      `| ${markdownEscape(control.id)} | ${markdownEscape(control.title)} | ${markdownEscape(control.components.join(", "))} | ${markdownEscape(control.owner)} | ${markdownEscape(control.status)} | ${markdownEscape(control.evidence)} |`
    );
  }
  await fs.writeFile(path.join(targetDir, "controls_matrix.md"), lines.join("\n"));
}

async function writeSecurityMatrix(targetDir: string) {
  const securityRaw = await fs.readFile(path.join(dataDir, "security_controls.json"), "utf-8");
  const security: Array<{
    id: string;
    control: string;
    coverage: string[];
    monitor: string;
    owner: string;
    last_audit: string;
    status: string;
  }> = JSON.parse(securityRaw);

  const rows = security.map(item => ({
    Control: item.id,
    Description: item.control,
    Coverage: item.coverage.join(", "),
    Owner: item.owner,
    Monitor: item.monitor,
    LastAudit: item.last_audit,
    Status: item.status
  }));

  const buffer = createSecurityWorkbook(rows);
  await fs.writeFile(path.join(targetDir, "security_controls_matrix.xlsx"), buffer);
}

async function writePiaPdf(targetDir: string) {
  const piaRaw = await fs.readFile(path.join(dataDir, "pia.json"), "utf-8");
  const pia: {
    version: string;
    link: string;
    summary: string;
    approved_at: string;
    owner: string;
  } = JSON.parse(piaRaw);

  const pdfBuffer = createPiaPdfBuffer(pia);
  await fs.writeFile(path.join(targetDir, "PIA.pdf"), pdfBuffer);
}

async function writeIrDrReport(targetDir: string, baseDate: Date, generatedAt: string) {
  const raw = await fs.readFile(path.join(dataDir, "ir_dr_exercises.json"), "utf-8");
  const exercises: Array<{
    type: string;
    offset_days: number;
    scenario: string;
    summary: string;
    rto_hours: number;
    rpo_minutes: number;
    participants: string[];
    findings: string[];
  }> = JSON.parse(raw);

  const recent = exercises
    .filter(item => item.offset_days <= 7)
    .sort((a, b) => a.offset_days - b.offset_days)[0];

  if (!recent) {
    throw new Error("No IR/DR exercise recorded in the past week");
  }

  const exerciseDate = subtractDays(baseDate, recent.offset_days);
  const lines: string[] = [];
  lines.push("# Incident & Disaster Recovery Exercise");
  lines.push("");
  lines.push(`Generated: ${generatedAt}`);
  lines.push("");
  lines.push(`- Exercise type: ${recent.type}`);
  lines.push(`- Scenario: ${recent.scenario}`);
  lines.push(`- Exercise date: ${exerciseDate.toISOString()}`);
  lines.push(`- Recovery Time Objective (RTO): ${recent.rto_hours} hours`);
  lines.push(`- Recovery Point Objective (RPO): ${recent.rpo_minutes} minutes`);
  lines.push(`- Participants: ${recent.participants.join(", ")}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(recent.summary);
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  for (const finding of recent.findings) {
    lines.push(`- ${finding}`);
  }
  await fs.writeFile(path.join(targetDir, "IR_DR_report.md"), lines.join("\n"));
}

async function writeAccessReviewCsv(targetDir: string, baseDate: Date) {
  const raw = await fs.readFile(path.join(dataDir, "access_reviews.json"), "utf-8");
  const entries: Array<{
    actor: string;
    action: string;
    target: string;
    reason: string;
    offset_days: number;
  }> = JSON.parse(raw);

  const filtered = entries
    .filter(entry => entry.offset_days <= 30)
    .map(entry => ({
      timestamp: subtractDays(baseDate, entry.offset_days).toISOString(),
      actor: entry.actor,
      action: entry.action,
      target: entry.target,
      reason: entry.reason
    }))
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const header = "timestamp,actor,action,target,reason";
  const rows = filtered.map(
    entry =>
      `${entry.timestamp},${entry.actor},${entry.action},${entry.target},"${entry.reason.replace(/"/g, '""')}"`
  );
  await fs.writeFile(path.join(targetDir, "AccessReview.csv"), [header, ...rows].join("\n"));
}

async function writeRulesArtifacts(targetDir: string, generatedAt: string, packDate: string) {
  const changelogPath = path.join(rulesDir, "changelog.md");
  const changelogRaw = await fs.readFile(changelogPath, "utf-8");
  const trimmed = changelogRaw.replace(/^#\s+Rules Manifest Changelog\s*/i, "").trim();
  const lines: string[] = [];
  lines.push("# Rules Changelog");
  lines.push("");
  lines.push(`- Pack date: ${packDate}`);
  lines.push(`- Generated at: ${generatedAt}`);
  lines.push("");
  lines.push(trimmed);
  await fs.writeFile(path.join(targetDir, "Rules_changelog.md"), lines.join("\n"));
}

async function writeKmsRotation(targetDir: string, baseDate: Date) {
  const raw = await fs.readFile(path.join(dataDir, "kms_rotations.json"), "utf-8");
  const payload: {
    rotations: Array<{
      offset_days: number;
      old_kid: string;
      new_kid: string;
      grace_window_hours: number;
      rotated_by: string;
    }>;
  } = JSON.parse(raw);

  const latest = payload.rotations
    .filter(r => r.offset_days <= 7)
    .sort((a, b) => a.offset_days - b.offset_days)[0];

  if (!latest) {
    throw new Error("No KMS rotation captured in the past week");
  }

  const rotatedAt = subtractDays(baseDate, latest.offset_days);
  const body = {
    rotated_at: rotatedAt.toISOString(),
    old_key_id: latest.old_kid,
    new_key_id: latest.new_kid,
    grace_window_hours: latest.grace_window_hours,
    rotated_by: latest.rotated_by
  };
  await fs.writeFile(path.join(targetDir, "KMS_rotation_log.json"), JSON.stringify(body, null, 2));
}

async function writeRailsProbe(targetDir: string, baseDate: Date) {
  const raw = await fs.readFile(path.join(dataDir, "rails_probes.json"), "utf-8");
  const payload: {
    probes: Array<{
      offset_hours: number;
      status: string;
      latency_ms: number;
      mTLS_peer: string;
      certificate_expires_at: string;
    }>;
  } = JSON.parse(raw);

  const latest = payload.probes
    .filter(p => p.offset_hours <= 48)
    .sort((a, b) => a.offset_hours - b.offset_hours)[0];

  if (!latest) {
    throw new Error("No Rails probe health record in the past 48 hours");
  }

  const observedAt = subtractHours(baseDate, latest.offset_hours);
  const body = {
    observed_at: observedAt.toISOString(),
    status: latest.status,
    latency_ms: latest.latency_ms,
    mtls_peer: latest.mTLS_peer,
    certificate_expires_at: latest.certificate_expires_at
  };
  await fs.writeFile(path.join(targetDir, "Rails_probe_log.json"), JSON.stringify(body, null, 2));
}

async function writeSloSnapshot(targetDir: string, baseDate: Date) {
  const raw = await fs.readFile(path.join(dataDir, "slo_snapshots.json"), "utf-8");
  const snapshots: Array<{
    offset_days: number;
    availability: number;
    p95_latency_ms: number;
    dlq_depth: number;
    window_hours: number;
  }> = JSON.parse(raw);

  const recent = snapshots
    .filter(s => s.offset_days <= 7)
    .sort((a, b) => a.offset_days - b.offset_days)[0];

  if (!recent) {
    throw new Error("No SLO snapshot in the past week");
  }

  const capturedAt = subtractDays(baseDate, recent.offset_days);
  const body = {
    captured_at: capturedAt.toISOString(),
    availability: recent.availability,
    p95_latency_ms: recent.p95_latency_ms,
    dlq_depth: recent.dlq_depth,
    window_hours: recent.window_hours
  };
  await fs.writeFile(path.join(targetDir, "SLO_snapshot.json"), JSON.stringify(body, null, 2));
}

async function writeTestRunReport(targetDir: string, baseDate: Date, generatedAt: string) {
  const raw = await fs.readFile(path.join(dataDir, "test_runs.json"), "utf-8");
  const payload: {
    runs: Array<{
      suite: string;
      offset_hours: number;
      total: number;
      passed: number;
      failed: number;
      duration_seconds: number;
      commit: string;
      notes: string;
    }>;
  } = JSON.parse(raw);

  const report: Record<string, any> = {};
  for (const run of payload.runs) {
    if (run.offset_hours > 72) continue;
    const executedAt = subtractHours(baseDate, run.offset_hours);
    report[run.suite] = {
      executed_at: executedAt.toISOString(),
      total: run.total,
      passed: run.passed,
      failed: run.failed,
      duration_seconds: run.duration_seconds,
      commit: run.commit,
      notes: run.notes,
      status: run.failed === 0 ? "pass" : "attention"
    };
  }

  if (!report.golden || !report.boundary || !report.e2e) {
    throw new Error("Missing required test runs (golden, boundary, e2e) within 72 hours");
  }

  const body = {
    generated_at: generatedAt,
    runs: report
  };
  await fs.writeFile(path.join(targetDir, "Test_run_report.json"), JSON.stringify(body, null, 2));
}

function parseArgs(argv: string[]): PackOptions {
  const options: PackOptions = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--date" && i + 1 < argv.length) {
      options.date = argv[i + 1];
      i += 1;
    } else if (arg === "--root" && i + 1 < argv.length) {
      options.root = argv[i + 1];
      i += 1;
    } else if (arg === "--quiet") {
      options.quiet = true;
    }
  }
  return options;
}

async function computePackFiles(targetDir: string): Promise<{ files: PackFileEntry[]; bundleSha256: string }> {
  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const files: PackFileEntry[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const filePath = path.join(targetDir, entry.name);
    const data = await fs.readFile(filePath);
    const stats = await fs.stat(filePath);
    const sha256 = createHash("sha256").update(data).digest("hex");
    files.push({ name: entry.name, size: stats.size, sha256 });
  }

  files.sort((a, b) => a.name.localeCompare(b.name));

  const bundle = createHash("sha256");
  for (const file of files) {
    bundle.update(file.name, "utf8");
    bundle.update(file.sha256, "hex");
  }

  return { files, bundleSha256: bundle.digest("hex") };
}

export async function generatePack(opts: PackOptions = {}): Promise<PackResult> {
  const targetDate = opts.date ?? new Date().toISOString().slice(0, 10);
  const baseDate = resolveBaseDate(targetDate);
  const generatedAt = new Date().toISOString();
  const packRoot = path.resolve(
    opts.root ?? process.env.EVTE_PACK_ROOT ?? path.join(repoRoot, "ops", "artifacts", "evte")
  );
  const packDir = path.join(packRoot, targetDate);
  await fs.mkdir(packDir, { recursive: true });

  const manifestSourceRaw = await fs.readFile(path.join(rulesDir, "manifest.json"), "utf-8");
  const manifestSource = JSON.parse(manifestSourceRaw);

  await writeControlsMatrix(packDir, generatedAt);
  await writeSecurityMatrix(packDir);
  await writePiaPdf(packDir);
  await writeIrDrReport(packDir, baseDate, generatedAt);
  await writeAccessReviewCsv(packDir, baseDate);
  await writeRulesArtifacts(packDir, generatedAt, targetDate);
  await writeKmsRotation(packDir, baseDate);
  await writeRailsProbe(packDir, baseDate);
  await writeSloSnapshot(packDir, baseDate);
  await writeTestRunReport(packDir, baseDate, generatedAt);

  const { files, bundleSha256 } = await computePackFiles(packDir);

  const manifest = {
    ...manifestSource,
    generated_at: generatedAt,
    pack: {
      date: targetDate,
      generated_at: generatedAt,
      files,
      bundle_sha256: bundleSha256
    }
  };
  await fs.writeFile(path.join(packDir, "manifest.json"), JSON.stringify(manifest, null, 2));

  if (!opts.quiet) {
    console.log(`Generated EVTE/DSP pack for ${targetDate} at ${packDir}`);
  }

  return { date: targetDate, generatedAt, packDir, files, bundleSha256 };
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await generatePack(options);
    if (!options.quiet) {
      console.log(JSON.stringify({ date: result.date, bundleSha256: result.bundleSha256 }, null, 2));
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}

if (pathToFileURL(process.argv[1] ?? "").href === import.meta.url) {
  runCli();
}
