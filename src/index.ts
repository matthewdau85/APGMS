// src/index.ts
import express from "express";
import dotenv from "dotenv";
import { deflateRawSync } from "zlib";

import { idempotency } from "./middleware/idempotency";
import { closeAndIssue, payAto, paytoSweep, settlementWebhook, evidence } from "./routes/reconcile";
import { paymentsApi } from "./api/payments"; // ✅ mount this BEFORE `api`
import { api } from "./api";                  // your existing API router(s)
import { getAuditBundle } from "./audit/appendOnly";

dotenv.config();

const app = express();
app.use(express.json({ limit: "2mb" }));

// (optional) quick request logger
app.use((req, _res, next) => { console.log(`[app] ${req.method} ${req.url}`); next(); });

// Simple health check
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/audit/bundle/:period", async (req, res) => {
  try {
    const { period } = req.params as { period: string };
    const format = String(req.query.format || "json").toLowerCase();
    const bundle = await getAuditBundle(period);
    if (format === "zip") {
      const buffer = createZipArchive(`audit-${bundle.period}.json`, JSON.stringify(bundle, null, 2));
      res.setHeader("Content-Type", "application/zip");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-${bundle.period || period}.zip"`
      );
      return res.send(buffer);
    }
    res.json(bundle);
  } catch (err: any) {
    console.error("[audit] export failed", err);
    res.status(500).json({ error: "Failed to export audit bundle" });
  }
});

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      if ((crc & 1) === 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc >>>= 1;
      }
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createZipArchive(fileName: string, content: string): Buffer {
  const data = Buffer.from(content, "utf8");
  const compressed = deflateRawSync(data);
  const fileNameBytes = Buffer.from(fileName, "utf8");
  const crc = crc32(data);

  const localHeader = Buffer.alloc(30);
  let offset = 0;
  localHeader.writeUInt32LE(0x04034b50, offset); // Local file header signature
  offset += 4;
  localHeader.writeUInt16LE(20, offset); // Version needed to extract
  offset += 2;
  localHeader.writeUInt16LE(0, offset); // General purpose bit flag
  offset += 2;
  localHeader.writeUInt16LE(8, offset); // Compression method (deflate)
  offset += 2;
  localHeader.writeUInt16LE(0, offset); // File last mod time
  offset += 2;
  localHeader.writeUInt16LE(0, offset); // File last mod date
  offset += 2;
  localHeader.writeUInt32LE(crc, offset); // CRC-32
  offset += 4;
  localHeader.writeUInt32LE(compressed.length, offset); // Compressed size
  offset += 4;
  localHeader.writeUInt32LE(data.length, offset); // Uncompressed size
  offset += 4;
  localHeader.writeUInt16LE(fileNameBytes.length, offset); // File name length
  offset += 2;
  localHeader.writeUInt16LE(0, offset); // Extra field length
  offset += 2;

  const localFile = Buffer.concat([localHeader, fileNameBytes, compressed]);

  const centralHeader = Buffer.alloc(46);
  offset = 0;
  centralHeader.writeUInt32LE(0x02014b50, offset); // Central file header signature
  offset += 4;
  centralHeader.writeUInt16LE(20, offset); // Version made by
  offset += 2;
  centralHeader.writeUInt16LE(20, offset); // Version needed to extract
  offset += 2;
  centralHeader.writeUInt16LE(0, offset); // General purpose bit flag
  offset += 2;
  centralHeader.writeUInt16LE(8, offset); // Compression method
  offset += 2;
  centralHeader.writeUInt16LE(0, offset); // Last mod file time
  offset += 2;
  centralHeader.writeUInt16LE(0, offset); // Last mod file date
  offset += 2;
  centralHeader.writeUInt32LE(crc, offset); // CRC-32
  offset += 4;
  centralHeader.writeUInt32LE(compressed.length, offset); // Compressed size
  offset += 4;
  centralHeader.writeUInt32LE(data.length, offset); // Uncompressed size
  offset += 4;
  centralHeader.writeUInt16LE(fileNameBytes.length, offset); // File name length
  offset += 2;
  centralHeader.writeUInt16LE(0, offset); // Extra field length
  offset += 2;
  centralHeader.writeUInt16LE(0, offset); // File comment length
  offset += 2;
  centralHeader.writeUInt16LE(0, offset); // Disk number start
  offset += 2;
  centralHeader.writeUInt16LE(0, offset); // Internal file attributes
  offset += 2;
  centralHeader.writeUInt32LE(0, offset); // External file attributes
  offset += 4;
  centralHeader.writeUInt32LE(0, offset); // Relative offset of local header
  offset += 4;

  const centralDirectory = Buffer.concat([centralHeader, fileNameBytes]);

  const endRecord = Buffer.alloc(22);
  offset = 0;
  endRecord.writeUInt32LE(0x06054b50, offset); // End of central dir signature
  offset += 4;
  endRecord.writeUInt16LE(0, offset); // Number of this disk
  offset += 2;
  endRecord.writeUInt16LE(0, offset); // Disk where central directory starts
  offset += 2;
  endRecord.writeUInt16LE(1, offset); // Number of central directory records on this disk
  offset += 2;
  endRecord.writeUInt16LE(1, offset); // Total number of central directory records
  offset += 2;
  endRecord.writeUInt32LE(centralDirectory.length, offset); // Size of central directory
  offset += 4;
  endRecord.writeUInt32LE(localFile.length, offset); // Offset of start of central directory
  offset += 4;
  endRecord.writeUInt16LE(0, offset); // Comment length

  return Buffer.concat([localFile, centralDirectory, endRecord]);
}

// Existing explicit endpoints
app.post("/api/pay", idempotency(), payAto);
app.post("/api/close-issue", closeAndIssue);
app.post("/api/payto/sweep", paytoSweep);
app.post("/api/settlement/webhook", settlementWebhook);
app.get("/api/evidence", evidence);

// ✅ Payments API first so it isn't shadowed by catch-alls in `api`
app.use("/api", paymentsApi);

// Existing API router(s) after
app.use("/api", api);

// 404 fallback (must be last)
app.use((_req, res) => res.status(404).send("Not found"));

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log("APGMS server listening on", port));
