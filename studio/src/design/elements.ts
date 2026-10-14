// The "Thiết kế" library (Canva-style): shapes, lines and frames as native layers; SVG shapes, illustrations, icons and
// 3D stickers as recolourable vector images; ready-made graphics (sale burst, coupon, phone mockup, rating…) as groups;
// text styles; motion presets. Everything lands as ordinary Phloem layers, so it exports like the rest of the email.
import type { AnimKind, Brand, Color, GroupNode, ImageNode, Node, RectNode, TextNode } from '../model/types';
import { uid } from '../model/types';
import { textHeight } from '../render/textLayout';
import { iconSvg, vectorAsset, svgAspect } from './vector';

export type ElCat = 'shape' | 'svg' | 'graphic' | 'text';
export interface ElDef { id: string; label: string; cat: ElCat; /** tile preview: SVG markup using currentColor */ preview: string; make: (c: MakeCtx) => Promise<Node[]> | Node[] }
export interface MakeCtx { brand: Brand; color: string; at: { x: number; y: number }; docW: number }

const base = (name: string, x: number, y: number, w: number, h: number) => ({ id: uid('n'), name, x, y, w, h, visible: true, locked: false, opacity: 1, link: null, alt: '' });
export const R = (name: string, x: number, y: number, w: number, h: number, o: Partial<RectNode> = {}): RectNode => ({ ...base(name, x, y, w, h), type: 'rect', fill: null, gradient: null, stroke: null, radius: 0, ...o });
export function T(brand: Brand, text: string, x: number, y: number, w: number, o: Partial<TextNode> = {}): TextNode {
  const n: TextNode = { ...base(text.slice(0, 24) || 'Text', x, y, w, 20), type: 'text', text, fontFamily: 'heading', fontSize: 24, fontWeight: 700, italic: false, underline: false, strike: false, color: { token: 'ink' }, align: 'left', lineHeight: 1.15, letterSpacing: 0, autoHeight: true, vAlign: 'top', ...o };
  n.h = textHeight(n, brand);
  return n;
}
export function group(name: string, children: Node[]): GroupNode {
  const x = Math.min(...children.map((c) => c.x)), y = Math.min(...children.map((c) => c.y));
  return { ...base(name, x, y, Math.max(...children.map((c) => c.x + c.w)) - x, Math.max(...children.map((c) => c.y + c.h)) - y), type: 'group', children };
}
/** A vector image layer from SVG markup (rasterised; the source stays on the node for recolouring). */
export async function vec(name: string, svg: string, x: number, y: number, w: number, h: number, color: string | null, kind: 'shape' | 'graphic' | 'icon' | 'sticker' = 'shape', extra: Partial<ImageNode> = {}): Promise<ImageNode> {
  const a = await vectorAsset(svg, w, h, name, color);
  return { ...base(name, x, y, w, h), type: 'image', assetId: a.id, fit: kind === 'icon' || kind === 'sticker' ? 'contain' : 'fill', radius: 0, fill: null, overlay: null, alt: '', vector: { svg, color, kind }, ...extra };
}
/** Iconify icon / sticker as a layer, centred on `at`. */
export async function iconLayer(id: string, at: { x: number; y: number }, size: number, color: string | null): Promise<ImageNode> {
  const svg = await iconSvg(id);
  const ar = svgAspect(svg);
  const w = ar >= 1 ? size : Math.round(size * ar), h = ar >= 1 ? Math.round(size / ar) : size;
  const sticker = id.startsWith('fluent-emoji') || id.startsWith('noto');
  return vec(id.split(':')[1], svg, Math.round(at.x - w / 2), Math.round(at.y - h / 2), w, h, sticker ? null : color, sticker ? 'sticker' : 'icon');
}

/** Centre a set of layers on `at`. */
function centre(nodes: Node[], at: { x: number; y: number }): Node[] {
  const x0 = Math.min(...nodes.map((n) => n.x)), y0 = Math.min(...nodes.map((n) => n.y));
  const w = Math.max(...nodes.map((n) => n.x + n.w)) - x0, h = Math.max(...nodes.map((n) => n.y + n.h)) - y0;
  const dx = Math.round(at.x - w / 2 - x0), dy = Math.round(at.y - h / 2 - y0);
  const move = (n: Node): Node => (n.type === 'group' ? { ...n, x: n.x + dx, y: n.y + dy, children: n.children.map(move) } : { ...n, x: n.x + dx, y: n.y + dy });
  return nodes.map(move);
}

// ---------- SVG shapes (currentColor = the picked colour; preserveAspectRatio none = stretch with the frame) ----------
const S = (vb: string, body: string, stretch = true) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"${stretch ? ' preserveAspectRatio="none"' : ''}>${body}</svg>`;
const poly = (n: number, r1: number, r2: number, rot = -90) => { const pts: string[] = []; for (let i = 0; i < n * 2; i++) { const r = i % 2 ? r2 : r1; const a = ((rot + (180 / n) * i) * Math.PI) / 180; pts.push(`${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`); } return pts.join(' '); };
const scallop = (n: number, r: number, bump: number) => { let d = ''; for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI * 2; const x = 50 + r * Math.cos(a), y = 50 + r * Math.sin(a); if (!i) d += `M${x.toFixed(2)},${y.toFixed(2)}`; else { const am = ((i - 0.5) / n) * Math.PI * 2; d += ` Q${(50 + (r + bump) * Math.cos(am)).toFixed(2)},${(50 + (r + bump) * Math.sin(am)).toFixed(2)} ${x.toFixed(2)},${y.toFixed(2)}`; } } return d + 'Z'; };

export const SVG_SHAPES: { id: string; label: string; svg: string; w: number; h: number; stretch?: boolean }[] = [
  { id: 'triangle', label: 'Tam giác', svg: S('0 0 100 100', '<path d="M50 4 L96 92 L4 92Z" fill="currentColor"/>'), w: 160, h: 140 },
  { id: 'star', label: 'Ngôi sao', svg: S('0 0 100 100', `<polygon points="${poly(5, 48, 20)}" fill="currentColor"/>`, false), w: 150, h: 150 },
  { id: 'burst', label: 'Nổ sao', svg: S('0 0 100 100', `<polygon points="${poly(16, 49, 38, 0)}" fill="currentColor"/>`, false), w: 170, h: 170 },
  { id: 'sparkle', label: 'Lấp lánh', svg: S('0 0 100 100', '<path d="M50 0 C54 34 66 46 100 50 C66 54 54 66 50 100 C46 66 34 54 0 50 C34 46 46 34 50 0Z" fill="currentColor"/>', false), w: 90, h: 90 },
  { id: 'heart', label: 'Trái tim', svg: S('0 0 100 92', '<path d="M50 90 C20 68 2 50 2 28 C2 12 14 2 28 2 C38 2 46 8 50 16 C54 8 62 2 72 2 C86 2 98 12 98 28 C98 50 80 68 50 90Z" fill="currentColor"/>', false), w: 140, h: 129 },
  { id: 'hexagon', label: 'Lục giác', svg: S('0 0 100 100', '<polygon points="50,2 92,26 92,74 50,98 8,74 8,26" fill="currentColor"/>', false), w: 150, h: 150 },
  { id: 'diamond', label: 'Thoi', svg: S('0 0 100 100', '<path d="M50 2 L98 50 L50 98 L2 50Z" fill="currentColor"/>'), w: 140, h: 140 },
  { id: 'seal', label: 'Huy hiệu', svg: S('0 0 100 100', `<path d="${scallop(18, 44, 6)}" fill="currentColor"/>`, false), w: 150, h: 150 },
  { id: 'flower', label: 'Bông hoa', svg: S('0 0 100 100', `<path d="${scallop(8, 34, 26)}" fill="currentColor"/>`, false), w: 150, h: 150 },
  { id: 'blob1', label: 'Blob 1', svg: S('0 0 200 200', '<path transform="translate(100 100)" d="M44.7,-58.6C57.5,-49.5,67,-35.4,71.6,-19.4C76.2,-3.4,75.9,14.5,68.4,28.5C60.9,42.5,46.2,52.6,30.6,59.9C15,67.2,-1.5,71.7,-18.2,68.9C-34.9,66.1,-51.8,56,-62.6,41.1C-73.4,26.2,-78.1,6.5,-74.3,-11C-70.5,-28.5,-58.2,-43.8,-43.4,-52.7C-28.6,-61.6,-14.3,-64.1,1.2,-65.6C16.7,-67.1,33.4,-67.7,44.7,-58.6Z" fill="currentColor"/>'), w: 220, h: 220 },
  { id: 'blob2', label: 'Blob 2', svg: S('0 0 200 200', '<path transform="translate(100 100)" d="M38.9,-51.4C50.9,-44.7,61.2,-33.5,66.9,-19.8C72.6,-6.1,73.6,10.1,67.6,23.2C61.6,36.3,48.5,46.3,34.6,54.6C20.7,62.9,6,69.5,-10.4,70.8C-26.8,72.1,-44.9,68.1,-56.3,57C-67.7,45.9,-72.4,27.7,-73.4,10C-74.4,-7.7,-71.7,-24.9,-62.6,-37.4C-53.5,-49.9,-38,-57.7,-23.6,-62.5C-9.2,-67.3,4.1,-69.1,16.3,-65.7C28.5,-62.3,26.9,-58.1,38.9,-51.4Z" fill="currentColor"/>'), w: 220, h: 220 },
  { id: 'blob3', label: 'Blob 3', svg: S('0 0 200 200', '<path transform="translate(100 100)" d="M52.3,-62.1C66.4,-50.6,75.4,-32.7,78.1,-14.1C80.8,4.5,77.1,23.8,66.9,38.4C56.7,53,40,62.9,22.1,68.6C4.2,74.3,-14.9,75.8,-31.4,69.4C-47.9,63,-61.8,48.7,-69.6,31.6C-77.4,14.5,-79.1,-5.4,-72.8,-22.1C-66.5,-38.8,-52.2,-52.3,-36.5,-63.3C-20.8,-74.3,-3.7,-82.8,12.8,-80.7C29.3,-78.6,38.2,-73.6,52.3,-62.1Z" fill="currentColor"/>'), w: 220, h: 220 },
  { id: 'wave', label: 'Sóng', svg: S('0 0 600 80', '<path d="M0 40 C75 0 150 0 225 40 C300 80 375 80 450 40 C525 0 562 0 600 20 L600 80 L0 80Z" fill="currentColor"/>'), w: 600, h: 80 },
  { id: 'wave2', label: 'Sóng mềm', svg: S('0 0 600 60', '<path d="M0 30 C100 60 200 0 300 30 C400 60 500 0 600 30 L600 60 L0 60Z" fill="currentColor"/>'), w: 600, h: 60 },
  { id: 'arc', label: 'Vòng cung', svg: S('0 0 200 100', '<path d="M0 100 A100 100 0 0 1 200 100Z" fill="currentColor"/>'), w: 200, h: 100 },
  { id: 'quarter', label: 'Góc tròn', svg: S('0 0 100 100', '<path d="M0 0 L100 0 A100 100 0 0 1 0 100Z" fill="currentColor"/>'), w: 120, h: 120 },
  { id: 'ring', label: 'Vòng tròn', svg: S('0 0 100 100', '<circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" stroke-width="8"/>', false), w: 140, h: 140 },
  { id: 'plus', label: 'Dấu cộng', svg: S('0 0 100 100', '<path d="M40 4 H60 V40 H96 V60 H60 V96 H40 V60 H4 V40 H40Z" fill="currentColor"/>', false), w: 80, h: 80 },
  { id: 'squiggle', label: 'Gạch nguệch', svg: S('0 0 300 40', '<path d="M6 26 C30 4 50 4 66 22 S102 40 122 18 S160 0 180 20 S220 40 240 18 S280 6 294 20" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>'), w: 260, h: 34 },
  { id: 'underline', label: 'Gạch chân vẽ tay', svg: S('0 0 300 30', '<path d="M6 20 C80 6 180 4 294 14 M30 26 C110 16 200 16 270 22" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>'), w: 260, h: 26 },
  { id: 'zigzag', label: 'Zigzag', svg: S('0 0 300 30', '<path d="M4 24 L28 6 L52 24 L76 6 L100 24 L124 6 L148 24 L172 6 L196 24 L220 6 L244 24 L268 6 L296 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>'), w: 260, h: 26 },
  { id: 'arrow', label: 'Mũi tên', svg: S('0 0 200 60', '<path d="M6 30 H180 M150 8 L184 30 L150 52" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'), w: 180, h: 54 },
  { id: 'curl-arrow', label: 'Mũi tên vẽ tay', svg: S('0 0 160 120', '<path d="M10 20 C70 0 120 30 96 64 C80 86 46 70 66 50 C86 30 130 52 140 100 M122 88 L140 104 L150 80" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>', false), w: 150, h: 112 },
  { id: 'dots', label: 'Lưới chấm', svg: S('0 0 120 120', Array.from({ length: 36 }, (_, i) => `<circle cx="${10 + (i % 6) * 20}" cy="${10 + Math.floor(i / 6) * 20}" r="3.2" fill="currentColor"/>`).join(''), false), w: 120, h: 120 },
  { id: 'bubble', label: 'Bong bóng chat', svg: S('0 0 120 100', '<path d="M14 6 H106 Q116 6 116 16 V62 Q116 72 106 72 H48 L26 94 L30 72 H14 Q4 72 4 62 V16 Q4 6 14 6Z" fill="currentColor"/>'), w: 180, h: 150 },
  { id: 'ribbon', label: 'Ruy băng', svg: S('0 0 300 70', '<path d="M0 14 H36 V56 H0 L14 35Z M300 14 H264 V56 H300 L286 35Z" fill="currentColor" opacity=".7"/><path d="M28 6 H272 V54 H28Z" fill="currentColor"/>'), w: 300, h: 70 },
  { id: 'tag', label: 'Nhãn giá', svg: S('0 0 160 80', '<path d="M40 4 H150 Q156 4 156 10 V70 Q156 76 150 76 H40 L4 40Z" fill="currentColor"/><circle cx="34" cy="40" r="7" fill="#fff"/>'), w: 180, h: 90 },
  { id: 'lightning', label: 'Tia sét', svg: S('0 0 80 120', '<path d="M50 2 L8 70 H38 L28 118 L74 46 H44Z" fill="currentColor"/>', false), w: 80, h: 120 },
];

const box = (p: string) => `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">${p}</svg>`;
/** A tile preview built from one of the SVG shapes (nested svg) with an optional label on top. */
const shapeBox = (id: string, label = '', fs = 8) => { const sh = SVG_SHAPES.find((x) => x.id === id)!; const inner = sh.svg.replace('<svg ', '<svg x="2" y="2" width="36" height="36" '); return box(`${inner}${label ? `<text x="20" y="${20 + fs * 0.36}" font-size="${fs}" font-weight="800" text-anchor="middle" fill="#fff" font-family="Inter, sans-serif">${label}</text>` : ''}`); };
const thumbOfSvg = (svg: string) => svg.replace(' preserveAspectRatio="none"', '');

// ---------- the library ----------
export const ELEMENTS: ElDef[] = [
  // native shapes (editable fill / gradient / corner radius in the right panel)
  { id: 'rect', label: 'Hình chữ nhật', cat: 'shape', preview: box('<rect x="5" y="9" width="30" height="22" fill="currentColor"/>'), make: ({ color, at }) => [R('Hình chữ nhật', at.x - 110, at.y - 70, 220, 140, { fill: color })] },
  { id: 'rounded', label: 'Bo góc', cat: 'shape', preview: box('<rect x="5" y="9" width="30" height="22" rx="7" fill="currentColor"/>'), make: ({ color, at }) => [R('Bo góc', at.x - 110, at.y - 70, 220, 140, { fill: color, radius: 24 })] },
  { id: 'circle', label: 'Hình tròn', cat: 'shape', preview: box('<circle cx="20" cy="20" r="14" fill="currentColor"/>'), make: ({ color, at }) => [R('Hình tròn', at.x - 80, at.y - 80, 160, 160, { fill: color, radius: 80 })] },
  { id: 'pill', label: 'Viên thuốc', cat: 'shape', preview: box('<rect x="4" y="13" width="32" height="14" rx="7" fill="currentColor"/>'), make: ({ color, at }) => [R('Pill', at.x - 110, at.y - 30, 220, 60, { fill: color, radius: 999 })] },
  { id: 'arch', label: 'Mái vòm', cat: 'shape', preview: box('<path d="M10 34 V18 A10 10 0 0 1 30 18 V34Z" fill="currentColor"/>'), make: ({ color, at }) => [R('Mái vòm', at.x - 90, at.y - 120, 180, 240, { fill: color, radius: 90, radii: [90, 90, 0, 0] })] },
  { id: 'leaf', label: 'Chiếc lá', cat: 'shape', preview: box('<path d="M6 34 V20 A14 14 0 0 1 20 6 H34 V20 A14 14 0 0 1 20 34Z" fill="currentColor"/>'), make: ({ color, at }) => [R('Chiếc lá', at.x - 90, at.y - 90, 180, 180, { fill: color, radius: 90, radii: [90, 0, 90, 0] })] },
  { id: 'line', label: 'Đường kẻ', cat: 'shape', preview: box('<rect x="4" y="19" width="32" height="2" fill="currentColor"/>'), make: ({ color, at }) => [R('Đường kẻ', at.x - 120, at.y - 1, 240, 2, { fill: color })] },
  { id: 'line-thick', label: 'Vạch dày', cat: 'shape', preview: box('<rect x="4" y="17" width="32" height="6" rx="3" fill="currentColor"/>'), make: ({ color, at }) => [R('Vạch', at.x - 60, at.y - 3, 120, 6, { fill: color, radius: 3 })] },
  { id: 'outline', label: 'Khung viền', cat: 'shape', preview: box('<rect x="6" y="9" width="28" height="22" rx="5" fill="none" stroke="currentColor" stroke-width="2.5"/>'), make: ({ color, at }) => [R('Khung viền', at.x - 110, at.y - 70, 220, 140, { stroke: { color, width: 2 }, radius: 16 })] },
  { id: 'glass', label: 'Thẻ kính', cat: 'shape', preview: box('<rect x="6" y="9" width="28" height="22" rx="5" fill="currentColor" fill-opacity=".25" stroke="currentColor" stroke-opacity=".7"/>'), make: ({ at }) => [R('Kính mờ', at.x - 130, at.y - 80, 260, 160, { fill: 'rgba(255,255,255,0.22)', stroke: { color: 'rgba(255,255,255,0.55)', width: 1 }, radius: 22, backdropBlur: 20, shadow: { blur: 30, y: 12, color: '#000000', opacity: 0.16 } })] },
  { id: 'glass-dark', label: 'Kính tối', cat: 'shape', preview: box('<rect x="6" y="9" width="28" height="22" rx="5" fill="#000" fill-opacity=".45" stroke="currentColor" stroke-opacity=".5"/>'), make: ({ at }) => [R('Kính tối', at.x - 130, at.y - 80, 260, 160, { fill: 'rgba(10,10,14,0.38)', stroke: { color: 'rgba(255,255,255,0.18)', width: 1 }, radius: 22, backdropBlur: 24 })] },
  { id: 'glow', label: 'Quầng sáng', cat: 'shape', preview: box('<defs><radialGradient id="g"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs><circle cx="20" cy="20" r="17" fill="url(#g)"/>'), make: ({ color, at }) => [R('Quầng sáng', at.x - 170, at.y - 170, 340, 340, { gradient: { from: color, to: 'rgba(0,0,0,0)', angle: 0, radial: true, stops: [{ color, at: 0 }, { color: hexA(color, 0.35), at: 0.45 }, { color: hexA(color, 0), at: 1 }] } })] },
  { id: 'gradient', label: 'Dải gradient', cat: 'shape', preview: box('<defs><linearGradient id="l" x1="0" x2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="#FFC53D"/></linearGradient></defs><rect x="4" y="10" width="32" height="20" rx="4" fill="url(#l)"/>'), make: ({ at, docW }) => [R('Gradient', 0, at.y - 110, docW, 220, { gradient: { from: { token: 'primary' }, to: { token: 'accent' }, angle: 20 } })] },
  {
    id: 'mesh', label: 'Nền mesh', cat: 'shape', preview: box('<rect x="3" y="7" width="34" height="26" rx="4" fill="#1b1530"/><circle cx="12" cy="14" r="9" fill="currentColor" opacity=".7"/><circle cx="30" cy="26" r="9" fill="#FFC53D" opacity=".6"/>'),
    make: ({ brand, at, docW }) => {
      const y = at.y - 200;
      return [group('Nền mesh', [
        R('Nền', 0, y, docW, 400, { fill: { token: 'ink' } }),
        R('Quầng 1', -80, y - 60, 380, 380, { gradient: { from: brand.primary, to: 'rgba(0,0,0,0)', angle: 0, radial: true, stops: [{ color: hexA(brand.primary, 0.85), at: 0 }, { color: hexA(brand.primary, 0), at: 1 }] } }),
        R('Quầng 2', docW - 300, y + 120, 380, 380, { gradient: { from: brand.accent, to: 'rgba(0,0,0,0)', angle: 0, radial: true, stops: [{ color: hexA(brand.accent, 0.75), at: 0 }, { color: hexA(brand.accent, 0), at: 1 }] } }),
        R('Quầng 3', docW / 2 - 150, y - 120, 300, 300, { gradient: { from: '#FFFFFF', to: 'rgba(0,0,0,0)', angle: 0, radial: true, stops: [{ color: 'rgba(255,255,255,0.22)', at: 0 }, { color: 'rgba(255,255,255,0)', at: 1 }] } }),
      ])];
    },
  },
  // SVG shapes
  ...SVG_SHAPES.map((sh): ElDef => ({ id: sh.id, label: sh.label, cat: 'svg', preview: thumbOfSvg(sh.svg).replace('<svg ', '<svg width="40" height="40" '), make: async ({ color, at }) => [await vec(sh.label, sh.svg, Math.round(at.x - sh.w / 2), Math.round(at.y - sh.h / 2), sh.w, sh.h, color, 'shape')] })),
  // ready-made graphics
  {
    id: 'sale-burst', label: 'Sale burst', cat: 'graphic', preview: shapeBox('burst', '-30%', 9),
    make: async ({ brand, color, at }) => {
      const burst = await vec('Nổ sao', SVG_SHAPES.find((s) => s.id === 'burst')!.svg, 0, 0, 170, 170, color, 'shape');
      const big = T(brand, '-30%', 0, 52, 170, { fontSize: 44, fontWeight: 900, align: 'center', color: '#FFFFFF', lineHeight: 1 });
      const small = T(brand, 'SALE', 0, 100, 170, { fontSize: 14, fontWeight: 800, align: 'center', color: '#FFFFFF', letterSpacing: 3, fontFamily: 'brand' });
      return centre([{ ...group('Sale burst', [burst, big, small]), anim: { kind: 'pulse', dur: 1.2 } }], at);
    },
  },
  {
    id: 'seal-badge', label: 'Huy hiệu MỚI', cat: 'graphic', preview: shapeBox('seal', 'MỚI', 9),
    make: async ({ brand, color, at }) => {
      const s = await vec('Huy hiệu', SVG_SHAPES.find((x) => x.id === 'seal')!.svg, 0, 0, 130, 130, color, 'shape');
      const t = T(brand, 'MỚI', 0, 48, 130, { fontSize: 28, fontWeight: 900, align: 'center', color: '#FFFFFF', lineHeight: 1 });
      return centre([{ ...group('Huy hiệu', [s, t]), anim: { kind: 'spin', dur: 2.4 } }], at);
    },
  },
  {
    id: 'ribbon-label', label: 'Ruy băng chữ', cat: 'graphic', preview: box('<path d="M2 14 H10 V28 H2 L6 21Z M38 14 H30 V28 H38 L34 21Z" fill="currentColor" opacity=".7"/><rect x="8" y="11" width="24" height="14" fill="currentColor"/>'),
    make: async ({ brand, color, at }) => {
      const r = await vec('Ruy băng', SVG_SHAPES.find((x) => x.id === 'ribbon')!.svg, 0, 0, 300, 70, color, 'shape');
      const t = T(brand, 'BÁN CHẠY NHẤT', 28, 18, 244, { fontSize: 18, fontWeight: 800, align: 'center', color: '#FFFFFF', letterSpacing: 2, lineHeight: 1.2 });
      return centre([group('Ruy băng', [r, t])], at);
    },
  },
  {
    id: 'price-tag', label: 'Nhãn giá', cat: 'graphic', preview: box('<path d="M12 10 H34 V30 H12 L4 20Z" fill="currentColor"/><circle cx="11" cy="20" r="2" fill="#fff"/>'),
    make: async ({ brand, color, at }) => {
      const r = await vec('Nhãn giá', SVG_SHAPES.find((x) => x.id === 'tag')!.svg, 0, 0, 200, 100, color, 'shape');
      const t = T(brand, '199K', 56, 26, 130, { fontSize: 40, fontWeight: 900, align: 'center', color: '#FFFFFF', lineHeight: 1.1 });
      return centre([group('Nhãn giá', [r, t])], at);
    },
  },
  {
    id: 'coupon', label: 'Mã giảm giá', cat: 'graphic', preview: box('<rect x="3" y="11" width="34" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 2"/><text x="20" y="23" font-size="7" font-weight="800" text-anchor="middle" fill="currentColor">CODE</text>'),
    make: ({ brand, color, at }) => {
      const W = 440, H = 120;
      const nodes: Node[] = [
        R('Phiếu', 0, 0, W, H, { fill: { token: 'soft' }, radius: 16 }),
        R('Viền đứt', 8, 8, W - 16, H - 16, { stroke: { color, width: 2 }, radius: 12, opacity: 0.7 }),
        R('Lỗ trái', -18, H / 2 - 18, 36, 36, { fill: { token: 'bg' }, radius: 18 }),
        R('Lỗ phải', W - 18, H / 2 - 18, 36, 36, { fill: { token: 'bg' }, radius: 18 }),
        T(brand, 'NHẬP MÃ', 40, 24, W - 80, { fontSize: 12, fontWeight: 700, letterSpacing: 3, align: 'center', color: { token: 'muted' }, fontFamily: 'brand' }),
        T(brand, 'GIAM30', 40, 46, W - 80, { fontSize: 40, fontWeight: 900, letterSpacing: 4, align: 'center', color, lineHeight: 1 }),
      ];
      return centre([group('Mã giảm giá', nodes)], at);
    },
  },
  {
    id: 'cta', label: 'Nút bấm', cat: 'graphic', preview: box('<rect x="4" y="13" width="32" height="14" rx="7" fill="currentColor"/><path d="M27 20 h4 m-2 -2 l2 2 l-2 2" stroke="#fff" stroke-width="1.5" fill="none"/>'),
    make: async ({ brand, color, at }) => {
      const bg = R('Nền nút', 0, 0, 220, 58, { fill: color, radius: 999, shadow: { blur: 26, y: 10, color: color.startsWith('#') ? color : '#000000', opacity: 0.4 } });
      const t = T(brand, 'Mua ngay', 0, 17, 220, { fontSize: 18, fontWeight: 800, align: 'center', color: { token: 'onPrimary' }, fontFamily: 'brand', lineHeight: 1.3 });
      const g = group('Button · Mua ngay', [bg, t]); g.link = brand.links?.website || null;
      return centre([g], at);
    },
  },
  {
    id: 'rating', label: 'Đánh giá sao', cat: 'graphic', preview: box(`<g fill="currentColor">${[4, 12, 20, 28].map((x) => `<polygon transform="translate(${x - 2} 14) scale(.09)" points="${poly(5, 48, 20)}"/>`).join('')}</g>`),
    make: async ({ brand, color, at }) => {
      const stars = await Promise.all([0, 1, 2, 3, 4].map((i) => iconLayer('ph:star-fill', { x: 14 + i * 30, y: 14 }, 26, color)));
      const t = T(brand, '4.9/5 · 2.300 đánh giá', 166, 4, 220, { fontSize: 15, fontWeight: 600, color: { token: 'ink' }, fontFamily: 'brand', lineHeight: 1.4 });
      return centre([group('Đánh giá', [...stars, t])], at);
    },
  },
  {
    id: 'countdown', label: 'Đếm ngược', cat: 'graphic', preview: box('<g fill="currentColor"><rect x="2" y="12" width="8" height="12" rx="2"/><rect x="12" y="12" width="8" height="12" rx="2"/><rect x="22" y="12" width="8" height="12" rx="2"/><rect x="32" y="12" width="6" height="12" rx="2"/></g>'),
    make: ({ brand, color, at }) => {
      const items = [['02', 'NGÀY'], ['14', 'GIỜ'], ['36', 'PHÚT'], ['08', 'GIÂY']];
      const nodes: Node[] = [];
      items.forEach(([v, l], i) => {
        const x = i * 104;
        nodes.push(R(`Ô ${l}`, x, 0, 92, 96, { fill: color, radius: 16 }));
        nodes.push(T(brand, v, x, 14, 92, { fontSize: 40, fontWeight: 900, align: 'center', color: { token: 'onPrimary' }, lineHeight: 1.1 }));
        nodes.push(T(brand, l, x, 64, 92, { fontSize: 11, fontWeight: 700, letterSpacing: 2, align: 'center', color: { token: 'onPrimary' }, fontFamily: 'brand', opacity: 0.85 }));
      });
      return centre([group('Đếm ngược', nodes)], at);
    },
  },
  {
    id: 'polaroid', label: 'Khung polaroid', cat: 'graphic', preview: box('<rect x="9" y="5" width="22" height="28" rx="1.5" fill="#fff" stroke="currentColor"/><rect x="12" y="8" width="16" height="16" fill="currentColor" opacity=".5"/>'),
    make: ({ brand, at }) => {
      const nodes: Node[] = [
        R('Giấy', 0, 0, 240, 290, { fill: '#FFFFFF', shadow: { blur: 30, y: 14, color: '#000000', opacity: 0.2 } }),
        { ...base('Ảnh', 16, 16, 208, 208), type: 'image', assetId: null, fit: 'cover', radius: 0, fill: null, overlay: null } as ImageNode,
        T(brand, 'Mùa thu 2026', 16, 238, 208, { fontSize: 22, fontWeight: 600, align: 'center', color: '#222222', fontFamily: 'Dancing Script' }),
      ];
      const g = group('Polaroid', nodes);
      return centre([rotateGroup(g, -4)], at);
    },
  },
  {
    id: 'phone', label: 'Điện thoại', cat: 'graphic', preview: box('<rect x="12" y="3" width="16" height="34" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="17" y="6" width="6" height="2" rx="1" fill="currentColor"/>'),
    make: ({ at }) => {
      const nodes: Node[] = [
        R('Thân máy', 0, 0, 240, 480, { fill: '#111111', radius: 40, shadow: { blur: 40, y: 20, color: '#000000', opacity: 0.35 } }),
        { ...base('Màn hình', 10, 10, 220, 460), type: 'image', assetId: null, fit: 'cover', radius: 32, fill: null, overlay: null } as ImageNode,
        R('Tai thỏ', 86, 20, 68, 20, { fill: '#111111', radius: 10 }),
      ];
      return centre([group('Điện thoại', nodes)], at);
    },
  },
  {
    id: 'browser', label: 'Trình duyệt', cat: 'graphic', preview: box('<rect x="4" y="8" width="32" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 14 H36" stroke="currentColor" stroke-width="2"/><circle cx="8" cy="11" r="1" fill="currentColor"/><circle cx="11" cy="11" r="1" fill="currentColor"/>'),
    make: ({ at }) => {
      const nodes: Node[] = [
        R('Khung', 0, 0, 480, 320, { fill: '#FFFFFF', radius: 14, stroke: { color: '#E3E3E3', width: 1 }, shadow: { blur: 34, y: 16, color: '#000000', opacity: 0.18 } }),
        R('Thanh', 0, 0, 480, 34, { fill: '#F2F2F2', radius: 14, radii: [14, 14, 0, 0] }),
        R('Đỏ', 14, 12, 10, 10, { fill: '#FF5F57', radius: 5 }), R('Vàng', 30, 12, 10, 10, { fill: '#FEBC2E', radius: 5 }), R('Xanh', 46, 12, 10, 10, { fill: '#28C840', radius: 5 }),
        { ...base('Nội dung', 0, 34, 480, 286), type: 'image', assetId: null, fit: 'cover', radius: 14, radii: [0, 0, 14, 14], fill: null, overlay: null } as ImageNode,
      ];
      return centre([group('Trình duyệt', nodes)], at);
    },
  },
  {
    id: 'quote-card', label: 'Thẻ trích dẫn', cat: 'graphic', preview: box('<rect x="4" y="7" width="32" height="26" rx="4" fill="currentColor" opacity=".25"/><text x="9" y="22" font-size="16" font-weight="900" fill="currentColor">“</text>'),
    make: ({ brand, color, at }) => {
      const nodes: Node[] = [
        R('Thẻ', 0, 0, 480, 220, { fill: { token: 'soft' }, radius: 24 }),
        T(brand, '“', 32, 6, 80, { fontSize: 96, fontWeight: 900, color, lineHeight: 1 }),
        T(brand, 'Mua lần thứ ba rồi, vẫn mê như lần đầu. Đóng gói quá chỉn chu.', 40, 74, 400, { fontSize: 20, fontWeight: 600, color: { token: 'ink' }, lineHeight: 1.4 }),
        T(brand, '— MINH ANH, HÀ NỘI', 40, 170, 400, { fontSize: 12, fontWeight: 700, letterSpacing: 2.5, color: { token: 'muted' }, fontFamily: 'brand' }),
      ];
      return centre([group('Trích dẫn', nodes)], at);
    },
  },
  {
    id: 'marquee', label: 'Băng chữ chạy', cat: 'graphic', preview: box('<rect x="2" y="14" width="36" height="12" fill="currentColor"/><text x="4" y="23" font-size="7" font-weight="800" fill="#fff">SALE ✦ SALE</text>'),
    make: ({ brand, color, docW, at }) => {
      const y = Math.round(at.y - 26);
      const band = R('Băng', 0, y, docW, 52, { fill: color });
      const t = T(brand, 'FREESHIP  ✦  -30% TOÀN BỘ  ✦  QUÀ TẶNG KÈM  ✦  ĐỔI TRẢ 30 NGÀY  ✦', 0, y + 14, docW, { fontSize: 18, fontWeight: 800, letterSpacing: 2, color: { token: 'onPrimary' }, lineHeight: 1.3, anim: { kind: 'marquee' } });
      return [group('Băng chữ chạy', [band, t])];
    },
  },
  {
    id: 'sparkles', label: 'Cụm lấp lánh', cat: 'graphic', preview: box('<path d="M14 6 C15 13 17 15 24 16 C17 17 15 19 14 26 C13 19 11 17 4 16 C11 15 13 13 14 6Z M30 20 C30.6 24 31.5 25 35 25.5 C31.5 26 30.6 27 30 31 C29.4 27 28.5 26 25 25.5 C28.5 25 29.4 24 30 20Z" fill="currentColor"/>'),
    make: async ({ color, at }) => {
      const svg = SVG_SHAPES.find((x) => x.id === 'sparkle')!.svg;
      const a = await vec('Lấp lánh 1', svg, 0, 0, 70, 70, color, 'shape', { anim: { kind: 'pulse', dur: 1.2 } });
      const b = await vec('Lấp lánh 2', svg, 64, 50, 36, 36, color, 'shape', { anim: { kind: 'blink', dur: 1.2 } });
      const c = await vec('Lấp lánh 3', svg, 30, 78, 24, 24, color, 'shape', { anim: { kind: 'blink', dur: 0.8 } });
      return centre([group('Lấp lánh', [a, b, c])], at);
    },
  },
  {
    id: 'confetti', label: 'Confetti', cat: 'graphic', preview: box('<g fill="currentColor"><rect x="6" y="8" width="4" height="8" transform="rotate(20 8 12)"/><circle cx="24" cy="10" r="2.5"/><rect x="30" y="22" width="4" height="8" transform="rotate(-30 32 26)"/><circle cx="12" cy="28" r="2"/><rect x="18" y="18" width="3" height="7" transform="rotate(50 19 21)"/></g>'),
    make: ({ brand, at }) => {
      const cols = [brand.primary, brand.accent, '#FFC53D', '#FF5FA2', '#3DD6FF'];
      const nodes: Node[] = [];
      for (let i = 0; i < 18; i++) {
        const x = (i * 97) % 360, y = (i * 53) % 200, c = cols[i % cols.length];
        nodes.push(i % 3 === 0 ? R('Hạt', x, y, 10, 10, { fill: c, radius: 5 }) : R('Mảnh', x, y, 7, 18, { fill: c, radius: 2, rotate: (i * 37) % 180 - 90 }));
        if (i % 4 === 0) nodes[nodes.length - 1].anim = { kind: 'float', dur: 2.4 };
      }
      return centre([group('Confetti', nodes)], at);
    },
  },
  {
    id: 'live', label: 'Nhãn LIVE', cat: 'graphic', preview: box('<rect x="5" y="13" width="30" height="14" rx="7" fill="currentColor" opacity=".2"/><circle cx="12" cy="20" r="3" fill="#FF3B30"/><text x="16" y="23" font-size="7" font-weight="800" fill="currentColor">LIVE</text>'),
    make: ({ brand, at }) => {
      const nodes: Node[] = [
        R('Nền', 0, 0, 118, 38, { fill: 'rgba(255,59,48,0.12)', radius: 999, stroke: { color: 'rgba(255,59,48,0.45)', width: 1 } }),
        { ...R('Chấm', 16, 13, 12, 12, { fill: '#FF3B30', radius: 6 }), anim: { kind: 'blink', dur: 1.2 } },
        T(brand, 'ĐANG LIVE', 36, 10, 76, { fontSize: 13, fontWeight: 800, letterSpacing: 1.5, color: '#FF3B30', fontFamily: 'brand', lineHeight: 1.3 }),
      ];
      return centre([group('LIVE', nodes)], at);
    },
  },
  // text styles
  { id: 't-display', label: 'Tiêu đề lớn', cat: 'text', preview: '', make: ({ brand, at, docW }) => centre([T(brand, 'Tiêu đề thật lớn', 0, 0, Math.min(520, docW - 40), { fontSize: 56, fontWeight: 800, lineHeight: 1.02, letterSpacing: -1 })], at) },
  { id: 't-h2', label: 'Tiêu đề', cat: 'text', preview: '', make: ({ brand, at }) => centre([T(brand, 'Tiêu đề mục', 0, 0, 440, { fontSize: 34, fontWeight: 700, lineHeight: 1.1 })], at) },
  { id: 't-sub', label: 'Tiêu đề phụ', cat: 'text', preview: '', make: ({ brand, at }) => centre([T(brand, 'Một dòng tiêu đề phụ rõ ràng', 0, 0, 440, { fontSize: 22, fontWeight: 600, lineHeight: 1.25, color: { token: 'ink' } })], at) },
  { id: 't-body', label: 'Đoạn văn', cat: 'text', preview: '', make: ({ brand, at }) => centre([T(brand, 'Đoạn văn ngắn kể thêm về lợi ích: cụ thể, dễ đọc, hai đến ba câu là đủ.', 0, 0, 440, { fontSize: 16, fontWeight: 400, lineHeight: 1.6, color: { token: 'muted' }, fontFamily: 'brand' })], at) },
  { id: 't-eyebrow', label: 'Nhãn nhỏ', cat: 'text', preview: '', make: ({ brand, at, color }) => centre([T(brand, 'BỘ SƯU TẬP MỚI', 0, 0, 300, { fontSize: 12, fontWeight: 700, letterSpacing: 3, color, fontFamily: 'brand' })], at) },
  { id: 't-number', label: 'Số khổng lồ', cat: 'text', preview: '', make: ({ brand, at, color }) => centre([T(brand, '-50%', 0, 0, 420, { fontSize: 128, fontWeight: 900, lineHeight: 0.95, letterSpacing: -4, color, align: 'center' })], at) },
  { id: 't-3d', label: 'Chữ 3D', cat: 'text', preview: '', make: ({ brand, at, color }) => centre([T(brand, 'SIÊU SALE', 0, 0, 480, { fontSize: 64, fontWeight: 900, lineHeight: 1, align: 'center', color, effect: { kind: 'extrude', depth: 8, angle: 50 } })], at) },
  { id: 't-neon', label: 'Chữ neon', cat: 'text', preview: '', make: ({ brand, at, color }) => centre([T(brand, 'Đêm nay', 0, 0, 420, { fontSize: 60, fontWeight: 700, lineHeight: 1.05, align: 'center', color, effect: { kind: 'neon' } })], at) },
  { id: 't-outline', label: 'Chữ viền', cat: 'text', preview: '', make: ({ brand, at, color }) => centre([T(brand, 'NEW IN', 0, 0, 420, { fontSize: 76, fontWeight: 900, lineHeight: 1, align: 'center', color, effect: { kind: 'outline' } })], at) },
  { id: 't-shadow', label: 'Bóng dài', cat: 'text', preview: '', make: ({ brand, at, color }) => centre([T(brand, 'HOT DEAL', 0, 0, 440, { fontSize: 64, fontWeight: 900, lineHeight: 1, align: 'center', color, effect: { kind: 'shadow', depth: 18, angle: 45 } })], at) },
];

function rotateGroup(g: GroupNode, deg: number): GroupNode {
  return { ...g, children: g.children.map((c) => (c.type === 'rect' || c.type === 'image' || c.type === 'text' ? { ...c, rotate: deg } : c)) };
}
/** "#RRGGBB" + alpha → rgba(); other strings pass through. */
export function hexA(c: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(c); if (!m) return c;
  const n = parseInt(m[1], 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- icons & stickers ----------
export const ICONS = ['arrow-right', 'arrow-up-right', 'check-circle', 'star', 'heart', 'lightning', 'fire', 'gift', 'tag', 'percent', 'seal-percent', 'shopping-bag', 'shopping-cart', 'storefront', 'truck', 'package', 'credit-card', 'wallet', 'coin', 'ticket', 'clock', 'hourglass', 'calendar', 'timer', 'map-pin', 'phone', 'envelope', 'chat-circle', 'headset', 'instagram-logo', 'facebook-logo', 'tiktok-logo', 'youtube-logo', 'x-logo', 'linkedin-logo', 'globe', 'house', 'user', 'users', 'handshake', 'sparkle', 'crown', 'diamond', 'trophy', 'medal', 'rocket', 'target', 'chart-line-up', 'leaf', 'plant', 'flower', 'tree', 'coffee', 'cake', 'cookie', 'pizza', 'hamburger', 'ice-cream', 'wine', 'sun', 'moon', 'snowflake', 'rainbow', 'drop', 'waves', 'umbrella', 'airplane', 'camera', 'music-note', 'play-circle', 'game-controller', 'book-open', 'graduation-cap', 'lightbulb', 'palette', 'paint-brush', 't-shirt', 'dress', 'sneaker', 'baby', 'dog', 'cat', 'paw-print', 'bicycle', 'car', 'heartbeat', 'barbell', 'first-aid', 'shield-check', 'lock', 'recycle', 'smiley', 'hand-heart', 'thumbs-up', 'hand-waving', 'seal-check', 'megaphone', 'bell', 'confetti', 'balloon', 'magic-wand', 'eye', 'info', 'question'];
export const ICON_STYLES = [{ v: '', label: 'Nét' }, { v: '-bold', label: 'Đậm' }, { v: '-fill', label: 'Đặc' }, { v: '-duotone', label: 'Hai tông' }, { v: '-light', label: 'Mảnh' }] as const;
export const STICKERS = ['fire', 'sparkles', 'party-popper', 'confetti-ball', 'wrapped-gift', 'red-heart', 'sparkling-heart', 'star', 'glowing-star', 'shooting-star', 'high-voltage', 'collision', 'hundred-points', 'rocket', 'crown', 'gem-stone', 'money-bag', 'shopping-bags', 'shopping-cart', 'label', 'megaphone', 'bell', 'alarm-clock', 'hourglass-not-done', 'stopwatch', 'calendar', 'package', 'delivery-truck', 'credit-card', 'trophy', '1st-place-medal', 'thumbs-up', 'clapping-hands', 'waving-hand', 'ok-hand', 'raising-hands', 'flexed-biceps', 'smiling-face-with-heart-eyes', 'star-struck', 'eyes', 'kiss-mark', 'love-letter', 'balloon', 'birthday-cake', 'cupcake', 'doughnut', 'ice-cream', 'hot-beverage', 'bubble-tea', 'tropical-drink', 'cocktail-glass', 'pizza', 'strawberry', 'lemon', 'peach', 'watermelon', 'avocado', 'herb', 'four-leaf-clover', 'cherry-blossom', 'sunflower', 'tulip', 'bouquet', 'potted-plant', 'sun', 'rainbow', 'beach-with-umbrella', 'airplane', 'house', 'mobile-phone', 'laptop', 'headphone', 'camera-with-flash', 'light-bulb', 'books', 'graduation-cap', 'artist-palette', 'video-game', 'joystick', 'game-die', 'puzzle-piece', 'teddy-bear', 'soccer-ball', 'basketball', 't-shirt', 'dress', 'running-shoe', 'high-heeled-shoe', 'handbag', 'ring', 'lipstick', 'lotion-bottle', 'robot', 'alien-monster', 'unicorn', 'butterfly', 'panda', 'dog-face', 'cat-face', 'christmas-tree', 'jack-o-lantern', 'red-envelope', 'moon-cake', 'new-button', 'free-button', 'cool-button', 'sos-button'];

export interface AnimPreset { kind: AnimKind | 'none'; label: string; textOnly?: boolean; loop?: boolean }
export const ANIM_PRESETS: AnimPreset[] = [
  { kind: 'none', label: 'Không' },
  { kind: 'fade', label: 'Hiện dần' }, { kind: 'up', label: 'Trượt lên' }, { kind: 'down', label: 'Trượt xuống' },
  { kind: 'left', label: 'Từ phải vào' }, { kind: 'right', label: 'Từ trái vào' }, { kind: 'pop', label: 'Nảy ra' }, { kind: 'wipe', label: 'Mở dần' },
  { kind: 'type', label: 'Gõ chữ', textOnly: true }, { kind: 'marquee', label: 'Chữ chạy', textOnly: true, loop: true },
  { kind: 'pulse', label: 'Nhịp đập', loop: true }, { kind: 'float', label: 'Lơ lửng', loop: true }, { kind: 'spin', label: 'Xoay tròn', loop: true },
  { kind: 'shake', label: 'Lắc', loop: true }, { kind: 'blink', label: 'Nhấp nháy', loop: true },
];

export function colorChoices(b: Brand): { c: string; label: string }[] {
  const seen = new Set<string>();
  return [{ c: b.primary, label: 'Primary' }, { c: b.accent, label: 'Accent' }, { c: b.ink, label: 'Chữ' }, { c: b.muted, label: 'Phụ' }, { c: b.soft, label: 'Nền nhạt' }, { c: '#FFFFFF', label: 'Trắng' }, { c: '#111111', label: 'Đen' }, { c: '#FF5C39', label: 'Cam' }, { c: '#FFC53D', label: 'Vàng' }, { c: '#FF5FA2', label: 'Hồng' }, { c: '#3DD6FF', label: 'Xanh' }]
    .filter((x) => /^#[0-9a-f]{6}$/i.test(x.c) && !seen.has(x.c.toUpperCase()) && seen.add(x.c.toUpperCase()));
}

export type { Color };
