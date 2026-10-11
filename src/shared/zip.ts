// Minimal ZIP writer (STORE, no compression). Enough for "download HTML + images".
import { utf8Bytes } from './hash';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array }

function dosTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function makeZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const { time, date } = dosTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = utf8Bytes(e.name);
    const crc = crc32(e.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true); // utf-8 names
    lh.setUint16(8, 0, true); // STORE
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, e.data.length, true);
    lh.setUint32(22, e.data.length, true);
    lh.setUint16(26, name.length, true);
    lh.setUint16(28, 0, true);
    const local = concat([new Uint8Array(lh.buffer), name, e.data]);
    locals.push(local);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, e.data.length, true);
    ch.setUint32(24, e.data.length, true);
    ch.setUint16(28, name.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    centrals.push(concat([new Uint8Array(ch.buffer), name]));
    offset += local.length;
  }
  const cdSize = centrals.reduce((a, c) => a + c.length, 0);
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(4, 0, true);
  eocd.setUint16(6, 0, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, cdSize, true);
  eocd.setUint32(16, offset, true);
  eocd.setUint16(20, 0, true);
  return concat([...locals, ...centrals, new Uint8Array(eocd.buffer)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
