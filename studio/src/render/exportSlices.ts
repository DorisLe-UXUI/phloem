// Render the doc once at the export scale, then crop each slice. Same renderer as the editor => pixel-identical.
import type { ExportedSlice, SlicePlan } from '../../../src/shared/types';
import { fnv1a } from '../../../src/shared/hash';
import type { Brand, Doc, Node } from '../model/types';
import { animBlocks, flat } from '../model/ops';
import { animCycle, renderDoc, renderToCanvas } from './renderer';
import { assets } from '../storage/assets';
import { ensureFonts } from './fonts';

function canvasToBytes(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? b.arrayBuffer().then((ab) => res(new Uint8Array(ab))) : rej(new Error('toBlob failed'))), 'image/png'));
}

export async function prepareDoc(doc: Doc, brand: Brand): Promise<void> {
  const ids = flat(doc.nodes).filter((n) => n.type === 'image' && n.assetId).map((n) => (n as { assetId: string }).assetId);
  await assets.ensure(ids);
  const fams = flat(doc.nodes).filter((n) => n.type === 'text').map((n) => { const f = (n as { fontFamily: string }).fontFamily; return f === 'brand' ? brand.fontFamily : f === 'heading' ? brand.headingFamily : f; });
  ensureFonts(fams);
  await document.fonts.ready;
}

/** Encode one slice as an animated GIF (1x, looping). Frame 0 is the finished design so clients that show only the
 *  first frame (Outlook desktop) still get the full composition; later frames carry only the pixels that changed
 *  (transparent elsewhere, "do not dispose"), and frames identical to the previous one fold into a longer delay. */
async function sliceToGif(doc: Doc, brand: Brand, s: { x: number; y: number; w: number; h: number }, fps = 10): Promise<Uint8Array> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const cycle = Math.min(6, animCycle(doc.nodes));
  const n = Math.max(2, Math.round(cycle * fps));
  const W = Math.max(1, Math.round(s.w)), H = Math.max(1, Math.round(s.h));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const render = (t: number) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    renderDoc(ctx, doc, brand, assets, { scale: 1, ox: -Math.round(s.x), oy: -Math.round(s.y), editor: false, t });
    return ctx.getImageData(0, 0, W, H).data;
  };
  const TR = 255; // reserved transparent index
  const pad = (p: number[][]) => { while (p.length < 256) p.push([0, 0, 0]); return p; };
  const frames: { index: Uint8Array; palette: number[][]; delay: number }[] = [];
  const step = Math.round(1000 / fps);
  let prev = render(cycle); // finished state
  { const palette = quantize(prev, 255, { format: 'rgb565' }); frames.push({ index: applyPalette(prev, palette, 'rgb565'), palette: pad(palette), delay: 800 }); }
  for (let i = 0; i < n; i++) {
    const cur = render(i / fps);
    const delay = step + (i === n - 1 ? 1200 : 0);
    const mask = new Uint8Array(W * H); let changed = 0;
    for (let p = 0, q = 0; p < mask.length; p++, q += 4) if (cur[q] !== prev[q] || cur[q + 1] !== prev[q + 1] || cur[q + 2] !== prev[q + 2] || cur[q + 3] !== prev[q + 3]) { mask[p] = 1; changed++; }
    if (!changed) { frames[frames.length - 1].delay += delay; continue; }
    // palette from the changed pixels only, so moving parts keep their colours
    const sub = new Uint8ClampedArray(changed * 4);
    for (let p = 0, q = 0, o = 0; p < mask.length; p++, q += 4) if (mask[p]) { sub[o++] = cur[q]; sub[o++] = cur[q + 1]; sub[o++] = cur[q + 2]; sub[o++] = cur[q + 3]; }
    const palette = quantize(sub, 255, { format: 'rgb565' });
    const index = applyPalette(cur, palette, 'rgb565');
    for (let p = 0; p < mask.length; p++) if (!mask[p]) index[p] = TR;
    frames.push({ index, palette: pad(palette), delay });
    prev = cur;
    if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
  }
  const gif = GIFEncoder();
  frames.forEach((f, i) => gif.writeFrame(f.index, W, H, { palette: f.palette, delay: f.delay, repeat: 0, dispose: 1, transparent: i > 0, transparentIndex: TR }));
  gif.finish();
  return gif.bytes();
}

/** Animated slices: encode at `fps`; if the GIF is still heavier than `GIF_SOFT_KB` drop the frame rate and retry (email weight beats smoothness). */
const GIF_SOFT_KB = 650;
async function gifWithinBudget(doc: Doc, brand: Brand, s: { x: number; y: number; w: number; h: number }, fps: number): Promise<Uint8Array> {
  let bytes = await sliceToGif(doc, brand, s, fps);
  for (const f of [Math.round(fps * 0.7), Math.round(fps * 0.5)]) { if (bytes.length <= GIF_SOFT_KB * 1024 || f < 4) break; bytes = await sliceToGif(doc, brand, s, f); }
  return bytes;
}

export async function exportDocSlices(doc: Doc, brand: Brand, plan: SlicePlan, scale: 1 | 2, onProgress?: (done: number, total: number) => void, gifFps = 10): Promise<ExportedSlice[]> {
  await prepareDoc(doc, brand);
  const full = renderToCanvas(doc, brand, assets, scale);
  const moving = animBlocks(doc.nodes);
  const hits = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const out: ExportedSlice[] = [];
  for (let i = 0; i < plan.slices.length; i++) {
    const s = plan.slices[i];
    if (moving.some((r) => hits(r, s))) {
      // animated region → GIF (1x so the email stays light; Outlook shows the final frame as a still)
      const bytes = await gifWithinBudget(doc, brand, s, gifFps);
      out.push({ key: s.key, bytes, format: 'GIF', hash: fnv1a(bytes), w: s.w, h: s.h, scale: 1 });
      onProgress?.(i + 1, plan.slices.length);
      continue;
    }
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s.w * scale)); c.height = Math.max(1, Math.round(s.h * scale));
    c.getContext('2d')!.drawImage(full, Math.round(s.x * scale), Math.round(s.y * scale), c.width, c.height, 0, 0, c.width, c.height);
    const bytes = await canvasToBytes(c);
    out.push({ key: s.key, bytes, format: 'PNG', hash: fnv1a(bytes), w: s.w, h: s.h, scale });
    onProgress?.(i + 1, plan.slices.length);
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
  }
  return out;
}

export async function renderDocPng(doc: Doc, brand: Brand, scale = 1): Promise<Uint8Array> {
  await prepareDoc(doc, brand);
  return canvasToBytes(renderToCanvas(doc, brand, assets, scale));
}
