// Render the doc once at the export scale, then crop each slice. Same renderer as the editor => pixel-identical.
import type { ExportedSlice, SlicePlan } from '../../../src/shared/types';
import { fnv1a } from '../../../src/shared/hash';
import type { Brand, Doc } from '../model/types';
import { flat } from '../model/ops';
import { renderToCanvas } from './renderer';
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

export async function exportDocSlices(doc: Doc, brand: Brand, plan: SlicePlan, scale: 1 | 2, onProgress?: (done: number, total: number) => void): Promise<ExportedSlice[]> {
  await prepareDoc(doc, brand);
  const full = renderToCanvas(doc, brand, assets, scale);
  const out: ExportedSlice[] = [];
  for (let i = 0; i < plan.slices.length; i++) {
    const s = plan.slices[i];
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
