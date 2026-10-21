// Reject an XLSX zip before exceljs inflates it. The upload cap is the
// compressed size. This cap is the sum of the inflated entries.

import { createInflateRaw } from "node:zlib";

export const PAST_CAMPAIGN_MAX_XLSX_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 4096;

export class XlsxCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxCapError";
  }
}

const SIZE_MESSAGE = "Spreadsheet expands past the import size limit";
const READ_MESSAGE = "Spreadsheet could not be read";

export async function assertXlsxUncompressedCap(
  bytes: Uint8Array,
  maxBytes: number = PAST_CAMPAIGN_MAX_XLSX_UNCOMPRESSED_BYTES
): Promise<void> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(bytes, view);
  const directory = centralDirectory(bytes, view, eocd);
  if (directory.entryCount > MAX_ENTRIES) {
    throw new XlsxCapError(READ_MESSAGE);
  }

  let cursor = directory.offset;
  let total = 0;
  for (let i = 0; i < directory.entryCount; i++) {
    const entry = readEntry(bytes, view, cursor);
    cursor = entry.next;
    if (entry.directory) continue;
    const actual = await expandedSize(bytes, view, entry, maxBytes - total);
    if (actual > maxBytes - total) throw new XlsxCapError(SIZE_MESSAGE);
    total += actual;
  }
}

interface Entry {
  method: number;
  flags: number;
  compressed: number;
  uncompressed: number;
  localOffset: number;
  directory: boolean;
  next: number;
}

function findEocd(bytes: Uint8Array, view: DataView): number {
  const min = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) !== 0x06054b50) continue;
    const commentLength = view.getUint16(i + 20, true);
    if (i + 22 + commentLength === bytes.length) return i;
  }
  throw new XlsxCapError(READ_MESSAGE);
}

function centralDirectory(
  bytes: Uint8Array,
  view: DataView,
  eocd: number
): { offset: number; entryCount: number } {
  let entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const cdSize = view.getUint32(eocd + 12, true);
  if (entryCount !== 0xffff && offset !== 0xffffffff && cdSize !== 0xffffffff) {
    return { offset, entryCount };
  }

  if (eocd < 20 || view.getUint32(eocd - 20, true) !== 0x07064b50) {
    throw new XlsxCapError(READ_MESSAGE);
  }
  const zip64Offset = readU64(view, eocd - 20 + 8);
  if (!Number.isFinite(zip64Offset) || zip64Offset + 56 > bytes.length) {
    throw new XlsxCapError(READ_MESSAGE);
  }
  if (view.getUint32(zip64Offset, true) !== 0x06064b50) {
    throw new XlsxCapError(READ_MESSAGE);
  }
  entryCount = readU64(view, zip64Offset + 32);
  offset = readU64(view, zip64Offset + 48);
  if (!Number.isFinite(entryCount) || !Number.isFinite(offset)) {
    throw new XlsxCapError(SIZE_MESSAGE);
  }
  return { offset, entryCount };
}

function readEntry(bytes: Uint8Array, view: DataView, cursor: number): Entry {
  if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== 0x02014b50) {
    throw new XlsxCapError(READ_MESSAGE);
  }
  const flags = view.getUint16(cursor + 8, true);
  const method = view.getUint16(cursor + 10, true);
  let compressed = view.getUint32(cursor + 20, true);
  let uncompressed = view.getUint32(cursor + 24, true);
  const nameLength = view.getUint16(cursor + 28, true);
  const extraLength = view.getUint16(cursor + 30, true);
  const commentLength = view.getUint16(cursor + 32, true);
  let localOffset = view.getUint32(cursor + 42, true);
  const extraStart = cursor + 46 + nameLength;
  const next = extraStart + extraLength + commentLength;
  if (next > bytes.length) throw new XlsxCapError(READ_MESSAGE);

  if (uncompressed === 0xffffffff || compressed === 0xffffffff || localOffset === 0xffffffff) {
    const zip64 = readZip64Extra(view, extraStart, extraLength, {
      uncompressed,
      compressed,
      localOffset,
    });
    uncompressed = zip64.uncompressed;
    compressed = zip64.compressed;
    localOffset = zip64.localOffset;
  }

  const directory = nameLength > 0 && bytes[cursor + 46 + nameLength - 1] === 0x2f;
  return { method, flags, compressed, uncompressed, localOffset, directory, next };
}

function readZip64Extra(
  view: DataView,
  extraStart: number,
  extraLength: number,
  fields: { uncompressed: number; compressed: number; localOffset: number }
): { uncompressed: number; compressed: number; localOffset: number } {
  let cursor = extraStart;
  const end = extraStart + extraLength;
  while (cursor + 4 <= end) {
    const id = view.getUint16(cursor, true);
    const size = view.getUint16(cursor + 2, true);
    const body = cursor + 4;
    if (body + size > end) throw new XlsxCapError(READ_MESSAGE);
    if (id === 0x0001) {
      let q = body;
      if (fields.uncompressed === 0xffffffff) {
        fields.uncompressed = readU64(view, q);
        q += 8;
      }
      if (fields.compressed === 0xffffffff) {
        fields.compressed = readU64(view, q);
        q += 8;
      }
      if (fields.localOffset === 0xffffffff) {
        fields.localOffset = readU64(view, q);
      }
      return fields;
    }
    cursor = body + size;
  }
  throw new XlsxCapError(READ_MESSAGE);
}

async function expandedSize(
  bytes: Uint8Array,
  view: DataView,
  entry: Entry,
  remaining: number
): Promise<number> {
  if (entry.flags & 0x1) throw new XlsxCapError(READ_MESSAGE);
  if (entry.uncompressed > remaining) throw new XlsxCapError(SIZE_MESSAGE);
  if (entry.method === 0) {
    const size = Math.max(entry.uncompressed, entry.compressed);
    if (size > remaining) throw new XlsxCapError(SIZE_MESSAGE);
    return size;
  }
  if (entry.method !== 8) throw new XlsxCapError(READ_MESSAGE);

  const dataStart = localDataStart(bytes, view, entry.localOffset);
  const dataEnd = dataStart + entry.compressed;
  if (dataEnd > bytes.length) throw new XlsxCapError(READ_MESSAGE);
  return inflateAtMost(bytes.subarray(dataStart, dataEnd), remaining);
}

function localDataStart(bytes: Uint8Array, view: DataView, offset: number): number {
  if (!Number.isFinite(offset) || offset + 30 > bytes.length) {
    throw new XlsxCapError(READ_MESSAGE);
  }
  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new XlsxCapError(READ_MESSAGE);
  }
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  if (start > bytes.length) throw new XlsxCapError(READ_MESSAGE);
  return start;
}

function inflateAtMost(compressed: Uint8Array, maxOut: number): Promise<number> {
  if (compressed.byteLength === 0) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    const inflate = createInflateRaw();
    let produced = 0;
    let settled = false;
    const finish = (error: Error | null, size = 0) => {
      if (settled) return;
      settled = true;
      inflate.destroy();
      if (error) reject(error);
      else resolve(size);
    };
    inflate.on("data", (chunk: Buffer) => {
      produced += chunk.length;
      if (produced > maxOut) finish(new XlsxCapError(SIZE_MESSAGE));
    });
    inflate.on("end", () => finish(null, produced));
    inflate.on("error", () => finish(new XlsxCapError(READ_MESSAGE)));
    inflate.end(Buffer.from(compressed));
  });
}

function readU64(view: DataView, offset: number): number {
  if (offset < 0 || offset + 8 > view.byteLength) throw new XlsxCapError(READ_MESSAGE);
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  if (hi > 0x1fffff) return Number.POSITIVE_INFINITY;
  return hi * 0x100000000 + lo;
}
