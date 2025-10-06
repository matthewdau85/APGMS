import { Buffer } from "node:buffer";

type ZipFile = {
  name: string;
  contents: string | Buffer;
};

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      if ((crc & 1) !== 0) {
        crc = 0xedb88320 ^ (crc >>> 1);
      } else {
        crc >>>= 1;
      }
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i];
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function toDosDateTime(date: Date): { date: number; time: number } {
  const year = Math.max(1980, date.getUTCFullYear());
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);

  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hours << 11) | (minutes << 5) | seconds;

  return { date: dosDate, time: dosTime };
}

export function createZipArchive(files: ZipFile[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const { date, time } = toDosDateTime(now);

  for (const file of files) {
    const data = Buffer.isBuffer(file.contents)
      ? file.contents
      : Buffer.from(file.contents, "utf8");
    const name = Buffer.from(file.name, "utf8");
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    let ptr = 0;
    localHeader.writeUInt32LE(0x04034b50, ptr); ptr += 4;
    localHeader.writeUInt16LE(20, ptr); ptr += 2;
    localHeader.writeUInt16LE(0, ptr); ptr += 2;
    localHeader.writeUInt16LE(0, ptr); ptr += 2;
    localHeader.writeUInt16LE(time, ptr); ptr += 2;
    localHeader.writeUInt16LE(date, ptr); ptr += 2;
    localHeader.writeUInt32LE(crc >>> 0, ptr); ptr += 4;
    localHeader.writeUInt32LE(data.length, ptr); ptr += 4;
    localHeader.writeUInt32LE(data.length, ptr); ptr += 4;
    localHeader.writeUInt16LE(name.length, ptr); ptr += 2;
    localHeader.writeUInt16LE(0, ptr); ptr += 2;

    const localRecord = Buffer.concat([localHeader, name, data]);
    localParts.push(localRecord);

    const centralHeader = Buffer.alloc(46);
    ptr = 0;
    centralHeader.writeUInt32LE(0x02014b50, ptr); ptr += 4;
    centralHeader.writeUInt16LE(20, ptr); ptr += 2;
    centralHeader.writeUInt16LE(20, ptr); ptr += 2;
    centralHeader.writeUInt16LE(0, ptr); ptr += 2;
    centralHeader.writeUInt16LE(0, ptr); ptr += 2;
    centralHeader.writeUInt16LE(time, ptr); ptr += 2;
    centralHeader.writeUInt16LE(date, ptr); ptr += 2;
    centralHeader.writeUInt32LE(crc >>> 0, ptr); ptr += 4;
    centralHeader.writeUInt32LE(data.length, ptr); ptr += 4;
    centralHeader.writeUInt32LE(data.length, ptr); ptr += 4;
    centralHeader.writeUInt16LE(name.length, ptr); ptr += 2;
    centralHeader.writeUInt16LE(0, ptr); ptr += 2;
    centralHeader.writeUInt16LE(0, ptr); ptr += 2;
    centralHeader.writeUInt16LE(0, ptr); ptr += 2;
    centralHeader.writeUInt16LE(0, ptr); ptr += 2;
    centralHeader.writeUInt32LE(0, ptr); ptr += 4;
    centralHeader.writeUInt32LE(offset, ptr); ptr += 4;

    const centralRecord = Buffer.concat([centralHeader, name]);
    centralParts.push(centralRecord);

    offset += localRecord.length;
  }

  const centralOffset = offset;
  const centralBuffer = Buffer.concat(centralParts);
  const centralSize = centralBuffer.length;

  const end = Buffer.alloc(22);
  let ptr = 0;
  end.writeUInt32LE(0x06054b50, ptr); ptr += 4;
  end.writeUInt16LE(0, ptr); ptr += 2;
  end.writeUInt16LE(0, ptr); ptr += 2;
  end.writeUInt16LE(files.length, ptr); ptr += 2;
  end.writeUInt16LE(files.length, ptr); ptr += 2;
  end.writeUInt32LE(centralSize, ptr); ptr += 4;
  end.writeUInt32LE(centralOffset, ptr); ptr += 4;
  end.writeUInt16LE(0, ptr); ptr += 2;

  return Buffer.concat([...localParts, centralBuffer, end]);
}
