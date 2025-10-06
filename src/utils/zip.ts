interface ZipEntry {
  name: string;
  content: Buffer;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0 ^ -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

export function createZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = entry.content;
    const crc = crc32(content);
    const localHeader = Buffer.alloc(30 + name.length);
    let pointer = 0;
    localHeader.writeUInt32LE(0x04034b50, pointer); pointer += 4;
    localHeader.writeUInt16LE(20, pointer); pointer += 2; // version needed
    localHeader.writeUInt16LE(0, pointer); pointer += 2; // general purpose
    localHeader.writeUInt16LE(0, pointer); pointer += 2; // compression
    localHeader.writeUInt16LE(0, pointer); pointer += 2; // mod time
    localHeader.writeUInt16LE(0, pointer); pointer += 2; // mod date
    localHeader.writeUInt32LE(crc >>> 0, pointer); pointer += 4;
    localHeader.writeUInt32LE(content.length, pointer); pointer += 4;
    localHeader.writeUInt32LE(content.length, pointer); pointer += 4;
    localHeader.writeUInt16LE(name.length, pointer); pointer += 2;
    localHeader.writeUInt16LE(0, pointer); pointer += 2; // extra length
    name.copy(localHeader, pointer);

    localParts.push(localHeader, content);

    const centralHeader = Buffer.alloc(46 + name.length);
    pointer = 0;
    centralHeader.writeUInt32LE(0x02014b50, pointer); pointer += 4;
    centralHeader.writeUInt16LE(20, pointer); pointer += 2; // version made by
    centralHeader.writeUInt16LE(20, pointer); pointer += 2; // version needed
    centralHeader.writeUInt16LE(0, pointer); pointer += 2; // general purpose
    centralHeader.writeUInt16LE(0, pointer); pointer += 2; // compression
    centralHeader.writeUInt16LE(0, pointer); pointer += 2; // mod time
    centralHeader.writeUInt16LE(0, pointer); pointer += 2; // mod date
    centralHeader.writeUInt32LE(crc >>> 0, pointer); pointer += 4;
    centralHeader.writeUInt32LE(content.length, pointer); pointer += 4;
    centralHeader.writeUInt32LE(content.length, pointer); pointer += 4;
    centralHeader.writeUInt16LE(name.length, pointer); pointer += 2;
    centralHeader.writeUInt16LE(0, pointer); pointer += 2; // extra length
    centralHeader.writeUInt16LE(0, pointer); pointer += 2; // comment length
    centralHeader.writeUInt16LE(0, pointer); pointer += 2; // disk number
    centralHeader.writeUInt16LE(0, pointer); pointer += 2; // internal attrs
    centralHeader.writeUInt32LE(0, pointer); pointer += 4; // external attrs
    centralHeader.writeUInt32LE(offset, pointer); pointer += 4; // offset
    name.copy(centralHeader, pointer);

    centralParts.push(centralHeader);
    offset += localHeader.length + content.length;
  }

  const centralSize = centralParts.reduce((acc, part) => acc + part.length, 0);
  const centralOffset = offset;
  const centralDirectory = Buffer.concat(centralParts);

  const endRecord = Buffer.alloc(22);
  let ptr = 0;
  endRecord.writeUInt32LE(0x06054b50, ptr); ptr += 4;
  endRecord.writeUInt16LE(0, ptr); ptr += 2; // disk number
  endRecord.writeUInt16LE(0, ptr); ptr += 2; // central disk
  endRecord.writeUInt16LE(entries.length, ptr); ptr += 2; // disk entries
  endRecord.writeUInt16LE(entries.length, ptr); ptr += 2; // total entries
  endRecord.writeUInt32LE(centralSize, ptr); ptr += 4; // central size
  endRecord.writeUInt32LE(centralOffset, ptr); ptr += 4; // central offset
  endRecord.writeUInt16LE(0, ptr); // comment length

  return Buffer.concat([...localParts, centralDirectory, endRecord]);
}
