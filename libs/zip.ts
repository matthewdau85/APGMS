import { deflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer | string;
  date?: Date;
  mode?: number;
}

interface InternalEntry {
  name: string;
  data: Buffer;
  compressed: Buffer;
  crc32: number;
  date: Date;
  mode: number;
  offset: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let j = 0; j < 8; j += 1) {
      if ((c & 1) !== 0) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c >>>= 1;
      }
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function toDosDateTime(date: Date): { date: number; time: number } {
  let year = date.getUTCFullYear();
  if (year < 1980) year = 1980;
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  return { date: dosDate, time: dosTime };
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const processed: InternalEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const name = entry.name.replace(/\\/g, "/");
    const date = entry.date ?? new Date();
    const mode = entry.mode ?? 0o100644;

    processed.push({
      name,
      data,
      compressed,
      crc32: crc,
      date,
      mode,
      offset
    });
    offset += 30 + Buffer.byteLength(name) + compressed.length;
  }

  const fileSections: Buffer[] = [];
  const centralSections: Buffer[] = [];
  let runningOffset = 0;

  for (const entry of processed) {
    const fileName = Buffer.from(entry.name, "utf8");
    const { date, time } = toDosDateTime(entry.date);
    const localHeader = Buffer.alloc(30 + fileName.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(entry.crc32, 14);
    localHeader.writeUInt32LE(entry.compressed.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);
    fileName.copy(localHeader, 30);

    const localRecord = Buffer.concat([localHeader, entry.compressed]);
    fileSections.push(localRecord);

    const centralHeader = Buffer.alloc(46 + fileName.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(entry.crc32, 16);
    centralHeader.writeUInt32LE(entry.compressed.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(((entry.mode & 0xffff) << 16) >>> 0, 38);
    centralHeader.writeUInt32LE(runningOffset, 42);
    fileName.copy(centralHeader, 46);
    centralSections.push(centralHeader);

    runningOffset += localRecord.length;
  }

  const fileSection = Buffer.concat(fileSections);
  const centralDirectory = Buffer.concat(centralSections);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(processed.length, 8);
  endRecord.writeUInt16LE(processed.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(fileSection.length, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([fileSection, centralDirectory, endRecord]);
}
