// Image helpers for the UI iframe: PNG -> JPG transcoding with a quality knob, data URLs for previews.
import type { ExportedSlice, ImageFormat } from '../shared/types';
import { fnv1a } from '../shared/hash';

/** Blob from a Uint8Array view (copies the exact byte range; keeps TS happy about ArrayBufferLike). */
export function toBlob(bytes: Uint8Array, mime: string): Blob {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([ab], { type: mime });
}

export function bytesToUrl(bytes: Uint8Array, mime = 'image/png'): string {
  return URL.createObjectURL(toBlob(bytes, mime));
}

async function decode(bytes: Uint8Array): Promise<ImageBitmap | HTMLImageElement> {
  const blob = toBlob(bytes, 'image/png');
  if ('createImageBitmap' in window) return createImageBitmap(blob);
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('decode failed'));
    img.src = URL.createObjectURL(blob);
  });
}

export async function toJpeg(bytes: Uint8Array, quality: number): Promise<Uint8Array> {
  const img = await decode(bytes);
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff'; // JPG has no alpha
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img as CanvasImageSource, 0, 0);
  const blob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', Math.min(1, Math.max(0.3, quality / 100))));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Apply the profile's image format. Slices come out of Figma as PNG. */
export async function finalizeSlices(slices: ExportedSlice[], format: ImageFormat, jpgQuality: number): Promise<ExportedSlice[]> {
  if (format === 'PNG') return slices;
  const out: ExportedSlice[] = [];
  for (const s of slices) {
    if (s.format === 'GIF') { out.push(s); continue; } // animated slices stay GIF
    try {
      const jpg = await toJpeg(s.bytes, jpgQuality);
      // keep PNG if it is actually smaller (flat colour slices)
      if (jpg.length < s.bytes.length) out.push({ ...s, bytes: jpg, format: 'JPG', hash: fnv1a(jpg) });
      else out.push(s);
    } catch { out.push(s); }
  }
  return out;
}

export function mimeOf(format: ImageFormat): string { return format === 'JPG' ? 'image/jpeg' : format === 'GIF' ? 'image/gif' : 'image/png'; }
export function extOf(format: ImageFormat): string { return format === 'JPG' ? 'jpg' : format === 'GIF' ? 'gif' : 'png'; }
