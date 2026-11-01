/**
 * Minimal ZIP reader for Garmin Connect "Export File" downloads (a .zip holding one
 * `<id>_ACTIVITY.fit`). Browser-safe, no dependencies.
 *
 * Reads the central directory (so entries written with data descriptors work), supports
 * method 0 (stored) and 8 (deflate, via the native `DecompressionStream('deflate-raw')`),
 * and verifies sizes and CRC-32. No ZIP64, no encryption, no multi-disk archives.
 */

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

/** True if the bytes start with a ZIP local file header ("PK\x03\x04") or an empty-archive EOCD. */
export function looksLikeZip(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false;
  const sig = new DataView(data).getUint32(0, true);
  return sig === SIG_LOCAL || sig === SIG_EOCD;
}

/** List entries from the central directory. Throws ZipError on a corrupt/truncated archive. */
export function readZipEntries(data: ArrayBuffer): ZipEntry[] {
  const view = new DataView(data);
  const len = data.byteLength;
  const corrupt = (why: string) => new ZipError(`The zip archive is corrupt or truncated (${why}).`);

  // End of central directory: scan backwards over a possible archive comment.
  let eocd = -1;
  for (let p = len - EOCD_MIN_SIZE; p >= Math.max(0, len - EOCD_MIN_SIZE - MAX_COMMENT); p--) {
    if (view.getUint32(p, true) === SIG_EOCD) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw corrupt('end of central directory not found');

  const diskNumber = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const count = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported.');
  }
  if (diskNumber !== 0 || cdDisk !== 0) throw new ZipError('Multi-part (split) zip archives are not supported.');
  if (cdOffset + cdSize > eocd) throw corrupt('central directory out of bounds');

  const decoder = new TextDecoder('utf-8');
  const entries: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || view.getUint32(p, true) !== SIG_CENTRAL) throw corrupt('bad central directory entry');
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    if (p + 46 + nameLen > eocd) throw corrupt('bad central directory entry');
    entries.push({
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      crc32: view.getUint32(p + 16, true),
      compressedSize: view.getUint32(p + 20, true),
      uncompressedSize: view.getUint32(p + 24, true),
      localHeaderOffset: view.getUint32(p + 42, true),
      name: decoder.decode(new Uint8Array(data, p + 46, nameLen)),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Extract one entry's bytes, verifying size and CRC-32. */
export async function extractZipEntry(data: ArrayBuffer, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(data);
  const corrupt = (why: string) =>
    new ZipError(`The zip archive is corrupt or truncated (${why} in "${entry.name}").`);

  if (entry.flags & 0x1) throw new ZipError(`"${entry.name}" is encrypted; password-protected zips are not supported.`);
  if (entry.method !== 0 && entry.method !== 8) {
    throw new ZipError(
      `"${entry.name}" uses unsupported compression method ${entry.method} (only stored and deflate are supported).`,
    );
  }

  const lh = entry.localHeaderOffset;
  if (lh + 30 > data.byteLength || view.getUint32(lh, true) !== SIG_LOCAL) throw corrupt('bad local header');
  const start = lh + 30 + view.getUint16(lh + 26, true) + view.getUint16(lh + 28, true);
  const end = start + entry.compressedSize;
  if (end > data.byteLength) throw corrupt('entry data out of bounds');
  const raw = new Uint8Array(data, start, entry.compressedSize);

  let out: Uint8Array;
  if (entry.method === 0) {
    out = raw.slice();
  } else {
    if (typeof DecompressionStream === 'undefined') {
      throw new ZipError('This browser cannot decompress zip files. Please unzip the archive and open the .fit file.');
    }
    try {
      const stream = new Blob([raw.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      throw corrupt('invalid deflate data');
    }
  }

  if (out.byteLength !== entry.uncompressedSize) throw corrupt('size mismatch');
  if (crc32(out) !== entry.crc32) throw corrupt('CRC-32 mismatch');
  return out;
}

/**
 * Find the .fit entry (case-insensitive; the largest if several) and return its bytes.
 * Throws ZipError with a user-facing message on any problem.
 */
export async function extractFitFromZip(data: ArrayBuffer): Promise<{ name: string; bytes: Uint8Array }> {
  const candidates = readZipEntries(data).filter((e) => /\.fit$/i.test(e.name) && !e.name.endsWith('/'));
  if (candidates.length === 0) throw new ZipError('The zip archive does not contain a .fit file.');
  const entry = candidates.reduce((best, e) => (e.uncompressedSize > best.uncompressedSize ? e : best));
  return { name: entry.name, bytes: await extractZipEntry(data, entry) };
}

let crcTable: Uint32Array | null = null;

/** Standard CRC-32 (IEEE 802.3, as used by ZIP). */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
