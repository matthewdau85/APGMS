const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    const index = (crc ^ byte) & 0xff;
    crc = (crc >>> 8) ^ CRC_TABLE[index];
  }
  return (~crc) >>> 0;
}

function toDosDateTime(date: Date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | Math.floor(seconds / 2);
  return { date: dosDate, time: dosTime };
}

export interface ZipEntry {
  name: string;
  data: Buffer;
  date?: Date;
}

export function createZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const now = new Date();

  for (const entry of entries) {
    const normalizedName = entry.name.replace(/\\/g, "/");
    const nameBuffer = Buffer.from(normalizedName, "utf8");
    const data = entry.data;
    const crc = crc32(data);
    const size = data.length;
    const { date, time } = toDosDateTime(entry.date ?? now);

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // local file header signature
    localHeader.writeUInt16LE(20, 4); // version needed to extract
    localHeader.writeUInt16LE(0, 6); // general purpose bit flag
    localHeader.writeUInt16LE(0, 8); // compression method (store)
    localHeader.writeUInt16LE(time, 10);
    localHeader.writeUInt16LE(date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra field length
    nameBuffer.copy(localHeader, 30);

    const localData = Buffer.concat([localHeader, data]);
    localParts.push(localData);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // central directory header signature
    centralHeader.writeUInt16LE(0x0314, 4); // version made by (3=UNIX, 20)
    centralHeader.writeUInt16LE(20, 6); // version needed to extract
    centralHeader.writeUInt16LE(0, 8); // general purpose
    centralHeader.writeUInt16LE(0, 10); // compression method
    centralHeader.writeUInt16LE(time, 12);
    centralHeader.writeUInt16LE(date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra field length
    centralHeader.writeUInt16LE(0, 32); // file comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal file attributes
    centralHeader.writeUInt32LE(0, 38); // external file attributes
    centralHeader.writeUInt32LE(offset, 42); // relative offset of local header
    nameBuffer.copy(centralHeader, 46);

    centralParts.push(centralHeader);
    offset += localData.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const localSection = Buffer.concat(localParts);
  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  endRecord.writeUInt16LE(0, 4); // number of this disk
  endRecord.writeUInt16LE(0, 6); // disk where central directory starts
  endRecord.writeUInt16LE(entries.length, 8); // number of central directory records on this disk
  endRecord.writeUInt16LE(entries.length, 10); // total number of central directory records
  endRecord.writeUInt32LE(centralDirectory.length, 12); // size of central directory
  endRecord.writeUInt32LE(localSection.length, 16); // offset of central directory
  endRecord.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localSection, centralDirectory, endRecord]);
}
