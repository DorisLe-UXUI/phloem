// Vector graphics (icons, stickers, shapes, AI-drawn SVG) as image layers: the SVG source rides on the node so it can be
// recoloured and re-rasterised crisply; the renderer and the email export only ever see a PNG asset.
import type { Asset, ImageNode } from '../model/types';
import { assets } from '../storage/assets';

export const ICONIFY = 'https://api.iconify.design';
/** Icon sets the designer and the AI may use: permissive licences (MIT / ISC / Apache-2.0 / CC0). */
export const ICON_SETS = ['ph', 'lucide', 'tabler', 'mdi', 'material-symbols', 'ri'] as const;
export const STICKER_SETS = ['fluent-emoji'] as const;
export const BRAND_ICON_SET = 'simple-icons';

const svgCache = new Map<string, Promise<string>>();
/** Raw SVG of an Iconify icon ("ph:heart-fill"); monochrome sets come back with `currentColor`. */
export function iconSvg(id: string): Promise<string> {
  const [prefix, name] = id.split(':');
  if (!prefix || !name || !/^[a-z0-9-]+$/.test(prefix) || !/^[a-z0-9-]+$/.test(name)) return Promise.reject(new Error(`Icon không hợp lệ: ${id}`));
  let p = svgCache.get(id);
  if (!p) {
    p = fetch(`${ICONIFY}/${prefix}/${name}.svg`).then(async (r) => { const t = await r.text(); if (!r.ok || !t.startsWith('<svg')) throw new Error(`Không có icon ${id}`); return t; });
    p.catch(() => svgCache.delete(id));
    svgCache.set(id, p);
  }
  return p;
}
/** URL for an <img> preview tile. */
export const iconUrl = (id: string, color?: string | null) => { const [prefix, name] = id.split(':'); return `${ICONIFY}/${prefix}/${name}.svg${color ? `?color=${encodeURIComponent(color)}` : ''}`; };

export async function searchIcons(query: string, prefixes: readonly string[], limit = 96): Promise<string[]> {
  const q = query.trim(); if (!q) return [];
  const r = await fetch(`${ICONIFY}/search?query=${encodeURIComponent(q)}&limit=${limit}&prefixes=${prefixes.join(',')}`);
  if (!r.ok) throw new Error(`Iconify HTTP ${r.status}`);
  const j = (await r.json()) as { icons?: string[] };
  return j.icons || [];
}

/** Put a colour into an SVG: `currentColor` everywhere (and the root `color`), so monochrome art follows the pick. */
export function colorSvg(svg: string, color?: string | null): string {
  if (!color) return svg;
  return svg.replace(/<svg\b([^>]*)>/, (m, attrs: string) => `<svg${attrs.replace(/\scolor="[^"]*"/, '')} color="${color}">`).replace(/currentColor/g, color);
}

/** Natural aspect of an SVG from its viewBox (or width/height). */
export function svgAspect(svg: string): number {
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  if (vb) { const w = +vb[1], h = +vb[2]; if (w > 0 && h > 0) return w / h; }
  const w = /\swidth="([\d.]+)(px)?"/.exec(svg), h = /\sheight="([\d.]+)(px)?"/.exec(svg);
  return w && h && +w[1] > 0 && +h[1] > 0 ? +w[1] / +h[1] : 1;
}

/** Rasterise SVG markup to a PNG blob at w×h (the SVG is stretched to that box, like CSS `fill`). */
export async function rasterizeSvg(svg: string, w: number, h: number): Promise<Blob> {
  const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
  let src = svg.trim();
  if (!/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(src)) src = src.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  // force the raster size (Iconify ships width="1em"), keep the viewBox
  // (aspect kept as the SVG says: default "meet", our stretchable shapes carry preserveAspectRatio="none" themselves)
  src = src.replace(/<svg\b([^>]*)>/, (m, attrs: string) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, '')} width="${W}" height="${H}">`);
  const url = URL.createObjectURL(new Blob([src], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error('SVG lỗi, không vẽ được')); img.src = url; });
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d')!.drawImage(img, 0, 0, W, H);
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

/** Raster resolution for a vector shown at w×h: 3× (retina + room to grow), capped so big shapes stay light. */
export function rasterSize(w: number, h: number, max = 1600): { w: number; h: number } {
  const k = Math.min(3, max / Math.max(1, w, h));
  return { w: Math.max(8, Math.round(w * k)), h: Math.max(8, Math.round(h * k)) };
}

const assetCache = new Map<string, Promise<Asset>>();
/** One library asset per (svg, colour, size); identical art inserted twice reuses it. */
export function vectorAsset(svg: string, w: number, h: number, name: string, color?: string | null, temp = false): Promise<Asset> {
  const sz = rasterSize(w, h);
  const key = `${sz.w}x${sz.h}|${color || ''}|${svg.length}|${hashStr(svg)}|${temp ? 't' : ''}`;
  let p = assetCache.get(key);
  if (!p) {
    p = rasterizeSvg(colorSvg(svg, color), sz.w, sz.h).then((blob) => assets.add(blob, name, { src: { kind: 'graphic' }, temp }));
    p.catch(() => assetCache.delete(key));
    assetCache.set(key, p);
  }
  return p;
}

function hashStr(s: string): string { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h.toString(36); }

/** New asset for a vector image node after a colour change (or a resize past its raster's sharpness). */
export async function reraster(n: ImageNode, color?: string | null): Promise<string | null> {
  if (!n.vector) return null;
  const c = color === undefined ? n.vector.color ?? null : color;
  const a = await vectorAsset(n.vector.svg, n.w, n.h, n.name, c);
  return a.id;
}
