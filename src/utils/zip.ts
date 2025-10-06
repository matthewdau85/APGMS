const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const VERSION = 20; // ZIP version 2.0

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dateToDos(date: Date) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  return { dosDate, dosTime };
}

export interface ZipFileEntry {
  name: string;
  data: Buffer | string;
}

export function createZip(entries: ZipFileEntry[]): Buffer {
  const localRecords: Buffer[] = [];
  const centralRecords: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const { dosDate, dosTime } = dateToDos(now);

  entries.forEach((entry) => {
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const crc = crc32(dataBuffer);
    const localHeader = Buffer.alloc(30);
    let cursor = 0;
    localHeader.writeUInt32LE(LOCAL_FILE_HEADER_SIGNATURE, cursor);
    cursor += 4;
    localHeader.writeUInt16LE(VERSION, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor); // general purpose bit flag
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor); // compression method (store)
    cursor += 2;
    localHeader.writeUInt16LE(dosTime, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(dosDate, cursor);
    cursor += 2;
    localHeader.writeUInt32LE(crc >>> 0, cursor);
    cursor += 4;
    localHeader.writeUInt32LE(dataBuffer.length, cursor);
    cursor += 4;
    localHeader.writeUInt32LE(dataBuffer.length, cursor);
    cursor += 4;
    localHeader.writeUInt16LE(nameBuffer.length, cursor);
    cursor += 2;
    localHeader.writeUInt16LE(0, cursor); // extra field length
    cursor += 2;

    const localRecord = Buffer.concat([localHeader, nameBuffer, dataBuffer]);
    localRecords.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    let centralCursor = 0;
    centralHeader.writeUInt32LE(CENTRAL_DIRECTORY_SIGNATURE, centralCursor);
    centralCursor += 4;
    centralHeader.writeUInt16LE(VERSION, centralCursor); // version made by
    centralCursor += 2;
    centralHeader.writeUInt16LE(VERSION, centralCursor); // version needed to extract
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // general purpose bit flag
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // compression method
    centralCursor += 2;
    centralHeader.writeUInt16LE(dosTime, centralCursor);
    centralCursor += 2;
    centralHeader.writeUInt16LE(dosDate, centralCursor);
    centralCursor += 2;
    centralHeader.writeUInt32LE(crc >>> 0, centralCursor);
    centralCursor += 4;
    centralHeader.writeUInt32LE(dataBuffer.length, centralCursor);
    centralCursor += 4;
    centralHeader.writeUInt32LE(dataBuffer.length, centralCursor);
    centralCursor += 4;
    centralHeader.writeUInt16LE(nameBuffer.length, centralCursor);
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // extra field length
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // file comment length
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // disk number start
    centralCursor += 2;
    centralHeader.writeUInt16LE(0, centralCursor); // internal file attributes
    centralCursor += 2;
    centralHeader.writeUInt32LE(0, centralCursor); // external file attributes
    centralCursor += 4;
    centralHeader.writeUInt32LE(offset, centralCursor); // relative offset of local header
    centralCursor += 4;

    const centralRecord = Buffer.concat([centralHeader, nameBuffer]);
    centralRecords.push(centralRecord);

    offset += localRecord.length;
  });

  const centralDirectory = Buffer.concat(centralRecords);
  const centralSize = centralDirectory.length;
  const centralOffset = offset;

  const endRecord = Buffer.alloc(22);
  let endCursor = 0;
  endRecord.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, endCursor);
  endCursor += 4;
  endRecord.writeUInt16LE(0, endCursor); // number of this disk
  endCursor += 2;
  endRecord.writeUInt16LE(0, endCursor); // number of the disk with the start of central directory
  endCursor += 2;
  endRecord.writeUInt16LE(entries.length, endCursor); // total entries on this disk
  endCursor += 2;
  endRecord.writeUInt16LE(entries.length, endCursor); // total entries overall
  endCursor += 2;
  endRecord.writeUInt32LE(centralSize, endCursor);
  endCursor += 4;
  endRecord.writeUInt32LE(centralOffset, endCursor);
  endCursor += 4;
  endRecord.writeUInt16LE(0, endCursor); // comment length

  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}
