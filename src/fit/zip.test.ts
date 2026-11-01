import { deflateRawSync, crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseActivityFile, parseFitFile } from './index';
import { crc32, extractFitFromZip } from './zip';
import { buildClimbDescentFit, FIXTURE_RECORDS_AFTER, FIXTURE_RECORDS_BEFORE, toArrayBuffer } from './__fixtures__/climbDescent';

interface TestEntry {
  name: string;
  data: Uint8Array;
  /** 0 = stored, 8 = deflate, anything else is written as-is with the raw data. */
  method?: number;
  /** Write sizes/CRC in a trailing data descriptor (flag bit 3) instead of the local header. */
  descriptor?: boolean;
  flags?: number;
}

/** Hand-written ZIP builder (local headers + optional data descriptors + central directory + EOCD). */
function buildZip(entries: TestEntry[], comment = ''): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const enc = new TextEncoder();

  for (const e of entries) {
    const method = e.method ?? 8;
    const name = enc.encode(e.name);
    const body = method === 8 ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const crc = nodeCrc32(e.data) >>> 0;
    const flags = (e.flags ?? 0) | (e.descriptor ? 0x8 : 0);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, method, true);
    local.setUint32(14, e.descriptor ? 0 : crc, true);
    local.setUint32(18, e.descriptor ? 0 : body.length, true);
    local.setUint32(22, e.descriptor ? 0 : e.data.length, true);
    local.setUint16(26, name.length, true);
    const localOffset = offset;
    for (const part of [new Uint8Array(local.buffer), name, body]) {
      parts.push(part);
      offset += part.length;
    }
    if (e.descriptor) {
      const dd = new DataView(new ArrayBuffer(16));
      dd.setUint32(0, 0x08074b50, true);
      dd.setUint32(4, crc, true);
      dd.setUint32(8, body.length, true);
      dd.setUint32(12, e.data.length, true);
      parts.push(new Uint8Array(dd.buffer));
      offset += 16;
    }

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, flags, true);
    cd.setUint16(10, method, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, body.length, true);
    cd.setUint32(24, e.data.length, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, localOffset, true);
    central.push(new Uint8Array(cd.buffer), name);
  }

  const cdOffset = offset;
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const commentBytes = enc.encode(comment);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, cdOffset, true);
  eocd.setUint16(20, commentBytes.length, true);

  const all = [...parts, ...central, new Uint8Array(eocd.buffer), commentBytes];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}

const fit = buildClimbDescentFit();
const POINTS = FIXTURE_RECORDS_BEFORE + FIXTURE_RECORDS_AFTER;

describe('parseActivityFile', () => {
  it('parses a deflated .fit inside a zip, naming the activity after the zip', async () => {
    const zip = buildZip([{ name: '17212345678_ACTIVITY.fit', data: fit }]);
    const a = await parseActivityFile(toArrayBuffer(zip), 'Morning Run.zip');
    expect(a.name).toBe('Morning Run');
    expect(a.points).toHaveLength(POINTS);
    expect(a.pauses).toHaveLength(1);
    expect(a.deviceTotals?.totalAscent).toBe(600);
  });

  it('parses a stored (uncompressed) entry', async () => {
    const zip = buildZip([{ name: '1_ACTIVITY.FIT', data: fit, method: 0 }]);
    const a = await parseActivityFile(toArrayBuffer(zip), 'stored.zip');
    expect(a.points).toHaveLength(POINTS);
  });

  it('handles entries written with a data descriptor and an archive comment', async () => {
    const zip = buildZip([{ name: '2_ACTIVITY.fit', data: fit, descriptor: true }], 'exported by Garmin Connect');
    const a = await parseActivityFile(toArrayBuffer(zip), 'dd.zip');
    expect(a.points).toHaveLength(POINTS);
  });

  it('picks the .fit entry next to other files, and the largest of several .fit files', async () => {
    const small = buildClimbDescentFit({ includePositions: false, includeDistance: false });
    expect(small.length).toBeLessThan(fit.length);
    const zip = buildZip([
      { name: 'readme.txt', data: new TextEncoder().encode('hello') },
      { name: 'small.fit', data: small },
      { name: 'dir/3_ACTIVITY.fit', data: fit, descriptor: true },
      { name: 'image.png', data: new Uint8Array(100_000), method: 0 },
    ]);
    const extracted = await extractFitFromZip(toArrayBuffer(zip));
    expect(extracted.name).toBe('dir/3_ACTIVITY.fit');
    expect(extracted.bytes).toEqual(fit);
    const a = await parseActivityFile(toArrayBuffer(zip), 'multi.zip');
    expect(a.points[a.points.length - 1].lat).not.toBeNull();
  });

  it('still parses a plain .fit file', async () => {
    const a = await parseActivityFile(toArrayBuffer(fit), 'plain.fit');
    const b = await parseFitFile(toArrayBuffer(fit), 'plain.fit');
    expect(a).toEqual(b);
  });

  it('rejects a zip without a .fit file', async () => {
    const zip = buildZip([{ name: 'activity.gpx', data: new TextEncoder().encode('<gpx/>') }]);
    await expect(parseActivityFile(toArrayBuffer(zip), 'x.zip')).rejects.toThrow(
      /Could not open "x.zip": .*does not contain a \.fit file/,
    );
  });

  it('rejects an empty zip archive', async () => {
    await expect(parseActivityFile(toArrayBuffer(buildZip([])), 'empty.zip')).rejects.toThrow(/does not contain a \.fit/);
  });

  it('rejects corrupted deflate data', async () => {
    const zip = buildZip([{ name: 'a.fit', data: fit }]);
    for (let i = 100; i < 400; i++) zip[i] ^= 0x5a;
    await expect(parseActivityFile(toArrayBuffer(zip), 'bad.zip')).rejects.toThrow(/corrupt or truncated/);
  });

  it('rejects a stored entry whose bytes were altered (CRC mismatch)', async () => {
    const zip = buildZip([{ name: 'a.fit', data: fit, method: 0 }]);
    zip[500] ^= 0xff;
    await expect(parseActivityFile(toArrayBuffer(zip), 'bad.zip')).rejects.toThrow(/CRC-32 mismatch/);
  });

  it('rejects a truncated zip', async () => {
    const zip = buildZip([{ name: 'a.fit', data: fit }]);
    await expect(parseActivityFile(toArrayBuffer(zip.slice(0, zip.length - 40)), 't.zip')).rejects.toThrow(
      /corrupt or truncated/,
    );
    await expect(parseActivityFile(toArrayBuffer(zip.slice(0, 2000)), 't.zip')).rejects.toThrow(/corrupt or truncated/);
  });

  it('rejects encrypted entries and unsupported compression', async () => {
    const enc = buildZip([{ name: 'a.fit', data: fit, method: 0, flags: 0x1 }]);
    await expect(parseActivityFile(toArrayBuffer(enc), 'e.zip')).rejects.toThrow(/encrypted/);
    const bz = buildZip([{ name: 'a.fit', data: fit, method: 12 }]);
    await expect(parseActivityFile(toArrayBuffer(bz), 'b.zip')).rejects.toThrow(/unsupported compression method 12/);
  });
});

describe('crc32', () => {
  it('matches zlib', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(fit)).toBe(nodeCrc32(fit) >>> 0);
  });
});
