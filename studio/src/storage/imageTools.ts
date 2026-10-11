// Pixel tools for cut-outs: remove flat/checkerboard backgrounds, split a sprite sheet into pieces, crop a region.
// Everything runs in the browser on a canvas; nothing leaves the machine except the optional AI model download.

export interface Box { x: number; y: number; w: number; h: number }

async function loadCanvas(blob: Blob, maxSide = 2400): Promise<{ c: HTMLCanvasElement; g: CanvasRenderingContext2D; scale: number }> {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
  return { c, g, scale };
}
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('png'))), 'image/png'));

/** Background candidate: transparent, or a light neutral (white, checkerboard greys, light flat backdrops). */
function isBgCandidate(d: Uint8ClampedArray, i: number): boolean {
  const a = d[i + 3]; if (a < 24) return true;
  const r = d[i], g = d[i + 1], b = d[i + 2];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max - min <= 28 && max >= 160;
}

/** Mask of background pixels connected to the image border (so whites inside the object survive). */
function edgeMask(d: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const mask = new Uint8Array(w * h);
  const cand = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) cand[p] = isBgCandidate(d, p * 4) ? 1 : 0;
  const stack: number[] = [];
  const push = (p: number) => { if (cand[p] && !mask[p]) { mask[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) {
    const p = stack.pop()!; const x = p % w, y = (p - x) / w;
    if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w);
  }
  return mask;
}

function bboxOfOpaque(d: Uint8ClampedArray, w: number, h: number, pad = 2): Box | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (x1 < 0) return null;
  return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: Math.min(w, x1 + pad + 1) - Math.max(0, x0 - pad), h: Math.min(h, y1 + pad + 1) - Math.max(0, y0 - pad) };
}

/** Remove a flat / checkerboard background connected to the edges, soften the edge, trim to the object. */
export async function removeBackground(blob: Blob): Promise<{ blob: Blob; bbox: Box; w: number; h: number }> {
  const { c, g } = await loadCanvas(blob);
  const w = c.width, h = c.height;
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  const mask = edgeMask(d, w, h);
  // alpha from the mask, then a 3×3 average on edge pixels so the cut is not jagged
  const alpha = new Uint8ClampedArray(w * h);
  for (let p = 0; p < w * h; p++) alpha[p] = mask[p] ? 0 : d[p * 4 + 3];
  const out = new Uint8ClampedArray(alpha);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const p = y * w + x;
    const n = mask[p - 1] + mask[p + 1] + mask[p - w] + mask[p + w];
    if (n && n < 4 && !mask[p]) { let sum = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += alpha[p + dy * w + dx]; out[p] = Math.round(sum / 9); }
  }
  for (let p = 0; p < w * h; p++) d[p * 4 + 3] = out[p];
  g.putImageData(img, 0, 0);
  const bbox = bboxOfOpaque(d, w, h) || { x: 0, y: 0, w, h };
  const oc = document.createElement('canvas'); oc.width = bbox.w; oc.height = bbox.h;
  oc.getContext('2d')!.drawImage(c, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
  return { blob: await toBlob(oc), bbox, w, h };
}

/** Crop a pixel rectangle out of an image (full resolution). */
export async function cropRegion(blob: Blob, box: Box): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.min(bmp.width - x, Math.round(box.w))), h = Math.max(1, Math.min(bmp.height - y, Math.round(box.h)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bmp, x, y, w, h, 0, 0, w, h); bmp.close();
  return toBlob(c);
}

/** Split a sprite sheet (several cut-outs on a flat background) into separate transparent PNGs, reading order. */
export async function splitSprites(blob: Blob, opts: { minSize?: number; max?: number } = {}): Promise<Blob[]> {
  const minSize = opts.minSize ?? 36, max = opts.max ?? 30;
  const full = await createImageBitmap(blob);
  const f = Math.min(1, 520 / Math.max(full.width, full.height));
  const sc = document.createElement('canvas'); sc.width = Math.max(1, Math.round(full.width * f)); sc.height = Math.max(1, Math.round(full.height * f));
  const sg = sc.getContext('2d', { willReadFrequently: true })!; sg.drawImage(full, 0, 0, sc.width, sc.height);
  const w = sc.width, h = sc.height; const d = sg.getImageData(0, 0, w, h).data;
  const bg = edgeMask(d, w, h);
  // connected components of foreground (8-neighbourhood), with a 2px dilation so drops/splashes stay with their object
  const fg = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) fg[p] = bg[p] ? 0 : 1;
  const dil = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (!fg[y * w + x]) continue; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < h && xx >= 0 && xx < w) dil[yy * w + xx] = 1; } }
  const seen = new Uint8Array(w * h);
  const boxes: (Box & { n: number })[] = [];
  for (let p0 = 0; p0 < w * h; p0++) {
    if (!dil[p0] || seen[p0]) continue;
    let x0 = w, y0 = h, x1 = 0, y1 = 0, n = 0; const stack = [p0]; seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop()!; const x = p % w, y = (p - x) / w; n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = y + dy, xx = x + dx; if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue; const q = yy * w + xx; if (dil[q] && !seen[q]) { seen[q] = 1; stack.push(q); } }
    }
    boxes.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, n });
  }
  // merge boxes that overlap (after a small margin), drop specks
  const margin = 4;
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.x - margin < b.x + b.w && b.x - margin < a.x + a.w && a.y - margin < b.y + b.h && b.y - margin < a.y + a.h) {
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        boxes[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y, n: a.n + b.n };
        boxes.splice(j, 1); merged = true; break;
      }
    }
  }
  const keep = boxes.filter((b) => b.w / f >= minSize && b.h / f >= minSize && b.n >= 40).sort((a, b) => (Math.abs(a.y - b.y) > 40 / f ? a.y - b.y : a.x - b.x)).slice(0, max);
  const out: Blob[] = [];
  for (const b of keep) {
    const pad = 6;
    const piece = await cropRegion(blob, { x: b.x / f - pad, y: b.y / f - pad, w: b.w / f + pad * 2, h: b.h / f + pad * 2 });
    out.push((await removeBackground(piece)).blob);
  }
  full.close();
  return out;
}

/** AI background removal (@imgly/background-removal, loaded from a CDN on first use; the model is ~40 MB). */
export async function removeBackgroundAI(blob: Blob, onProgress?: (msg: string) => void): Promise<{ blob: Blob; bbox: Box; w: number; h: number }> {
  const modUrl = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm';
  const mod = await import(/* @vite-ignore */ modUrl).catch(() => null) as { removeBackground?: (b: Blob, cfg?: unknown) => Promise<Blob> } | null;
  if (!mod?.removeBackground) throw new Error('Không tải được mô hình xoá nền AI (mạng/CDN). Dùng "Xoá nền" thường.');
  onProgress?.('Đang tải mô hình AI…');
  const res = await mod.removeBackground(blob, { progress: (key: string, cur: number, total: number) => onProgress?.(`${/model/i.test(key) ? 'Tải mô hình' : 'Xử lý'} ${total ? Math.round((cur / total) * 100) : 0}%`) });
  // trim the result to its opaque bounds like the fast path
  const { c, g } = await loadCanvas(res, 4000);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const bbox = bboxOfOpaque(d, c.width, c.height) || { x: 0, y: 0, w: c.width, h: c.height };
  const oc = document.createElement('canvas'); oc.width = bbox.w; oc.height = bbox.h;
  oc.getContext('2d')!.drawImage(c, bbox.x, bbox.y, bbox.w, bbox.h, 0, 0, bbox.w, bbox.h);
  return { blob: await toBlob(oc), bbox, w: c.width, h: c.height };
}
