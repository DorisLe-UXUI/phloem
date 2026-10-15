// Minimal ZIP reader for the browser (no dependency): reads the central directory, then inflates each wanted entry with the
// built-in DecompressionStream('deflate-raw'). Handles stored and deflated entries, UTF-8 names, ZIP64 is not needed for
// folders of post pictures. macOS "__MACOSX" and dot-files are skipped.

export interface ZipEntry { path: string; size: number; read: () => Promise<Blob> }

const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', bmp: 'image/bmp' };
export const imageMime = (name: string) => MIME[(/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase()] || '';

export async function readZip(file: Blob): Promise<ZipEntry[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // end of central directory: last 0x06054b50 within the final 64 KB
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('File ZIP hỏng hoặc không phải ZIP.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const utf8 = new TextDecoder('utf-8'), latin = new TextDecoder('latin1');
  const out: ZipEntry[] = [];
  for (let k = 0; k < count && dv.getUint32(p, true) === 0x02014b50; k++) {
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const raw = buf.subarray(p + 46, p + 46 + nlen);
    const path = (flags & 0x800 ? utf8 : (() => { try { return new TextDecoder('utf-8', { fatal: true }); } catch { return latin; } })()).decode(raw);
    p += 46 + nlen + xlen + clen;
    if (path.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(path)) continue;
    out.push({
      path, size: usize,
      read: async () => {
        const ln = dv.getUint16(local + 26, true), lx = dv.getUint16(local + 28, true);
        const start = local + 30 + ln + lx;
        const data = buf.slice(start, start + csize);
        const type = imageMime(path) || 'application/octet-stream';
        if (method === 0) return new Blob([data], { type });
        if (method !== 8) throw new Error(`Kiểu nén ${method} chưa hỗ trợ`);
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Blob([await new Response(stream).arrayBuffer()], { type });
      },
    });
  }
  return out;
}
