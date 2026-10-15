// Render the doc once at the export scale, then crop each slice. Same renderer as the editor => pixel-identical.
import type { ExportedSlice, SlicePlan } from '../../../src/shared/types';
import { fnv1a } from '../../../src/shared/hash';
import type { Brand, Doc, Node } from '../model/types';
import { LOOP_CYCLE, LOOP_KINDS } from '../model/types';
import { bounds, flat } from '../model/ops';
import { renderDoc, renderToCanvas } from './renderer';
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

/** Animated layers intersecting a rect: when their motion starts/ends, and whether any of them loops forever. */
function animSpan(nodes: Node[], r: { x: number; y: number; w: number; h: number }): { start: number; end: number; loop: boolean } | null {
  let start = Infinity, end = 0, loop = false, any = false;
  const hits = (b: { x: number; y: number; w: number; h: number }) => b.x < r.x + r.w && r.x < b.x + b.w && b.y < r.y + r.h && r.y < b.y + b.h;
  const walk = (list: Node[]) => { for (const n of list) { if (!n.visible) continue; if (n.anim && hits(bounds(n))) { any = true; if (LOOP_KINDS.has(n.anim.kind)) loop = true; else { if (n.anim.kind === 'type') loop = true; start = Math.min(start, n.anim.delay ?? 0); end = Math.max(end, (n.anim.delay ?? 0) + (n.anim.dur ?? 0.8)); } } if (n.type === 'group') walk(n.children); } };
  walk(nodes);
  if (!any) return null;
  if (!Number.isFinite(start)) { start = 0; end = LOOP_CYCLE; } // loops only: exactly one seamless cycle
  return { start, end: Math.max(end, start + 0.3), loop };
}

/** Encode one slice as an animated GIF (1x). Frames run from the block's first motion to its last, so a block that
 *  starts late on the canvas timeline still starts at once in the email. Frame 0 and the last frame are the finished
 *  (static) design: clients that show only the first frame (Outlook desktop) get the full composition, and the hold
 *  state is always complete. Later frames carry only the pixels that changed (transparent elsewhere, "do not dispose");
 *  identical frames fold into a longer delay. Reveal-style blocks play once and hold; typing/marquee blocks loop. */
async function sliceToGif(doc: Doc, brand: Brand, s: { x: number; y: number; w: number; h: number }, span: { start: number; end: number; loop: boolean }, fps = 10): Promise<Uint8Array> {
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const t0 = span.start, len = Math.min(6, span.end - span.start);
  const n = Math.max(2, Math.round(len * fps) + 1);
  const W = Math.max(1, Math.round(s.w)), H = Math.max(1, Math.round(s.h));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const render = (t: number | undefined) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    renderDoc(ctx, doc, brand, assets, { scale: 1, ox: -Math.round(s.x), oy: -Math.round(s.y), editor: false, t });
    return ctx.getImageData(0, 0, W, H).data;
  };
  const TR = 255; // reserved transparent index
  const pad = (p: number[][]) => { while (p.length < 256) p.push([0, 0, 0]); return p; };
  const frames: { index: Uint8Array; palette: number[][]; delay: number }[] = [];
  const step = Math.round(1000 / fps);
  const still = render(undefined); // finished design, no animation applied
  let prev: Uint8ClampedArray = still;
  { const palette = quantize(still, 255, { format: 'rgb565' }); frames.push({ index: applyPalette(still, palette, 'rgb565'), palette: pad(palette), delay: span.loop ? 800 : 600 }); }
  const push = (cur: Uint8ClampedArray, delay: number): void => {
    const mask = new Uint8Array(W * H); let changed = 0;
    for (let p = 0, q = 0; p < mask.length; p++, q += 4) if (cur[q] !== prev[q] || cur[q + 1] !== prev[q + 1] || cur[q + 2] !== prev[q + 2] || cur[q + 3] !== prev[q + 3]) { mask[p] = 1; changed++; }
    if (!changed) { frames[frames.length - 1].delay += delay; return; }
    // palette from the changed pixels only, so moving parts keep their colours
    const sub = new Uint8ClampedArray(changed * 4);
    for (let p = 0, q = 0, o = 0; p < mask.length; p++, q += 4) if (mask[p]) { sub[o++] = cur[q]; sub[o++] = cur[q + 1]; sub[o++] = cur[q + 2]; sub[o++] = cur[q + 3]; }
    const palette = quantize(sub, 255, { format: 'rgb565' });
    const index = applyPalette(cur, palette, 'rgb565');
    for (let p = 0; p < mask.length; p++) if (!mask[p]) index[p] = TR;
    frames.push({ index, palette: pad(palette), delay });
    prev = cur;
  };
  for (let i = 0; i < n; i++) { push(render(t0 + i / fps), step); if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0)); }
  push(still, step); // always end on the finished design (a layer delayed past the window still lands)
  if (span.loop) frames[frames.length - 1].delay += 1200;
  const gif = GIFEncoder();
  frames.forEach((f, i) => gif.writeFrame(f.index, W, H, { palette: f.palette, delay: f.delay, repeat: span.loop ? 0 : -1, dispose: 1, transparent: i > 0, transparentIndex: TR }));
  gif.finish();
  return gif.bytes();
}

const GIF_SOFT_KB = 500;
/** All animated slices of one email together: past this, the heaviest block loses frames, then its motion. */
const GIF_TOTAL_KB = 1500;
type Rect = { x: number; y: number; w: number; h: number };
const union = (a: Rect, b: Rect): Rect => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

export async function exportDocSlices(doc: Doc, brand: Brand, plan: SlicePlan, scale: 1 | 2, onProgress?: (done: number, total: number) => void, gifFps = 10): Promise<ExportedSlice[]> {
  await prepareDoc(doc, brand);
  const full = renderToCanvas(doc, brand, assets, scale);
  // Animated regions: all slices of one kept block share a clock (its first→last motion) and a frame rate, and only the
  // slices an animated layer actually touches become GIFs (gutters beside moving cards stay PNG).
  const groups = new Map<number, Rect>();
  for (const s of plan.slices) if (s.keep !== undefined) groups.set(s.keep, groups.has(s.keep) ? union(groups.get(s.keep)!, s) : { x: s.x, y: s.y, w: s.w, h: s.h });
  const spanOf = new Map<number, { start: number; end: number; loop: boolean } | null>();
  for (const [k, r] of groups) spanOf.set(k, animSpan(doc.nodes, r));
  const gifBytes = new Map<string, Uint8Array>();
  const blocks: { k: number; fps: number; enc: Map<string, Uint8Array>; members: typeof plan.slices; span: { start: number; end: number; loop: boolean } }[] = [];
  const encode = async (members: typeof plan.slices, span: { start: number; end: number; loop: boolean }, fps: number) => { const enc = new Map<string, Uint8Array>(); for (const s of members) enc.set(s.key, await sliceToGif(doc, brand, s, span, fps)); return enc; };
  const weight = (enc: Map<string, Uint8Array>) => [...enc.values()].reduce((a, b) => a + b.length, 0);
  let done = 0;
  for (const [k, span] of spanOf) {
    if (!span) continue;
    const members = plan.slices.filter((s) => s.keep === k && animSpan(doc.nodes, s));
    let fps = gifFps;
    for (;;) {
      const enc = await encode(members, span, fps);
      const heaviest = Math.max(0, ...[...enc.values()].map((b) => b.length));
      const next = Math.round(fps * 0.7);
      if (heaviest <= GIF_SOFT_KB * 1024 || next < 4) { blocks.push({ k, fps, enc, members, span }); break; }
      fps = next; // the whole block drops its frame rate together, so sibling slices never tear at a seam
    }
    done += members.length; onProgress?.(Math.min(done, plan.slices.length), plan.slices.length);
  }
  // whole-email budget: thin the heaviest block's frames; at the floor, it becomes a still (PNG/JPG like the rest)
  for (let guard = 0; guard < 12; guard++) {
    const total = blocks.reduce((a, b) => a + weight(b.enc), 0);
    if (total <= GIF_TOTAL_KB * 1024 || !blocks.length) break;
    const b = blocks.reduce((m, x) => (weight(x.enc) > weight(m.enc) ? x : m));
    const next = Math.round(b.fps * 0.7);
    if (next >= 4) { b.fps = next; b.enc = await encode(b.members, b.span, next); }
    else blocks.splice(blocks.indexOf(b), 1);
  }
  for (const b of blocks) for (const [key, bytes] of b.enc) gifBytes.set(key, bytes);
  const out: ExportedSlice[] = [];
  const fctx = full.getContext('2d', { willReadFrequently: true })!;
  for (let i = 0; i < plan.slices.length; i++) {
    const s = plan.slices[i];
    if (s.text) { done++; continue; } // live HTML text: no picture
    const bg = edgeColor(fctx, s, scale);
    const g = gifBytes.get(s.key);
    if (g) { out.push({ key: s.key, bytes: g, format: 'GIF', hash: fnv1a(g), w: s.w, h: s.h, scale: 1, bg }); continue; }
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s.w * scale)); c.height = Math.max(1, Math.round(s.h * scale));
    c.getContext('2d')!.drawImage(full, Math.round(s.x * scale), Math.round(s.y * scale), c.width, c.height, 0, 0, c.width, c.height);
    const bytes = await canvasToBytes(c);
    out.push({ key: s.key, bytes, format: 'PNG', hash: fnv1a(bytes), w: s.w, h: s.h, scale, bg });
    done++; onProgress?.(Math.min(done, plan.slices.length), plan.slices.length);
    if (i % 8 === 7) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
  }
  return out;
}

/** Most common colour (5-bit buckets) along a slice's bottom row and right column: the colour a seam would expose. */
function edgeColor(ctx: CanvasRenderingContext2D, s: { x: number; y: number; w: number; h: number }, scale: number): string | undefined {
  try {
    const x0 = Math.round(s.x * scale), y0 = Math.round(s.y * scale), w = Math.max(1, Math.round(s.w * scale)), h = Math.max(1, Math.round(s.h * scale));
    const bottom = ctx.getImageData(x0, y0 + h - 1, w, 1).data, right = ctx.getImageData(x0 + w - 1, y0, 1, h).data;
    const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
    const add = (d: Uint8ClampedArray) => { for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 200) continue; const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3); const e = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 }; e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2]; counts.set(k, e); } };
    add(bottom); add(right);
    let best: { n: number; r: number; g: number; b: number } | null = null;
    for (const e of counts.values()) if (!best || e.n > best.n) best = e;
    if (!best) return undefined;
    const hx = (v: number) => Math.round(v / best!.n).toString(16).padStart(2, '0');
    return `#${hx(best.r)}${hx(best.g)}${hx(best.b)}`;
  } catch { return undefined; }
}

export async function renderDocPng(doc: Doc, brand: Brand, scale = 1): Promise<Uint8Array> {
  await prepareDoc(doc, brand);
  return canvasToBytes(renderToCanvas(doc, brand, assets, scale));
}
