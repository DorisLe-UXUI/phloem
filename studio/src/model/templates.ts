// Blocks and templates as document nodes. Every colour references a brand token, so picking a palette re-themes
// the whole email (bands, cards, eyebrows, prices, buttons, footer). Blocks take optional content so templates and
// the AI composer can fill real copy, products, images and links.
import type { BlockKind, TemplateKind } from '../../../src/shared/types';
import type { Brand, Color, Doc, EmailFields, GroupNode, ImageNode, Node, RectNode, Shadow, TextNode, Vibe } from './types';
import { isDarkColor, luminance, resolveColor, uid } from './types';
import { layoutText, textHeight } from '../render/textLayout';
import { syncGroup } from './ops';
import { assets } from '../storage/assets';

export const W = 600;
const PAD = 24;

/** Design personality derived from brand.vibe: radii, shadows, pills, decorative shapes, headline scale. */
export interface Theme {
  radius: number; btnRadius: number; shadow: boolean; glow: boolean; heroScale: number; eyebrowPill: boolean; blobs: boolean; stroke: boolean; btnH: number;
  /** Headline letter-spacing in px (negative = tight display type). */
  track: number;
  /** Vertical rhythm multiplier (luxury breathes more). */
  space: number;
  /** Big numerals instead of small circles for step numbers. */
  bigNumerals: boolean;
}
export function themeFor(vibe?: Vibe, shape?: Brand['shape']): Theme {
  const base = baseTheme(vibe);
  if (!shape) return base;
  return { ...base, ...(shape.radius != null ? { radius: Math.max(0, Math.min(28, shape.radius)) } : {}), ...(shape.btnRadius != null ? { btnRadius: shape.btnRadius >= 20 ? 999 : Math.max(0, Math.min(16, shape.btnRadius)) } : {}), ...(shape.track != null ? { track: Math.max(-2, Math.min(2, shape.track)) } : {}), ...(shape.radius != null && shape.radius < 4 ? { stroke: true, shadow: false, glow: false } : {}) };
}
function baseTheme(vibe?: Vibe): Theme {
  switch (vibe) {
    case 'playful': return { radius: 22, btnRadius: 999, shadow: true, glow: true, heroScale: 1.1, eyebrowPill: true, blobs: true, stroke: false, btnH: 52, track: -0.3, space: 1, bigNumerals: false };
    case 'bold': return { radius: 14, btnRadius: 999, shadow: true, glow: true, heroScale: 1.25, eyebrowPill: true, blobs: true, stroke: false, btnH: 54, track: -1.2, space: 1, bigNumerals: true };
    case 'luxury': return { radius: 4, btnRadius: 4, shadow: false, glow: false, heroScale: 1.15, eyebrowPill: false, blobs: false, stroke: true, btnH: 50, track: 0.2, space: 1.25, bigNumerals: true };
    case 'editorial': return { radius: 6, btnRadius: 6, shadow: false, glow: false, heroScale: 1.05, eyebrowPill: false, blobs: false, stroke: true, btnH: 48, track: -0.4, space: 1.1, bigNumerals: true };
    default: return { radius: 14, btnRadius: 10, shadow: true, glow: false, heroScale: 1.05, eyebrowPill: false, blobs: false, stroke: false, btnH: 50, track: -0.5, space: 1, bigNumerals: true };
  }
}
/** Strong lift for poster-style image cards (hero-band / hero-center). */
const posterShadow = (T: Theme): Shadow | null => (T.shadow ? { blur: 44, y: 20, color: '#000000', opacity: 0.28 } : T.stroke ? { blur: 30, y: 14, color: '#000000', opacity: 0.14 } : null);
const darken = (hex: string, t: number) => { const m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return '#07100b'; const n = parseInt(m[1], 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - t))); return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join(''); };
const cardShadow = (T: Theme): Shadow | null => (T.shadow ? { blur: 24, y: 10, color: '#000000', opacity: 0.1 } : null);
const cardStroke = (T: Theme): RectNode['stroke'] => (T.stroke ? { color: { token: 'line' }, width: 1 } : null);
const btnShadow = (T: Theme, brand: Brand): Shadow | null => (T.glow ? { blur: 24, y: 8, color: brand.primary, opacity: 0.38 } : T.shadow ? { blur: 14, y: 6, color: '#000000', opacity: 0.16 } : null);
/** Soft light pools inside a band (radial fades, never flat discs; kept inside the band so neighbours stay clean). */
function blobs(T: Theme, y: number, bandH: number, light: boolean): RectNode[] {
  if (!T.blobs || bandH < 180) return [];
  const sz = Math.min(380, bandH - 16);
  const a = light ? 0.5 : 0.28;
  return [
    rect({ x: W - Math.round(sz * 0.8), y: y + 8, w: sz, h: sz, fill: null, gradient: { from: { token: 'accent', alpha: a }, to: { token: 'accent', alpha: 0 }, angle: 0, radial: true }, name: 'Glow' }),
    rect({ x: 0, y: y + bandH - sz - 8, w: Math.round(sz * 0.8), h: Math.round(sz * 0.8), fill: null, gradient: { from: light ? '#FFFFFF3a' : '#FFFFFF14', to: '#FFFFFF00', angle: 0, radial: true }, name: 'Glow' }),
  ];
}
/** A round "-30%" style badge (two short lines) pinned on a photo. */
function badgeCircle(brand: Brand, label: string, cx: number, cy: number, d: number, dark: boolean): Node[] {
  const t = text(brand, label, { x: cx - d / 2 + 6, y: cy - d / 2, w: d - 12, h: d, fontSize: label.length > 8 ? 13 : 16, fontWeight: 800, fontFamily: 'heading', align: 'center', autoHeight: false, vAlign: 'middle', lineHeight: 1.1, color: dark ? { token: 'ink' } : { token: 'onPrimary' }, name: 'Badge' });
  const bg = rect({ x: cx - d / 2, y: cy - d / 2, w: d, h: d, fill: dark ? { token: 'bg' } : { token: 'accent' }, radius: 999, name: 'Badge circle', shadow: { blur: 18, y: 8, color: '#000000', opacity: 0.22 } });
  return [bg, t];
}

const base = (name: string) => ({ id: uid(), name, visible: true, locked: false, opacity: 1, link: null as string | null, alt: '' });

export function text(brand: Brand, t0: unknown, o: Partial<TextNode> & { x: number; y: number; w: number }): TextNode {
  const t = t0 == null ? '' : String(t0); // the AI sometimes sends numbers (prices) or nothing at all
  const n: TextNode = {
    ...base(o.name ?? t.slice(0, 24)), type: 'text', text: t, h: 0,
    fontFamily: o.fontFamily ?? 'brand', fontSize: o.fontSize ?? 15, fontWeight: o.fontWeight ?? 400, italic: false, underline: false, strike: false,
    color: o.color ?? { token: 'ink' }, align: o.align ?? 'left', lineHeight: o.lineHeight ?? 1.45, letterSpacing: o.letterSpacing ?? 0,
    autoHeight: true, vAlign: 'top', ...o,
  } as TextNode;
  n.h = o.h ?? textHeight(n, brand);
  return n;
}

export function rect(o: Partial<RectNode> & { x: number; y: number; w: number; h: number }): RectNode {
  return { ...base(o.name ?? 'Rectangle'), type: 'rect', fill: { token: 'soft' }, gradient: null, stroke: null, radius: 0, ...o } as RectNode;
}

export function image(o: Partial<ImageNode> & { x: number; y: number; w: number; h: number }): ImageNode {
  return { ...base(o.name ?? 'Image'), type: 'image', assetId: null, fit: 'cover', radius: 0, fill: null, overlay: null, ...o } as ImageNode;
}

export function group(name: string, children: Node[], extra: Partial<GroupNode> = {}): GroupNode {
  return syncGroup({ ...base(name), type: 'group', x: 0, y: 0, w: 0, h: 0, children, ...extra } as GroupNode);
}

/** Natural single-line width of a text node. */
export function measureWidth(brand: Brand, n: TextNode): number {
  return Math.max(...layoutText({ ...n, w: 10000 }, brand).lines.map((l) => l.width), 10);
}

interface ButtonOpts { w?: number; h?: number; radius?: number; fontSize?: number; inverse?: boolean }

export function button(brand: Brand, label: string, url: string, x: number, y: number, o: ButtonOpts = {}): GroupNode {
  const fs = o.fontSize ?? 16;
  const probe = text(brand, label, { x: 0, y: 0, w: 400, fontSize: fs, fontWeight: 700, name: label });
  const wText = Math.min(400, Math.ceil(measureWidth(brand, probe)));
  const T = themeFor(brand.vibe, brand.shape);
  const w = o.w ?? wText + (T.btnRadius >= 999 ? 64 : 56), h = o.h ?? T.btnH;
  const outline = !!brand.shape?.outlineButtons && !o.inverse;
  const bg = rect({ x, y, w, h, fill: outline ? null : { token: o.inverse ? 'bg' : 'primary' }, radius: o.radius ?? T.btnRadius, name: 'Button bg', stroke: outline ? { color: { token: 'primary' }, width: 2 } : null, shadow: outline ? null : o.inverse ? (T.shadow ? { blur: 16, y: 6, color: '#000000', opacity: 0.18 } : null) : btnShadow(T, brand) });
  const t = text(brand, brand.shape?.uppercase ? up(label) : label, { x, y, w, h, fontSize: fs, fontWeight: 700, color: { token: outline ? 'primary' : o.inverse ? 'primary' : 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: label, letterSpacing: brand.shape?.uppercase ? 0.8 : 0 });
  return group(`Button · ${label}`, [bg, t], { link: url, alt: label });
}

// ---------------- content model ----------------
export interface LinkC { label: string; url: string }
export interface ItemC { name: string; price?: string; oldPrice?: string; badge?: string; body?: string; url?: string; image?: string | null; alt?: string }
export interface StatC { value: string; label: string }
export interface BlockContent {
  brand?: string;
  links?: LinkC[];
  eyebrow?: string;
  headline?: string;
  heading?: string;
  subhead?: string;
  body?: string;
  button?: LinkC;
  /** asset id for the block's image slot */
  image?: string | null;
  imageAlt?: string;
  imageUrl?: string;
  link?: LinkC;
  items?: ItemC[];
  stats?: StatC[];
  quote?: string;
  author?: string;
  address?: string;
  unsubscribeUrl?: string;
  preferencesUrl?: string;
  unsubscribeLabel?: string;
  preferencesLabel?: string;
  /** Footer social links (label is the network name). */
  social?: LinkC[];
  /** Variant of a block: hero-center/hero-product 'light' | 'band' | 'gradient' | 'ink'; cta/stats/nav 'dark'; feature-row 'right' (image on the right). */
  style?: 'light' | 'band' | 'gradient' | 'ink' | 'dark' | 'card' | 'right' | 'soft' | 'menu' | 'center' | 'plain';
  /** Round badge on the hero/spotlight photo ("-30%", "NEW"). */
  badge?: string;
  /** Headline treatment: 'extrude' (3D block), 'neon' (glow), 'outline' (hollow), 'shadow' (long flat shadow). */
  effect?: 'extrude' | 'neon' | 'outline' | 'shadow';
  /** Pseudo-3D tilt of the hero product image in degrees (-30..30). */
  tilt?: number;
  /** Set by buildDoc: this block sits on a soft tinted band (alternating rhythm). */
  tint?: boolean;
}

export const BLOCKS: { kind: BlockKind; name: string; desc: string }[] = [
  { kind: 'nav', name: 'Nav', desc: 'Logo + link, vạch màu brand' },
  { kind: 'hero', name: 'Hero ảnh', desc: 'Ảnh lớn, tiêu đề, CTA' },
  { kind: 'hero-band', name: 'Hero dải màu', desc: 'Nền primary, chữ nổi, ảnh dưới' },
  { kind: 'text', name: 'Text', desc: 'Eyebrow + tiêu đề + đoạn' },
  { kind: 'feature-row', name: 'Ảnh + chữ', desc: 'Card nền mềm, link' },
  { kind: 'products-2', name: 'Sản phẩm ×2', desc: 'Card, giá màu brand' },
  { kind: 'products-3', name: 'Sản phẩm ×3', desc: '3 cột, mỗi ô 1 link' },
  { kind: 'stats', name: 'Số liệu', desc: '3 con số nổi bật' },
  { kind: 'quote', name: 'Trích dẫn', desc: 'Lời khách hàng' },
  { kind: 'cta', name: 'CTA', desc: 'Dải nền mềm + nút' },
  { kind: 'cta-wide', name: 'CTA to', desc: 'Nút full-width' },
  { kind: 'hero-overlay', name: 'Hero phủ ảnh', desc: 'Chữ trắng trên ảnh tối dần' },
  { kind: 'split', name: 'Chia đôi', desc: 'Ảnh trái, chữ + nút phải' },
  { kind: 'bento', name: 'Bento', desc: '1 card lớn + 2 card nhỏ' },
  { kind: 'dark-band', name: 'Dải tối', desc: 'Nền ink, chữ khổ lớn' },
  { kind: 'badges', name: 'Nhãn', desc: 'Pill: -30%, freeship, 24h' },
  { kind: 'categories', name: 'Danh mục', desc: '3 ảnh tròn có link' },
  { kind: 'gallery', name: 'Gallery', desc: '3 ảnh vuông có link' },
  { kind: 'social', name: 'Social proof', desc: 'Avatar + sao + số đánh giá' },
  { kind: 'hero-center', name: 'Hero giữa', desc: 'Pill + tiêu đề khổ lớn, gradient' },
  { kind: 'icon-row', name: 'Hàng icon', desc: '4 icon tròn có nhãn' },
  { kind: 'checklist', name: 'Checklist', desc: 'Danh sách ✓ lợi ích' },
  { kind: 'countdown', name: 'Đếm ngược', desc: 'Ngày · giờ · phút · giây' },
  { kind: 'code', name: 'Mã giảm giá', desc: 'Khung mã + nút copy' },
  { kind: 'stat-tiles', name: 'Tiles số liệu', desc: '+320% doanh thu…' },
  { kind: 'articles', name: 'Bài viết / tập', desc: '3 thẻ ảnh + tiêu đề + badge' },
  { kind: 'spotlight', name: 'Spotlight', desc: 'Ảnh sản phẩm lớn + tag giá nổi' },
  { kind: 'glass-hero', name: 'Hero thẻ kính', desc: 'Ảnh toàn khung, thẻ kính mờ chứa chữ' },
  { kind: 'steps', name: 'Các bước', desc: '1 · 2 · 3 card đánh số' },
  { kind: 'collage', name: 'Collage', desc: '3 ảnh xếp lệch' },
  { kind: 'hero-product', name: 'Hero sản phẩm', desc: 'Nền tối, chữ khổng lồ, sản phẩm nổi có vầng sáng' },
  { kind: 'ticker', name: 'Ticker', desc: 'Dải chữ chạy: FREESHIP ✦ NEW DROP' },
  { kind: 'offer', name: 'Ưu đãi lớn', desc: 'Số -30% khổng lồ trên gradient' },
  { kind: 'reviews', name: 'Đánh giá', desc: '2–3 card sao + lời khách' },
  { kind: 'overlap', name: 'Ảnh + card đè', desc: 'Ảnh tràn khung, card chữ đè lên' },
  { kind: 'hero-card', name: 'Hero card trắng', desc: 'Ảnh trên dải màu, card trắng đè lên, chữ căn giữa' },
  { kind: 'zigzag', name: 'Zig-zag ảnh / chữ', desc: '2–4 hàng ảnh tràn mép xen chữ' },
  { kind: 'statement', name: 'Chữ khổng lồ', desc: '-50% · MEMBER ONLY' },
  { kind: 'menu', name: 'Thực đơn / dịch vụ', desc: 'Card chữ + ảnh tròn, giá, nút nhỏ' },
  { kind: 'divider', name: 'Divider', desc: 'Đường kẻ mảnh' },
  { kind: 'spacer', name: 'Spacer', desc: 'Khoảng trống 24px' },
  { kind: 'footer', name: 'Footer', desc: 'Địa chỉ, huỷ đăng ký' },
];

const DEF = {
  brand: 'BRAND',
  links: [{ label: 'Sản phẩm', url: 'https://example.com/shop' }, { label: 'Bộ sưu tập', url: 'https://example.com/collections' }, { label: 'Về chúng tôi', url: 'https://example.com/about' }],
  hero: { eyebrow: 'BỘ SƯU TẬP MỚI', headline: 'Tiêu đề lớn, nói thẳng lợi ích', subhead: 'Một câu phụ giải thích vì sao người đọc nên quan tâm hôm nay. Ngắn, cụ thể, có hạn.', button: { label: 'Khám phá ngay', url: 'https://example.com/shop' }, imageAlt: 'Ảnh chủ đề của email' },
  band: { eyebrow: 'ƯU ĐÃI CUỐI TUẦN', headline: 'Giảm 30% toàn bộ bộ sưu tập', subhead: 'Chỉ đến hết Chủ nhật. Mã PHLOEM30 · Freeship toàn quốc.', button: { label: 'Mua ngay', url: 'https://example.com/sale' }, imageAlt: 'Ảnh sản phẩm nổi bật' },
  text: { eyebrow: 'CÂU CHUYỆN', heading: 'Tiêu đề phần', body: 'Đoạn nội dung. Giữ 2–4 dòng, mỗi dòng một ý. Email là ảnh nên cỡ chữ từ 15px trở lên để đọc được trên điện thoại.' },
  cta: { heading: 'Sẵn sàng chưa?', subhead: 'Một dòng ngắn nói rõ người đọc nhận được gì khi bấm.', button: { label: 'Mua ngay', url: 'https://example.com/shop' } },
  feature: { heading: 'Điểm nổi bật', body: 'Hai dòng mô tả. Nói kết quả người dùng nhận được, không nói tính năng.', link: { label: 'Xem thêm →', url: 'https://example.com/feature' }, imageAlt: 'Minh hoạ tính năng' },
  stats: [{ value: '12k+', label: 'khách hàng' }, { value: '4.9/5', label: 'đánh giá' }, { value: '48h', label: 'giao toàn quốc' }],
  quote: { quote: 'Mua lần đầu vì tò mò, mua lần hai vì chất lượng. Giao nhanh, đóng gói đẹp, đúng như ảnh.', author: '— Minh Anh, Hà Nội' },
  footer: { address: '123 Đường Lê Lợi, Quận 1, TP.HCM · hello@example.com', unsubscribeUrl: 'https://example.com/unsubscribe', preferencesUrl: 'https://example.com/preferences' },
};

const up = (s: unknown) => (s == null ? '' : String(s)).toUpperCase();
const B0 = 'https://example.com';

/** Brand logo slot: the uploaded logo image when the brand has one, otherwise the wordmark text. */
/** Which brand token reads on a given background: the lighter of ink/bg on dark bands, the darker on light ones. */
export function contrastToken(brand: Brand, behind: Color | null | undefined): 'ink' | 'bg' {
  const dark = isDarkColor(resolveColor(behind, brand) ?? brand.bg);
  const inkLighter = luminance(brand.ink) > luminance(brand.bg);
  return dark ? (inkLighter ? 'ink' : 'bg') : (inkLighter ? 'bg' : 'ink');
}
/** The logo asset to show on a band: the light version on dark backgrounds when the brand has one. */
export function logoAssetFor(brand: Brand, behind: Color | null | undefined): string | null {
  const dark = isDarkColor(resolveColor(behind, brand) ?? brand.bg);
  return (dark && brand.logoLightAssetId) || brand.logoAssetId || null;
}
export function logoNode(brand: Brand, c: BlockContent, x: number, cy: number, h: number, align: 'left' | 'center', link: string, behind: Color = { token: 'bg' }): Node {
  const asset = logoAssetFor(brand, behind);
  if (asset) {
    const meta = assets.get(asset);
    const ratio = meta ? meta.w / Math.max(1, meta.h) : 3.2;
    const w = Math.max(40, Math.min(220, Math.round(h * ratio)));
    const xx = align === 'center' ? Math.round((W - w) / 2) : x;
    return image({ x: xx, y: Math.round(cy - h / 2), w, h, assetId: asset, fit: 'contain', name: 'Logo', alt: brand.name, link });
  }
  const color: TextNode['color'] = { token: contrastToken(brand, behind) };
  const t = text(brand, up(c.brand || brand.name || 'BRAND'), { x: align === 'center' ? PAD : x, y: 0, w: align === 'center' ? W - PAD * 2 : 260, fontSize: h >= 28 ? 18 : 13, fontWeight: 800, letterSpacing: 1.5, name: 'Logo', link, align: align === 'center' ? 'center' : 'left', color });
  t.y = Math.round(cy - t.h / 2);
  return t;
}

export function makeBlock(kind: BlockKind, brand: Brand, y: number, c: BlockContent = {}): GroupNode {
  const kids: Node[] = [];
  let h = 0;
  const T = themeFor(brand.vibe, brand.shape);
  const R = T.radius, RI = Math.max(6, T.radius - 4);
  const band = (hh: number, fill: RectNode['fill'] = { token: 'bg' }, name = 'Block bg') => rect({ x: 0, y, w: W, h: hh, fill, name });
  const inner = W - PAD * 2;
  const hs = (px: number) => Math.round(px * T.heroScale);
  const S = (px: number) => Math.round(px * T.space);
  /** Display headline: heading font, heavy, tight leading and tracking from the theme. */
  const H = (t: string, o: Partial<TextNode> & { x: number; y: number; w: number }) => text(brand, brand.shape?.uppercase ? up(t) : t, { fontFamily: 'heading', fontWeight: brand.shape?.headingWeight ?? 800, lineHeight: 1.06, letterSpacing: T.track, ...o });
  /** Headline effect requested by the block content, with a colour that works on the band. */
  const fxFor = (onDark: boolean): TextNode['effect'] => {
    if (!c.effect) return null;
    if (c.effect === 'extrude') return { kind: 'extrude', depth: Math.round(hs(7)), angle: 52, color: onDark ? { token: 'primary' } : { token: 'ink', alpha: 0.5 } };
    if (c.effect === 'neon') return { kind: 'neon', color: { token: onDark ? 'primary' : 'accent' } };
    if (c.effect === 'shadow') return { kind: 'shadow', depth: 20, angle: 50, color: onDark ? { token: 'primary' } : { token: 'ink' } };
    return { kind: 'outline' };
  };
  /** Cut-out props (fruit, ice, leaves…) scattered around a hero product: fixed slots, slight rotation, floating shadow. */
  const propsAround = (ix: number, iy: number, iw: number, ih: number): Node[] => {
    const list = (c.items || []).filter((it) => it.image).slice(0, 6);
    const slots = [
      { x: -0.08, y: 0.55, w: 0.34, r: -12 }, { x: 0.74, y: 0.5, w: 0.34, r: 14 }, { x: 0.02, y: 0.02, w: 0.26, r: 10 },
      { x: 0.72, y: -0.02, w: 0.26, r: -8 }, { x: 0.3, y: 0.74, w: 0.24, r: 6 }, { x: 0.46, y: 0.8, w: 0.22, r: -6 },
    ];
    return list.map((it, i) => { const sl = slots[i]; const w = Math.round(iw * sl.w); return image({ x: Math.round(ix + iw * sl.x), y: Math.round(iy + ih * sl.y), w, h: w, assetId: it.image!, fit: 'contain', fill: null, rotate: sl.r, name: `Prop · ${it.name || i + 1}`, alt: it.alt || it.name || '' }); });
  };
  const centerBtn = (btn: GroupNode) => { const nx = Math.round((W - btn.w) / 2); const dx = nx - btn.children[0].x; btn.children.forEach((k) => { k.x += dx; }); return syncGroup(btn); };
  /** Section header used by list blocks: small-caps eyebrow, big heading, optional "see all" link on the right. Returns the y where content starts. */
  const sectionHead = (yy: number, opts: { eyebrow?: string; heading?: string; link?: LinkC; align?: 'left' | 'center'; onDark?: boolean }): { nodes: Node[]; bottom: number } => {
    const nodes: Node[] = []; let cy = yy;
    const fg = opts.onDark ? { token: 'bg' as const } : { token: 'ink' as const };
    if (opts.eyebrow) { const e = text(brand, up(opts.eyebrow), { x: PAD, y: cy, w: inner, fontSize: 11, fontWeight: 800, letterSpacing: 1.8, color: opts.onDark ? { token: 'primary' } : { token: 'primary' }, align: opts.align || 'left', name: 'Eyebrow' }); nodes.push(e); cy = e.y + e.h + 8; }
    if (opts.heading) {
      const head = H(opts.heading, { x: PAD, y: cy, w: opts.link ? inner - 130 : inner, fontSize: hs(30), lineHeight: 1.1, color: fg, align: opts.align || 'left', name: 'Heading' });
      nodes.push(head);
      if (opts.link) { const l = text(brand, opts.link.label, { x: W - PAD - 130, y: head.y + Math.max(0, Math.round((head.h - 20) / 2)), w: 130, fontSize: 14, fontWeight: 700, color: { token: 'primary' }, align: 'right', name: 'Link', link: opts.link.url }); nodes.push(l); }
      cy = head.y + head.h + 18;
    }
    return { nodes, bottom: cy };
  };
  /** Eyebrow: a pill on playful/bold themes, plain small caps otherwise. Returns nodes and the bottom y. */
  const eyebrowNodes = (label: string, x: number, yy: number, onBand: boolean): { nodes: Node[]; bottom: number } => {
    if (!T.eyebrowPill) { const t = text(brand, up(label), { x, y: yy, w: inner, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: onBand ? { token: 'onPrimary' } : { token: 'primary' }, name: 'Eyebrow', opacity: onBand ? 0.85 : 1 }); return { nodes: [t], bottom: t.y + t.h }; }
    const t = text(brand, up(label), { x: x + 12, y: yy, w: 300, fontSize: 11, fontWeight: 800, letterSpacing: 1.2, color: onBand ? { token: 'primary' } : { token: 'onPrimary' }, name: 'Eyebrow' });
    const pw = Math.ceil(measureWidth(brand, t)) + 24; t.w = pw - 24;
    const pill = rect({ x, y: yy, w: pw, h: 26, fill: onBand ? { token: 'bg' } : { token: 'primary' }, radius: 999, name: 'Eyebrow pill' });
    t.y = yy + Math.round((26 - t.h) / 2);
    return { nodes: [pill, t], bottom: yy + 26 };
  };
  switch (kind) {
    case 'nav': {
      const st = c.style === 'ink' ? 'dark' : (c.style || 'light');
      const behind: Color = st === 'dark' ? { token: 'ink' } : st === 'band' ? { token: 'primary' } : st === 'soft' ? { token: 'soft' } : { token: 'bg' };
      const linkTok = st === 'dark' ? contrastToken(brand, { token: 'ink' }) : st === 'band' ? 'onPrimary' : 'muted';
      const links = (c.links && c.links.length ? c.links : brand.links?.nav && brand.links.nav.length ? brand.links.nav : DEF.links).slice(0, 5);
      const home = brand.links?.website || (() => { try { return c.links?.[0]?.url ? new URL(c.links[0].url).origin : 'https://example.com'; } catch { return 'https://example.com'; } })();
      if (st === 'menu') {
        // Boutique header: logo centred, a thin ruled row of category links under it.
        h = 112;
        kids.push(band(h), logoNode(brand, c, PAD, y + 36, 28, 'center', home, { token: 'bg' }));
        const ws = links.map((l) => { const t = text(brand, up(l.label), { x: 0, y: y + 80, w: 200, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: { token: 'ink' }, name: l.label, link: l.url }); return { t, w: Math.ceil(measureWidth(brand, t)) + 2 }; });
        const gap = 28; let x = Math.round((W - (ws.reduce((a, b) => a + b.w, 0) + gap * (ws.length - 1))) / 2);
        kids.push(rect({ x: PAD, y: y + 68, w: inner, h: 1, fill: { token: 'line' }, name: 'Rule' }), rect({ x: PAD, y: y + h - 1, w: inner, h: 1, fill: { token: 'line' }, name: 'Rule' }));
        for (const { t, w } of ws) { t.x = x; t.w = w; kids.push(t); x += w + gap; }
        break;
      }
      h = 72;
      kids.push(band(h, behind));
      if (st === 'light' || st === 'soft') kids.push(rect({ x: 0, y, w: W, h: 4, fill: { token: 'primary' }, name: 'Accent bar' }));
      kids.push(logoNode(brand, c, PAD, y + 38, 30, 'left', home, behind));
      let x = W - PAD;
      const logoRight = PAD + 236; // the logo slot: links never run over it
      for (let i = Math.min(4, links.length) - 1; i >= 0; i--) {
        const t = text(brand, links[i].label, { x: 0, y: y + 30, w: 120, fontSize: 13, fontWeight: 600, color: { token: linkTok }, align: 'right', name: links[i].label, link: links[i].url, opacity: st === 'light' || st === 'soft' ? 1 : 0.8 });
        const tw = Math.ceil(measureWidth(brand, t)) + 2;
        if (x - tw < logoRight) break; // out of room: the menu shows what fits (the home link still covers the rest)
        t.w = tw; t.x = x - tw; x -= tw + 24;
        kids.push(t);
      }
      break;
    }
    case 'hero': {
      const d = DEF.hero;
      const imgH = 400;
      const btnC = c.button ?? d.button;
      const img = image({ x: 0, y, w: W, h: imgH, name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null });
      let cy = y + imgH + S(34);
      const eb = c.eyebrow !== '' ? eyebrowNodes(c.eyebrow || d.eyebrow, PAD, cy, false) : null;
      if (eb) cy = eb.bottom + 14;
      const head = H(c.headline || d.headline, { x: PAD, y: cy, w: inner, fontSize: hs(40), name: 'Headline' });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: head.y + head.h + 14, w: inner - 40, fontSize: 17, color: { token: 'muted' }, lineHeight: 1.55, name: 'Subhead' });
      const btn = button(brand, btnC.label, btnC.url, PAD, sub.y + sub.h + S(26));
      h = btn.y + btn.h + S(44) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), img, ...(eb ? eb.nodes : []), head, sub, btn);
      break;
    }
    case 'hero-band': {
      // Poster: copy on the brand band, the photo as a lifted card that breaks out of the band's bottom edge.
      const d = DEF.band;
      const btnC = c.button ?? d.button;
      const eb = eyebrowNodes(c.eyebrow || d.eyebrow, PAD, y + S(46), true);
      const head = H(c.headline || d.headline, { x: PAD, y: eb.bottom + 16, w: inner, fontSize: hs(46), lineHeight: 1.02, color: { token: 'onPrimary' }, name: 'Headline', effect: fxFor(true) });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: head.y + head.h + 16, w: inner - 40, fontSize: 17, color: { token: 'onPrimary' }, lineHeight: 1.5, name: 'Subhead', opacity: 0.85 });
      const btn = button(brand, btnC.label, btnC.url, PAD, sub.y + sub.h + S(26), { inverse: true });
      const img = image({ x: PAD, y: btn.y + btn.h + S(36), w: inner, h: 320, radius: Math.max(R, 10), name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null, shadow: posterShadow(T) });
      const bandH = img.y + Math.round(img.h * 0.55) - y;
      h = img.y + img.h + S(40) - y;
      kids.push(band(h), rect({ x: 0, y, w: W, h: bandH, fill: { token: 'primary' }, name: 'Band' }), ...blobs(T, y, bandH, true), ...eb.nodes, head, sub, btn, img);
      break;
    }
    case 'text': {
      const d = DEF.text;
      const center = c.style === 'center';
      let cy = y + S(center ? 44 : 36);
      const eyebrow = c.eyebrow !== '' ? text(brand, up(c.eyebrow || d.eyebrow), { x: PAD, y: cy, w: inner, fontSize: 11, fontWeight: 800, letterSpacing: center ? 3 : 1.8, color: { token: 'primary' }, align: center ? 'center' : 'left', name: 'Eyebrow' }) : null;
      if (eyebrow) cy = eyebrow.y + eyebrow.h + (center ? 14 : 10);
      const head = H(c.heading || d.heading, { x: center ? PAD + 30 : PAD, y: cy, w: center ? inner - 60 : inner, fontSize: hs(32), lineHeight: 1.12, align: center ? 'center' : 'left', name: 'Heading' });
      const rule = center ? rect({ x: Math.round(W / 2 - 22), y: head.y + head.h + 16, w: 44, h: 2, fill: { token: 'primary' }, name: 'Rule' }) : null;
      const body = text(brand, c.body || d.body, { x: center ? PAD + 40 : PAD, y: (rule ? rule.y + rule.h + 16 : head.y + head.h + 14), w: center ? inner - 80 : inner - 24, fontSize: center ? 16 : 17, lineHeight: 1.6, color: { token: 'muted' }, align: center ? 'center' : 'left', name: 'Paragraph' });
      h = body.y + body.h + S(center ? 44 : 36) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...(eyebrow ? [eyebrow] : []), head, ...(rule ? [rule] : []), body);
      break;
    }
    case 'cta': {
      const d = DEF.cta;
      const btnC = c.button ?? d.button;
      const dark = c.style === 'dark', onBand = c.style === 'band';
      const fg = dark ? { token: 'bg' as const } : onBand ? { token: 'onPrimary' as const } : { token: 'ink' as const };
      const cardY = y + S(20), padX = 32;
      const head = H(c.heading || d.heading, { x: PAD + padX, y: cardY + S(40), w: inner - padX * 2, fontSize: hs(30), lineHeight: 1.1, align: 'center', color: fg, name: 'Heading' });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD + padX, y: head.y + head.h + 10, w: inner - padX * 2, fontSize: 16, color: dark || onBand ? fg : { token: 'muted' }, align: 'center', lineHeight: 1.5, name: 'Sub', opacity: dark || onBand ? 0.78 : 1 });
      const btn = centerBtn(button(brand, btnC.label, btnC.url, 0, sub.y + sub.h + S(24), { inverse: onBand }));
      const cardH = btn.y + btn.h + S(40) - cardY;
      h = cardH + S(40);
      const card = rect({ x: PAD, y: cardY, w: inner, h: cardH, fill: dark ? { token: 'ink' } : onBand ? { token: 'primary' } : c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Card', stroke: dark || onBand ? null : cardStroke(T), shadow: dark || onBand ? cardShadow(T) : null });
      const deco: Node[] = (dark || onBand) && T.blobs ? [rect({ x: W - PAD - 110, y: cardY + 14, w: 96, h: 96, fill: dark ? brand.primary : '#FFFFFF', radius: 999, opacity: dark ? 0.22 : 0.12, name: 'Blob' }), rect({ x: PAD + 18, y: cardY + cardH - 70, w: 54, h: 54, fill: dark ? brand.accent : '#FFFFFF', radius: 999, opacity: dark ? 0.2 : 0.1, name: 'Blob' })] : [];
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), card, ...deco, head, sub, btn);
      break;
    }
    case 'products-2':
    case 'products-3': {
      const n = kind === 'products-3' ? 3 : 2;
      const gap = 14, cw = Math.floor((inner - gap * (n - 1)) / n);
      const items: ItemC[] = (c.items && c.items.length ? c.items : Array.from({ length: n }, (_, i) => ({ name: n === 3 ? `Sản phẩm ${i + 1}` : `Tên sản phẩm ${i + 1}`, price: '450.000₫', url: `https://example.com/products/item-${i + 1}` }))).slice(0, n);
      while (items.length < n) items.push({ name: `Sản phẩm ${items.length + 1}`, price: '', url: 'https://example.com/shop' });
      const sh = sectionHead(y + S(32), { eyebrow: c.eyebrow, heading: c.heading, link: c.link });
      const top = sh.nodes.length ? sh.bottom : y + S(24);
      const cards: Node[] = [];
      let bottom = y;
      const cardFill = c.tint ? { token: 'bg' as const } : { token: 'soft' as const };
      const imgFill = c.tint ? { token: 'soft' as const } : { token: 'bg' as const };
      items.forEach((it, i) => {
        const x = PAD + i * (cw + gap);
        const url = it.url || 'https://example.com/shop';
        const padC = n === 3 ? 10 : 12;
        const iw = cw - padC * 2;
        const img = image({ x: x + padC, y: top + padC, w: iw, h: iw, radius: RI, name: `Product image ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null, fit: 'contain', fill: imgFill });
        // soft brand disc behind the product so contain-fit photos never float in an empty square
        const disc = rect({ x: img.x + Math.round(iw * 0.1), y: img.y + Math.round(iw * 0.1), w: Math.round(iw * 0.8), h: Math.round(iw * 0.8), fill: { token: 'primary' }, radius: 999, opacity: 0.07, name: 'Disc' });
        const name = text(brand, it.name, { x: x + padC + 2, y: img.y + img.h + 14, w: cw - padC * 2 - 4, fontSize: n === 3 ? 15 : 17, fontWeight: 700, lineHeight: 1.3, name: 'Name' });
        const extra: Node[] = [];
        let last: TextNode = name;
        if (it.price) {
          const pr = text(brand, it.price, { x: x + padC + 2, y: name.y + name.h + 6, w: cw - padC * 2 - 4, fontSize: n === 3 ? 18 : 22, fontWeight: 800, color: { token: 'primary' }, fontFamily: 'heading', letterSpacing: T.track / 2, name: 'Price' });
          extra.push(pr); last = pr;
          if (it.oldPrice) {
            const pw = Math.ceil(measureWidth(brand, pr));
            const o = text(brand, it.oldPrice, { x: pr.x + pw + 8, y: pr.y + Math.max(0, pr.h - 18), w: Math.max(40, cw - padC * 2 - pw - 12), fontSize: 13, color: { token: 'muted' }, strike: true, name: 'Old price' });
            if (pw + 8 + Math.ceil(measureWidth(brand, o)) > cw - padC * 2 - 4) { o.x = pr.x; o.w = cw - padC * 2 - 4; o.y = pr.y + pr.h + 2; o.h = textHeight(o, brand); last = o; } // no room beside the price: its own line, and the card grows
            extra.push(o);
          }
        } else if (it.oldPrice) { const o = text(brand, it.oldPrice, { x: x + padC + 2, y: last.y + last.h + 4, w: cw - padC * 2, fontSize: 13, color: { token: 'muted' }, strike: true, name: 'Old price' }); extra.push(o); last = o; }
        if (it.body && n === 2) { const b = text(brand, it.body, { x: x + padC + 2, y: last.y + last.h + 6, w: cw - padC * 2 - 4, fontSize: 13, color: { token: 'muted' }, lineHeight: 1.45, name: 'Body' }); extra.push(b); last = b; }
        if (it.badge) { const bt = text(brand, it.badge, { x: 0, y: 0, w: 200, fontSize: 11, fontWeight: 800, color: { token: 'onPrimary' }, name: 'Badge' }); const bw = Math.ceil(measureWidth(brand, bt)) + 18; const bg = rect({ x: x + padC + 6, y: top + padC + 6, w: bw, h: 24, fill: { token: 'primary' }, radius: 999, name: 'Badge bg' }); bt.x = bg.x + 9; bt.w = bw - 18; bt.y = bg.y + Math.round((24 - bt.h) / 2); extra.push(bg, bt); }
        const cardH = last.y + last.h + padC + 6 - top;
        const card = rect({ x, y: top, w: cw, h: cardH, fill: cardFill, radius: R, name: 'Card', shadow: cardShadow(T), stroke: cardStroke(T) });
        bottom = Math.max(bottom, top + cardH);
        cards.push(group(`Product ${i + 1}`, [card, disc, img, name, ...extra], { link: url, alt: `${it.name}${it.price ? ' — ' + it.price : ''}` }));
      });
      // equal card heights
      cards.forEach((g) => { const card = (g as GroupNode).children[0] as RectNode; card.h = bottom - top; syncGroup(g as GroupNode); });
      h = bottom + S(32) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...sh.nodes, ...cards);
      break;
    }
    case 'feature-row': {
      const d = DEF.feature;
      const linkC = c.link ?? d.link;
      const right = c.style === 'right';
      const cardY = y + S(16), imgW = 236, imgH = 196, padC = 14;
      const imgX = right ? W - PAD - padC - imgW : PAD + padC;
      const img = image({ x: imgX, y: cardY + padC, w: imgW, h: imgH, radius: RI, name: 'Feature image', alt: c.imageAlt || d.imageAlt, assetId: c.image ?? null, link: linkC.url });
      const cx = right ? PAD + padC + 8 : PAD + padC + imgW + 22, cwid = inner - padC * 2 - imgW - 30;
      let cy = cardY + S(26);
      const eb = c.eyebrow ? text(brand, up(c.eyebrow), { x: cx, y: cy, w: cwid, fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: { token: 'primary' }, name: 'Eyebrow' }) : null;
      if (eb) cy = eb.y + eb.h + 8;
      const head = H(c.heading || d.heading, { x: cx, y: cy, w: cwid, fontSize: 22, lineHeight: 1.2, name: 'Heading' });
      const body = text(brand, c.body || d.body, { x: cx, y: head.y + head.h + 8, w: cwid, fontSize: 15, color: { token: 'muted' }, lineHeight: 1.55, name: 'Body' });
      const more = text(brand, linkC.label, { x: cx, y: body.y + body.h + 14, w: cwid, fontSize: 14, fontWeight: 700, color: { token: 'primary' }, name: 'Link', link: linkC.url });
      const cardH = Math.max(img.y + img.h + padC, more.y + more.h + S(26)) - cardY;
      img.y = cardY + Math.round((cardH - imgH) / 2);
      h = cardH + S(32);
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), rect({ x: PAD, y: cardY, w: inner, h: cardH, fill: c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Card', shadow: cardShadow(T), stroke: cardStroke(T) }), img, ...(eb ? [eb] : []), head, body, more);
      break;
    }
    case 'stats': {
      const items = (c.stats && c.stats.length ? c.stats : DEF.stats).slice(0, 4);
      const dark = c.style === 'dark';
      const cw = Math.floor(inner / items.length);
      const sh = sectionHead(y + S(36), { eyebrow: c.eyebrow, heading: c.heading, align: 'center', onDark: dark });
      let top = sh.nodes.length ? sh.bottom + 4 : y + S(34);
      let bottom = y;
      const cells: Node[] = [];
      items.forEach((st, i) => {
        const x = PAD + i * cw;
        const tick = rect({ x: x + Math.round(cw / 2) - 14, y: top, w: 28, h: 3, fill: { token: dark ? 'primary' : 'accent' }, radius: 2, name: 'Tick' });
        const nT = H(st.value, { x, y: top + 16, w: cw, fontSize: hs(items.length > 3 ? 34 : 44), lineHeight: 1, color: dark ? { token: 'bg' } : { token: 'primary' }, align: 'center', name: `Stat ${i + 1}` });
        const lT = text(brand, up(st.label), { x: x + 4, y: nT.y + nT.h + 8, w: cw - 8, fontSize: 11, fontWeight: 700, letterSpacing: 1.2, color: dark ? { token: 'bg' } : { token: 'muted' }, align: 'center', lineHeight: 1.4, name: `Label ${i + 1}`, opacity: dark ? 0.7 : 1 });
        bottom = Math.max(bottom, lT.y + lT.h);
        cells.push(tick, nT, lT);
      });
      h = bottom + S(36) - y;
      kids.push(band(h, dark ? { token: 'ink' } : c.tint ? { token: 'soft' } : { token: 'bg' }), ...(dark ? blobs(T, y, h, true) : []), ...sh.nodes, ...(dark ? [] : [rect({ x: PAD, y: y, w: inner, h: 1, fill: { token: 'line' }, name: 'Line top' }), rect({ x: PAD, y: y + h - 1, w: inner, h: 1, fill: { token: 'line' }, name: 'Line bottom' })]), ...cells);
      break;
    }
    case 'quote': {
      const d = DEF.quote;
      const author = (c.author || d.author).replace(/^[—–-]\s*/, '');
      if (c.style === 'center' || c.style === 'plain') {
        const top = y + S(40);
        const rule1 = rect({ x: Math.round(W / 2 - 60), y: top, w: 120, h: 1, fill: { token: 'line' }, name: 'Rule' });
        const stars = c.eyebrow ? text(brand, c.eyebrow, { x: PAD, y: top + 18, w: inner, fontSize: 15, color: { token: 'accent' }, letterSpacing: 3, align: 'center', name: 'Stars' }) : null;
        const mark = text(brand, '“', { x: PAD, y: (stars ? stars.y + stars.h : top + 10) + 4, w: inner, fontSize: 64, fontWeight: 800, color: { token: 'primary' }, fontFamily: 'heading', lineHeight: 1, align: 'center', name: 'Quote mark' });
        const q = text(brand, c.quote || d.quote, { x: PAD + 40, y: mark.y + 44, w: inner - 80, fontSize: 21, fontWeight: 500, lineHeight: 1.5, italic: T.stroke, fontFamily: 'heading', align: 'center', letterSpacing: T.track / 3, name: 'Quote' });
        const who = text(brand, up(author), { x: PAD, y: q.y + q.h + 18, w: inner, fontSize: 11, fontWeight: 800, letterSpacing: 2.4, color: { token: 'muted' }, align: 'center', name: 'Author' });
        const rule2 = rect({ x: Math.round(W / 2 - 60), y: who.y + who.h + 22, w: 120, h: 1, fill: { token: 'line' }, name: 'Rule' });
        h = rule2.y + S(40) - y;
        kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), rule1, ...(stars ? [stars] : []), mark, q, who, rule2);
        break;
      }
      const cardY = y + S(20), padC = 28;
      const stars = c.eyebrow ? text(brand, c.eyebrow, { x: PAD + padC, y: cardY + S(26), w: inner - padC * 2, fontSize: 16, color: { token: 'accent' }, letterSpacing: 2, name: 'Stars' }) : null;
      const mark = text(brand, '“', { x: PAD + padC - 4, y: (stars ? stars.y + stars.h : cardY + S(14)) + 2, w: 60, fontSize: 72, fontWeight: 800, color: { token: 'primary' }, fontFamily: 'heading', lineHeight: 1, name: 'Quote mark', opacity: 0.9 });
      const q = text(brand, c.quote || d.quote, { x: PAD + padC, y: mark.y + 50, w: inner - padC * 2, fontSize: 21, fontWeight: 500, lineHeight: 1.45, italic: T.stroke, fontFamily: 'heading', letterSpacing: T.track / 3, name: 'Quote' });
      const av = rect({ x: PAD + padC, y: q.y + q.h + 18, w: 34, h: 34, fill: { token: 'primary' }, radius: 999, name: 'Avatar', opacity: 0.9 });
      const avT = text(brand, author.trim().slice(0, 1).toUpperCase() || '★', { x: av.x, y: av.y, w: 34, h: 34, fontSize: 14, fontWeight: 800, color: { token: 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: 'Initial' });
      const who = text(brand, author, { x: av.x + 44, y: av.y + 8, w: inner - padC * 2 - 44, fontSize: 14, fontWeight: 700, color: { token: 'ink' }, name: 'Author' });
      const cardH = av.y + av.h + S(26) - cardY;
      h = cardH + S(40);
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), rect({ x: PAD, y: cardY, w: inner, h: cardH, fill: c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Card', stroke: cardStroke(T), shadow: cardShadow(T) }), ...(stars ? [stars] : []), mark, q, av, avT, who);
      break;
    }
    case 'hero-overlay': {
      const d = DEF.hero; const btnC = c.button ?? d.button;
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: 0, w: inner - 60, fontSize: 17, color: '#FFFFFF', lineHeight: 1.5, name: 'Subhead', opacity: 0.9 });
      const head = H(c.headline || d.headline, { x: PAD, y: 0, w: inner - 20, fontSize: hs(46), lineHeight: 1.02, color: '#FFFFFF', name: 'Headline' });
      const pillT = text(brand, up(c.eyebrow || d.eyebrow), { x: PAD + 12, y: 0, w: 300, fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: { token: 'onPrimary' }, name: 'Eyebrow' });
      // the photo grows with the copy: a long headline never climbs over the block above
      const HH = Math.max(520, S(64) + 26 + 16 + head.h + 14 + sub.h + 20 + T.btnH + S(36));
      const img = image({ x: 0, y, w: W, h: HH, name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null, overlay: { color: darken(brand.primary, 0.72), opacity: 0.8, gradient: true } });
      const btn = button(brand, btnC.label, btnC.url, PAD, y + HH - S(36) - T.btnH);
      sub.y = btn.y - 20 - sub.h;
      head.y = sub.y - 14 - head.h;
      const pw = Math.ceil(measureWidth(brand, pillT)) + 26; pillT.w = pw - 24;
      const pill = rect({ x: PAD, y: head.y - 16 - 26, w: pw, h: 26, fill: { token: 'primary' }, radius: 999, name: 'Eyebrow pill' });
      pillT.y = pill.y + Math.round((26 - pillT.h) / 2);
      h = HH;
      kids.push(img, pill, pillT, head, sub, btn);
      break;
    }
    case 'split': {
      const d = DEF.feature; const linkC = c.link ?? d.link;
      const imgW = 290, H0 = 340;
      const img = image({ x: 0, y, w: imgW, h: H0, name: 'Split image', alt: c.imageAlt || d.imageAlt, assetId: c.image ?? null, link: c.button?.url || linkC.url });
      const cx = imgW + 28, cw = W - cx - PAD;
      const eyebrow = text(brand, up(c.eyebrow || 'Mới'), { x: cx, y: y + 44, w: cw, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: { token: 'primary' }, name: 'Eyebrow' });
      const head = text(brand, c.heading || c.headline || d.heading, { x: cx, y: eyebrow.y + eyebrow.h + 10, w: cw, fontSize: 26, fontWeight: 800, lineHeight: 1.15, fontFamily: 'heading', name: 'Heading' });
      const body = text(brand, c.body || d.body, { x: cx, y: head.y + head.h + 12, w: cw, fontSize: 14, color: { token: 'muted' }, lineHeight: 1.55, name: 'Body' });
      const btn = button(brand, c.button?.label || linkC.label.replace(/\s*→$/, ''), c.button?.url || linkC.url, cx, body.y + body.h + 18, { fontSize: 14, h: 42 });
      h = Math.max(H0, btn.y + btn.h + 36 - y);
      img.h = h;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), img, eyebrow, head, body, btn);
      break;
    }
    case 'bento': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Tính năng chính', body: 'Một câu nói kết quả người dùng nhận được, không nói tính năng.', url: `${B0}/a` }, { name: 'Nhanh hơn 2×', body: 'Một số liệu hoặc lợi ích ngắn.', url: `${B0}/b` }, { name: 'Dùng thử 14 ngày', body: 'Không cần thẻ.', url: `${B0}/c` }]).slice(0, 3);
      const gap = 12, colW = Math.floor((inner - gap) / 2), top = y + 16;
      const big = items[0];
      const bigImg = image({ x: PAD + 8, y: top + 8, w: colW - 16, h: 182, radius: RI, name: 'Bento image', alt: big.alt || big.name, assetId: big.image ?? null });
      const bigH1 = text(brand, big.name, { x: PAD + 16, y: bigImg.y + bigImg.h + 14, w: colW - 32, fontSize: 18, fontWeight: 700, fontFamily: 'heading', lineHeight: 1.25, name: 'Heading' });
      const bigB = text(brand, big.body || big.price || '', { x: PAD + 16, y: bigH1.y + bigH1.h + 6, w: colW - 32, fontSize: 13, color: { token: 'muted' }, lineHeight: 1.5, name: 'Body' });
      const bigCardH = bigB.y + bigB.h + 18 - top;
      const bigCard = rect({ x: PAD, y: top, w: colW, h: bigCardH, fill: c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Card', shadow: cardShadow(T), stroke: cardStroke(T) });
      const smallH = Math.floor((bigCardH - gap) / 2);
      const cards: Node[] = [group('Bento 1', [bigCard, bigImg, bigH1, bigB], { link: big.url || null, alt: big.name })];
      [items[1], items[2]].forEach((it, i) => {
        if (!it) return;
        const sy = top + i * (smallH + gap), sx = PAD + colW + gap;
        const card = rect({ x: sx, y: sy, w: colW, h: smallH, fill: i === 0 ? { token: 'primary' } : c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Card', shadow: cardShadow(T), stroke: i === 0 ? null : cardStroke(T) });
        const hT = text(brand, it.name, { x: sx + 16, y: sy + 18, w: colW - 32, fontSize: 17, fontWeight: 700, fontFamily: 'heading', lineHeight: 1.25, color: i === 0 ? { token: 'onPrimary' } : { token: 'ink' }, name: 'Heading' });
        const bT = text(brand, it.body || it.price || '', { x: sx + 16, y: hT.y + hT.h + 6, w: colW - 32, fontSize: 13, color: i === 0 ? { token: 'onPrimary' } : { token: 'muted' }, lineHeight: 1.45, name: 'Body', opacity: i === 0 ? 0.85 : 1 });
        cards.push(group(`Bento ${i + 2}`, [card, hT, bT], { link: it.url || null, alt: it.name }));
      });
      h = bigCardH + 32;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...cards);
      break;
    }
    case 'badges': {
      const pills = (c.stats && c.stats.length ? c.stats : [{ value: '-30%', label: 'toàn bộ' }, { value: 'Freeship', label: '' }, { value: '24h', label: 'giao hàng' }]).slice(0, 4);
      const nodes: Node[] = []; const gap = 10, ph = 34;
      const ts = pills.map((pl, i) => text(brand, [pl.value, pl.label].filter(Boolean).join(' '), { x: 0, y: 0, w: 300, fontSize: 13, fontWeight: 800, color: i === 0 ? { token: 'onPrimary' } : { token: 'primary' }, name: 'Pill' }));
      const ws = ts.map((t) => Math.ceil(measureWidth(brand, t)) + 28);
      let x = Math.round((W - (ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1))) / 2);
      ts.forEach((t, i) => { const r = rect({ x, y: y + 14, w: ws[i], h: ph, fill: i === 0 ? { token: 'primary' } : c.tint ? { token: 'bg' } : { token: 'soft' }, radius: 999, name: 'Pill bg', stroke: { color: { token: 'line' }, width: 1 }, shadow: T.shadow ? { blur: 12, y: 4, color: '#000000', opacity: 0.08 } : null }); t.x = x + 14; t.w = ws[i] - 28; t.y = y + 14 + Math.round((ph - t.h) / 2); nodes.push(r, t); x += ws[i] + gap; });
      h = ph + 28;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...nodes);
      break;
    }
    case 'dark-band': {
      const d = DEF.band; const btnC = c.button ?? d.button;
      const eyebrow = text(brand, up(c.eyebrow || d.eyebrow), { x: PAD, y: y + S(52), w: inner, fontSize: 11, fontWeight: 800, letterSpacing: 2, color: { token: 'primary' }, name: 'Eyebrow' });
      const head = H(c.headline || d.headline, { x: PAD, y: eyebrow.y + eyebrow.h + 16, w: inner, fontSize: hs(54), lineHeight: 0.98, color: { token: 'bg' }, name: 'Headline', effect: fxFor(true) });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: head.y + head.h + 18, w: inner - 80, fontSize: 16, color: { token: 'bg' }, lineHeight: 1.5, name: 'Subhead', opacity: 0.72 });
      const btn = button(brand, btnC.label, btnC.url, PAD, sub.y + sub.h + S(28));
      const img = c.image ? image({ x: PAD, y: btn.y + btn.h + S(32), w: inner, h: 300, radius: Math.max(R, 10), name: 'Band image', alt: c.imageAlt || '', assetId: c.image, link: btnC.url, shadow: posterShadow(T) }) : null;
      h = (img ? img.y + img.h : btn.y + btn.h) + S(52) - y;
      kids.push(band(h, { token: 'ink' }, 'Band'), ...blobs(T, y, h, true), rect({ x: PAD, y: eyebrow.y - 14, w: 44, h: 3, fill: { token: 'primary' }, name: 'Rule' }), eyebrow, head, sub, btn, ...(img ? [img] : []));
      break;
    }
    case 'categories': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Cốc', url: `${B0}/cups` }, { name: 'Bát đĩa', url: `${B0}/plates` }, { name: 'Ấm trà', url: `${B0}/teapots` }]).slice(0, 4);
      const n = items.length, size = n > 3 ? 112 : 150, gap = n > 1 ? Math.floor((inner - n * size) / (n - 1)) : 0;
      const nodes: Node[] = [];
      items.forEach((it, i) => {
        const x = PAD + i * (size + gap);
        const img = image({ x, y: y + 20, w: size, h: size, radius: 999, name: `Category ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null });
        const label = text(brand, it.name, { x: x - 10, y: img.y + img.h + 10, w: size + 20, fontSize: 14, fontWeight: 600, align: 'center', name: 'Label' });
        nodes.push(group(`Category · ${it.name}`, [img, label], { link: it.url || null, alt: it.name }));
      });
      h = 20 + size + 10 + 24 + 20;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...nodes);
      break;
    }
    case 'social': {
      const avatars: Node[] = [];
      for (let i = 0; i < 5; i++) avatars.push(image({ x: PAD + i * 26, y: y + 22, w: 36, h: 36, radius: 999, name: `Avatar ${i + 1}`, alt: '' }));
      const stars = text(brand, '★★★★★', { x: PAD + 160, y: y + 18, w: 160, fontSize: 18, color: { token: 'accent' }, name: 'Stars', letterSpacing: 2 });
      const q = text(brand, c.quote || '4.9/5 từ 2.300 đánh giá', { x: PAD + 160, y: stars.y + stars.h + 2, w: inner - 160, fontSize: 14, fontWeight: 600, name: 'Social text' });
      const sub = text(brand, c.author || 'Khách mua lần hai chiếm 61%', { x: PAD + 160, y: q.y + q.h + 2, w: inner - 160, fontSize: 12, color: { token: 'muted' }, name: 'Social sub' });
      h = Math.max(sub.y + sub.h + 22 - y, 84);
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), rect({ x: PAD, y: y + h - 1, w: inner, h: 1, fill: { token: 'line' }, name: 'Line' }), ...avatars, stars, q, sub);
      break;
    }
    case 'cta-wide': {
      const d = DEF.cta; const btnC = c.button ?? d.button;
      const bh = 58;
      const bg = rect({ x: PAD, y: y + 20, w: inner, h: bh, fill: { token: 'primary' }, radius: T.btnRadius >= 999 ? 999 : Math.max(R, 12), name: 'Button bg', shadow: btnShadow(T, brand) });
      const t = text(brand, btnC.label, { x: PAD, y: y + 20, w: inner, h: bh, fontSize: 17, fontWeight: 800, color: { token: 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: btnC.label });
      const btn = group(`Button · ${btnC.label}`, [bg, t], { link: btnC.url, alt: btnC.label });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: y + 20 + bh + 12, w: inner, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Sub' });
      h = sub.y + sub.h + 22 - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), btn, sub);
      break;
    }
    case 'gallery': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [1, 2, 3].map((i) => ({ name: `Ảnh ${i}`, url: `${B0}/gallery/${i}` }))).slice(0, 6);
      const n = items.length, gap = 12, cols = n === 2 || n === 4 ? 2 : 3, rows = Math.ceil(n / cols);
      const cw = Math.floor((inner - gap * (cols - 1)) / cols), ch = cols === 2 ? Math.round(cw * 0.82) : cw;
      const captions = items.some((it) => it.price) || c.style === 'card';
      const sh = sectionHead(y + S(32), { eyebrow: c.eyebrow, heading: c.heading, link: c.link, align: 'center' });
      const top = sh.nodes.length ? sh.bottom : y + S(16);
      const capH = captions ? 46 : 0;
      const nodes: Node[] = [];
      items.forEach((it, i) => {
        const x = PAD + (i % cols) * (cw + gap), yy = top + Math.floor(i / cols) * (ch + capH + gap);
        const parts: Node[] = [image({ x, y: yy, w: cw, h: ch, radius: T.stroke ? 0 : RI, shadow: captions ? null : cardShadow(T), name: `Gallery ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null })];
        if (captions) { parts.push(text(brand, it.name, { x, y: yy + ch + 10, w: cw, fontSize: 13, fontWeight: 700, align: 'center', name: 'Caption' })); if (it.price) parts.push(text(brand, it.price, { x, y: yy + ch + 28, w: cw, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Price' })); }
        nodes.push(group(`Gallery · ${it.name}`, parts, { link: it.url || null, alt: it.name }));
      });
      h = top + rows * (ch + capH) + (rows - 1) * gap + S(28) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...sh.nodes, ...nodes);
      break;
    }
    case 'hero-center': {
      const d = DEF.band; const btnC = c.button ?? d.button;
      const style = c.style === 'ink' ? 'band' : (c.style || 'light');
      const onBand = style !== 'light';
      const fg = onBand ? { token: 'onPrimary' as const } : { token: 'ink' as const };
      const pillT = text(brand, up(c.eyebrow || d.eyebrow), { x: 0, y: 0, w: 400, fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: onBand ? { token: 'primary' } : { token: 'onPrimary' }, name: 'Eyebrow', align: 'center' });
      const pw = Math.ceil(measureWidth(brand, pillT)) + 28;
      const pill = rect({ x: Math.round((W - pw) / 2), y: y + S(44), w: pw, h: 28, fill: onBand ? { token: 'bg' } : { token: 'primary' }, radius: 999, name: 'Eyebrow pill' });
      pillT.x = pill.x; pillT.w = pw; pillT.y = pill.y + Math.round((28 - pillT.h) / 2);
      const head = H(c.headline || d.headline, { x: PAD, y: pill.y + pill.h + 20, w: inner, fontSize: hs(50), lineHeight: 1.0, color: fg, align: 'center', name: 'Headline', effect: fxFor(onBand) });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD + 36, y: head.y + head.h + 16, w: inner - 72, fontSize: 17, color: onBand ? { token: 'onPrimary' } : { token: 'muted' }, lineHeight: 1.5, align: 'center', name: 'Subhead', opacity: onBand ? 0.85 : 1 });
      const btn = centerBtn(button(brand, btnC.label, btnC.url, 0, sub.y + sub.h + S(26), { inverse: onBand }));
      const hasImg = !(c.image === null && !c.imageAlt);
      const img = hasImg ? image({ x: PAD, y: btn.y + btn.h + S(38), w: inner, h: 320, radius: Math.max(R, 10), name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null, shadow: posterShadow(T) }) : null;
      const bandH = (img ? img.y + Math.round(img.h * 0.5) : btn.y + btn.h + S(44)) - y;
      h = (img ? img.y + img.h + S(40) : btn.y + btn.h + S(44)) - y;
      const bg = style === 'gradient' ? rect({ x: 0, y, w: W, h: bandH, fill: null, gradient: { from: { token: 'primary' }, to: { token: 'accent' }, angle: 135 }, name: 'Band' }) : rect({ x: 0, y, w: W, h: bandH, fill: style === 'band' ? { token: 'primary' } : { token: 'bg' }, name: 'Band' });
      kids.push(band(h), bg, ...(onBand ? blobs(T, y, bandH, true) : []), pill, pillT, head, sub, btn, ...(img ? [img] : []));
      break;
    }
    case 'icon-row': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Xem video', body: '▶', url: `${B0}/videos` }, { name: 'Đọc sách', body: '📘', url: `${B0}/books` }, { name: 'Chơi game', body: '🎮', url: `${B0}/games` }, { name: 'Học cùng nhau', body: '💛', url: `${B0}/learn` }]).slice(0, 4);
      const n = items.length, cw = Math.floor(inner / n), sz = T.eyebrowPill ? 66 : 60;
      const nodes: Node[] = [];
      items.forEach((it, i) => {
        const cx = PAD + i * cw + cw / 2;
        const circ = rect({ x: Math.round(cx - sz / 2), y: y + 22, w: sz, h: sz, fill: c.tint ? { token: 'bg' } : { token: 'soft' }, radius: 999, name: 'Icon bg', stroke: T.shadow ? null : { color: { token: 'line' }, width: 1 }, shadow: T.shadow ? { blur: 14, y: 6, color: '#000000', opacity: 0.1 } : null });
        const g = text(brand, it.body || it.name.slice(0, 1), { x: circ.x, y: circ.y, w: sz, h: sz, fontSize: T.eyebrowPill ? 28 : 24, align: 'center', autoHeight: false, vAlign: 'middle', color: { token: 'primary' }, name: 'Icon' });
        const label = text(brand, it.name, { x: PAD + i * cw, y: circ.y + sz + 10, w: cw, fontSize: 12, fontWeight: 700, align: 'center', color: { token: 'ink' }, name: 'Label' });
        nodes.push(group(`Icon · ${it.name}`, [circ, g, label], { link: it.url || null, alt: it.name }));
      });
      h = 22 + sz + 10 + 36 + 16;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...nodes);
      break;
    }
    case 'checklist': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Thiết kế web 3D' }, { name: 'Logo & nhận diện' }, { name: 'UI/UX' }, { name: 'Hỗ trợ ra mắt' }]).slice(0, 6);
      let cy = y + S(30);
      const nodes: Node[] = [];
      if (c.heading) { const hd = H(c.heading, { x: PAD, y: cy, w: inner, fontSize: hs(28), lineHeight: 1.15, name: 'Heading' }); nodes.push(hd); cy = hd.y + hd.h + 16; }
      for (const it of items) {
        const circ = rect({ x: PAD, y: cy, w: 26, h: 26, fill: { token: 'primary' }, radius: 999, name: 'Check bg' });
        const ck = text(brand, '✓', { x: PAD, y: cy, w: 26, h: 26, fontSize: 13, fontWeight: 800, color: { token: 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: 'Check' });
        const t = text(brand, it.name, { x: PAD + 40, y: cy + 2, w: inner - 40, fontSize: 17, fontWeight: 600, name: it.name.slice(0, 20) });
        nodes.push(circ, ck, t);
        cy += Math.max(26, t.h) + 12;
      }
      h = cy + S(18) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...nodes);
      break;
    }
    case 'countdown': {
      const units = (c.stats && c.stats.length ? c.stats : [{ value: '06', label: 'Ngày' }, { value: '12', label: 'Giờ' }, { value: '24', label: 'Phút' }, { value: '18', label: 'Giây' }]).slice(0, 4);
      const gap = 10, n = units.length, tw = Math.floor((inner - gap * (n - 1)) / n), th = 76;
      const nodes: Node[] = [];
      let cy = y + 18;
      if (c.heading) { const hd = text(brand, c.heading, { x: PAD, y: cy, w: inner, fontSize: 13, fontWeight: 700, color: { token: 'muted' }, align: 'center', name: 'Countdown label' }); nodes.push(hd); cy = hd.y + hd.h + 10; }
      units.forEach((u, i) => {
        const x = PAD + i * (tw + gap);
        nodes.push(rect({ x, y: cy, w: tw, h: th, fill: c.tint ? { token: 'bg' } : { token: 'soft' }, radius: Math.min(R, 16), name: 'Tile', stroke: cardStroke(T), shadow: cardShadow(T) }));
        nodes.push(text(brand, u.value, { x, y: cy + 12, w: tw, fontSize: 28, fontWeight: 800, fontFamily: 'heading', align: 'center', color: { token: 'ink' }, name: 'Number' }));
        nodes.push(text(brand, u.label, { x, y: cy + 50, w: tw, fontSize: 11, color: { token: 'muted' }, align: 'center', name: 'Unit' }));
      });
      h = cy + th + 18 - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...nodes);
      break;
    }
    case 'spotlight': {
      const it: ItemC = (c.items && c.items[0]) || { name: c.heading || 'Tên sản phẩm', price: '', badge: '', url: c.button?.url || `${B0}/shop`, image: c.image ?? null };
      const btnC = c.button ?? { label: 'Xem chi tiết', url: it.url || `${B0}/shop` };
      const img = image({ x: PAD, y: y + S(24), w: inner, h: 340, radius: R, name: 'Spotlight image', alt: it.alt || it.name, assetId: it.image ?? c.image ?? null, link: it.url || btnC.url, shadow: cardShadow(T), fit: 'contain', fill: c.tint ? { token: 'bg' } : { token: 'soft' } });
      const disc = rect({ x: PAD + Math.round(inner / 2) - 130, y: img.y + 40, w: 260, h: 260, fill: { token: 'primary' }, radius: 999, opacity: 0.08, name: 'Disc' });
      const tagT = text(brand, it.name + (it.price ? `  ·  ${it.price}` : ''), { x: 0, y: 0, w: 320, fontSize: 13, fontWeight: 800, name: 'Tag' });
      const tw = Math.min(inner - 40, Math.ceil(measureWidth(brand, tagT)) + 28);
      const tag = rect({ x: PAD + inner - tw - 16, y: img.y + img.h - 54, w: tw, h: 38, fill: { token: 'bg' }, radius: T.btnRadius >= 999 ? 999 : Math.min(R, 12), name: 'Tag bg', shadow: { blur: 18, y: 6, color: '#000000', opacity: 0.22 } });
      tagT.x = tag.x + 14; tagT.w = tw - 28; tagT.y = tag.y + Math.round((38 - tagT.h) / 2);
      const parts: Node[] = [disc, img, tag, tagT];
      if (it.badge) { const bt = text(brand, it.badge, { x: 0, y: 0, w: 200, fontSize: 11, fontWeight: 800, color: { token: 'onPrimary' }, name: 'Badge' }); const bw = Math.ceil(measureWidth(brand, bt)) + 18; const bg = rect({ x: PAD + 14, y: img.y + 14, w: bw, h: 24, fill: { token: 'primary' }, radius: 999, name: 'Badge bg' }); bt.x = bg.x + 9; bt.w = bw - 18; bt.y = bg.y + Math.round((24 - bt.h) / 2); parts.push(bg, bt); }
      const head = H(c.headline || c.heading || it.name, { x: PAD, y: img.y + img.h + S(26), w: inner, fontSize: hs(30), lineHeight: 1.1, name: 'Heading' });
      const body = text(brand, c.body || c.subhead || it.body || 'Một đoạn mô tả ngắn: chất liệu, cảm giác, lý do nên có.', { x: PAD, y: head.y + head.h + 12, w: inner - 24, fontSize: 16, color: { token: 'muted' }, lineHeight: 1.55, name: 'Body' });
      const btn = button(brand, btnC.label, btnC.url, PAD, body.y + body.h + S(22));
      h = btn.y + btn.h + S(36) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...parts, head, body, btn);
      break;
    }
    case 'glass-hero': {
      const d = DEF.hero; const btnC = c.button ?? d.button;
      const cardX = PAD, cardW = inner, pad = 26;
      const btn = button(brand, btnC.label, btnC.url, cardX + pad, 0);
      const sub = text(brand, c.subhead || d.subhead, { x: cardX + pad, y: 0, w: cardW - pad * 2, fontSize: 16, color: '#FFFFFF', lineHeight: 1.5, name: 'Subhead', opacity: 0.9 });
      const head = H(c.headline || d.headline, { x: cardX + pad, y: 0, w: cardW - pad * 2, fontSize: hs(38), lineHeight: 1.04, color: '#FFFFFF', name: 'Headline' });
      const eb = text(brand, up(c.eyebrow || d.eyebrow), { x: cardX + pad, y: 0, w: cardW - pad * 2, fontSize: 11, fontWeight: 800, letterSpacing: 1.8, color: '#FFFFFF', name: 'Eyebrow', opacity: 0.85 });
      const cardH = pad + eb.h + 12 + head.h + 12 + sub.h + 20 + btn.h + pad;
      const HH = Math.max(520, cardH + 28 + S(56)); // the photo grows with the card
      const img = image({ x: 0, y, w: W, h: HH, name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null, overlay: { color: '#07100b', opacity: 0.3 } });
      const cardY = y + HH - 28 - cardH;
      const glass = rect({ x: cardX, y: cardY, w: cardW, h: cardH, fill: '#FFFFFF', opacity: 0.16, radius: R, name: 'Glass', stroke: { color: '#FFFFFF', width: 1 } });
      const glass2 = rect({ x: cardX, y: cardY, w: cardW, h: cardH, fill: null, radius: R, name: 'Glass edge', stroke: { color: '#FFFFFF', width: 1 }, opacity: 0.45 });
      eb.y = cardY + pad; head.y = eb.y + eb.h + 12; sub.y = head.y + head.h + 12;
      const by = sub.y + sub.h + 20; btn.children.forEach((k) => { k.y += by; }); btn.y = by;
      h = HH;
      kids.push(img, glass, glass2, eb, head, sub, syncGroup(btn));
      break;
    }
    case 'steps': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Chọn', body: 'Chọn mẫu hoặc tải ảnh lên.' }, { name: 'Chỉnh', body: 'Đổi chữ, màu, logo trong vài phút.' }, { name: 'Gửi', body: 'Tạo draft, duyệt và bấm gửi.' }]).slice(0, 4);
      const n = items.length, cols = n === 4 ? 2 : n, gap = 14, cw = Math.floor((inner - gap * (cols - 1)) / cols);
      const sh = sectionHead(y + S(36), { eyebrow: c.eyebrow, heading: c.heading, align: 'center' });
      let cy = sh.nodes.length ? sh.bottom + 4 : y + S(28);
      const cards: GroupNode[] = [];
      const rowBottoms: number[] = [];
      items.forEach((it, i) => {
        const col = i % cols, row = Math.floor(i / cols);
        if (col === 0 && row > 0) { cy = rowBottoms[row - 1] + gap; }
        const x = PAD + col * (cw + gap);
        const padC = cols === 3 ? 16 : 22;
        const parts: Node[] = [];
        let ny: number;
        if (T.bigNumerals) {
          const num = H(String(i + 1).padStart(2, '0'), { x: x + padC, y: cy + padC, w: cw - padC * 2, fontSize: hs(36), lineHeight: 1, color: { token: 'primary' }, name: 'Step no' });
          parts.push(num); ny = num.y + num.h + 12;
        } else {
          const circ = rect({ x: x + padC, y: cy + padC, w: 38, h: 38, fill: { token: 'primary' }, radius: 999, name: 'Step no bg' });
          const numT = text(brand, String(i + 1), { x: circ.x, y: circ.y, w: 38, h: 38, fontSize: 16, fontWeight: 800, color: { token: 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', fontFamily: 'heading', name: 'Step no' });
          parts.push(circ, numT); ny = circ.y + circ.h + 14;
        }
        const nm = H(it.name, { x: x + padC, y: ny, w: cw - padC * 2, fontSize: cols === 3 ? 17 : 19, lineHeight: 1.2, letterSpacing: T.track / 2, name: 'Step name' });
        const bd = text(brand, it.body || '', { x: x + padC, y: nm.y + nm.h + 8, w: cw - padC * 2, fontSize: cols === 3 ? 13 : 14, color: { token: 'muted' }, lineHeight: 1.5, name: 'Step body' });
        const ch = bd.y + bd.h + padC - cy;
        rowBottoms[row] = Math.max(rowBottoms[row] || 0, cy + ch);
        cards.push(group(`Step ${i + 1}`, [rect({ x, y: cy, w: cw, h: ch, fill: c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Card', shadow: cardShadow(T), stroke: cardStroke(T) }), ...parts, nm, bd], { link: it.url || null, alt: it.name }));
      });
      // equalise card heights per row
      cards.forEach((g, i) => { const row = Math.floor(i / cols); const card = g.children[0] as RectNode; card.h = rowBottoms[row] - card.y; });
      const bottom = rowBottoms[rowBottoms.length - 1];
      h = bottom + S(36) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...sh.nodes, ...cards.map((g) => syncGroup(g)));
      break;
    }
    case 'collage': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [1, 2, 3].map((i) => ({ name: `Ảnh ${i}`, url: `${B0}/gallery/${i}` }))).slice(0, 3);
      const gap = 12, leftW = Math.round(inner * 0.56), rightW = inner - leftW - gap, H0 = 320, smallH = Math.floor((H0 - gap) / 2);
      const nodes: Node[] = [];
      const a = items[0]; nodes.push(image({ x: PAD, y: y + 16, w: leftW, h: H0, radius: R, name: 'Collage 1', alt: a.alt || a.name, assetId: a.image ?? null, link: a.url || null, shadow: cardShadow(T) }));
      [items[1], items[2]].forEach((it, i) => { if (!it) return; nodes.push(image({ x: PAD + leftW + gap, y: y + 16 + i * (smallH + gap), w: rightW, h: smallH, radius: RI, name: `Collage ${i + 2}`, alt: it.alt || it.name, assetId: it.image ?? null, link: it.url || null, shadow: cardShadow(T) })); });
      h = H0 + 32;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...nodes);
      break;
    }
    case 'code': {
      const label = text(brand, up(c.eyebrow || 'Dùng mã'), { x: PAD, y: y + 24, w: inner, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: { token: 'muted' }, align: 'center', name: 'Code label' });
      const codeT = text(brand, up(c.headline || 'PHLOEM20'), { x: 0, y: 0, w: 300, fontSize: 22, fontWeight: 800, letterSpacing: 3, color: { token: 'ink' }, align: 'center', name: 'Code', fontFamily: 'heading' });
      const cw = Math.ceil(measureWidth(brand, codeT)) + 72;
      const box = rect({ x: Math.round((W - cw) / 2), y: label.y + label.h + 10, w: cw, h: 52, fill: { token: 'bg' }, radius: Math.min(R, 14), stroke: { color: { token: 'primary' }, width: 2 }, name: 'Code box', shadow: T.glow ? { blur: 20, y: 6, color: brand.primary, opacity: 0.25 } : cardShadow(T) });
      codeT.x = box.x + 16; codeT.w = cw - 60; codeT.y = box.y + Math.round((52 - codeT.h) / 2);
      const copy = text(brand, '⧉', { x: box.x + cw - 40, y: box.y, w: 28, h: 52, fontSize: 18, color: { token: 'primary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: 'Copy' });
      const note = c.subhead ? text(brand, c.subhead, { x: PAD, y: box.y + box.h + 10, w: inner, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Note' }) : null;
      h = (note ? note.y + note.h : box.y + box.h) + 24 - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), label, box, codeT, copy, ...(note ? [note] : []));
      break;
    }
    case 'stat-tiles': {
      const items = (c.stats && c.stats.length ? c.stats : [{ value: '+320%', label: 'doanh thu từ email' }, { value: '+45%', label: 'tỉ lệ mở' }, { value: '+62%', label: 'tỉ lệ click' }, { value: '2.8×', label: 'ROI 3 tháng' }]).slice(0, 4);
      const n = items.length, cols = n === 4 ? 2 : n, rows = n === 4 ? 2 : 1, gap = 12;
      const sh = sectionHead(y + S(32), { eyebrow: c.eyebrow, heading: c.heading, align: 'left' });
      const top = sh.nodes.length ? sh.bottom : y + S(20);
      const tw = Math.floor((inner - gap * (cols - 1)) / cols), th = 104;
      const nodes: Node[] = [];
      items.forEach((st, i) => {
        const x = PAD + (i % cols) * (tw + gap), ty = top + Math.floor(i / cols) * (th + gap);
        nodes.push(rect({ x, y: ty, w: tw, h: th, fill: i === 0 ? { token: 'primary' } : c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Tile', shadow: cardShadow(T), stroke: i === 0 ? null : cardStroke(T) }));
        nodes.push(H(st.value, { x: x + 18, y: ty + 18, w: tw - 36, fontSize: hs(34), lineHeight: 1, color: i === 0 ? { token: 'onPrimary' } : { token: 'primary' }, name: 'Value' }));
        nodes.push(text(brand, st.label, { x: x + 18, y: ty + 64, w: tw - 36, fontSize: 13, color: i === 0 ? { token: 'onPrimary' } : { token: 'muted' }, name: 'Label', opacity: i === 0 ? 0.85 : 1 }));
      });
      h = (top + rows * th + (rows - 1) * gap) + S(28) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...sh.nodes, ...nodes);
      break;
    }
    case 'articles': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [1, 2, 3].map((i) => ({ name: `Bài viết ${i}: tiêu đề ngắn gọn, hai dòng`, badge: `EP0${i}`, url: `${B0}/post/${i}` }))).slice(0, 3);
      const n = items.length, gap = 14, cw = Math.floor((inner - gap * (n - 1)) / n), ih = Math.round(cw * (n === 1 ? 0.56 : 0.72));
      const sh = sectionHead(y + S(32), { eyebrow: c.eyebrow, heading: c.heading, link: c.link });
      const top = sh.nodes.length ? sh.bottom : y + S(20);
      const nodes: Node[] = [];
      let bottom = y;
      items.forEach((it, i) => {
        const x = PAD + i * (cw + gap);
        const img = image({ x, y: top, w: cw, h: ih, radius: RI, name: `Article image ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null, shadow: cardShadow(T) });
        const parts: Node[] = [img];
        if (it.badge) { const bt = text(brand, it.badge, { x: 0, y: 0, w: 120, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: { token: 'onPrimary' }, name: 'Badge' }); const bw = Math.ceil(measureWidth(brand, bt)) + 14; const bg = rect({ x: x + 10, y: top + 10, w: bw, h: 20, fill: { token: 'primary' }, radius: 999, name: 'Badge bg' }); bt.x = x + 17; bt.w = bw - 14; bt.y = top + 10 + Math.round((20 - bt.h) / 2); parts.push(bg, bt); }
        const title = H(it.name, { x, y: top + ih + 12, w: cw, fontSize: n === 3 ? 15 : 18, lineHeight: 1.3, letterSpacing: 0, name: 'Title' });
        const more = text(brand, it.body || 'Đọc thêm →', { x, y: title.y + title.h + 6, w: cw, fontSize: 12, fontWeight: 700, color: { token: 'primary' }, name: 'Link' });
        parts.push(title, more);
        bottom = Math.max(bottom, more.y + more.h);
        nodes.push(group(`Article ${i + 1}`, parts, { link: it.url || null, alt: it.name }));
      });
      h = bottom + S(28) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...sh.nodes, ...nodes);
      break;
    }
    case 'hero-product': {
      // Stage for a product shot: giant centred headline, product floating in a soft glow, breaking out of the band.
      const d = DEF.band; const btnC = c.button ?? d.button;
      const style = c.style === 'band' ? 'band' : c.style === 'gradient' ? 'gradient' : c.style === 'soft' || c.style === 'light' ? 'soft' : 'ink';
      const onPrimary = style === 'band' || style === 'gradient';
      const soft = style === 'soft';
      const fg = onPrimary ? { token: 'onPrimary' as const } : soft ? { token: 'ink' as const } : { token: 'bg' as const };
      const pillT = text(brand, up(c.eyebrow || d.eyebrow), { x: 0, y: 0, w: 400, fontSize: 11, fontWeight: 800, letterSpacing: 1.8, color: onPrimary ? { token: 'primary' } : { token: 'onPrimary' }, name: 'Eyebrow', align: 'center' });
      const pw = Math.ceil(measureWidth(brand, pillT)) + 28;
      const pill = rect({ x: Math.round((W - pw) / 2), y: y + S(46), w: pw, h: 28, fill: onPrimary ? { token: 'bg' } : { token: 'primary' }, radius: 999, name: 'Eyebrow pill' });
      pillT.x = pill.x; pillT.w = pw; pillT.y = pill.y + Math.round((28 - pillT.h) / 2);
      const head = H(c.headline || d.headline, { x: PAD, y: pill.y + pill.h + 22, w: inner, fontSize: hs(50), lineHeight: 0.98, color: fg, align: 'center', name: 'Headline', effect: fxFor(!soft) });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD + 40, y: head.y + head.h + 16, w: inner - 80, fontSize: 17, color: soft ? { token: 'muted' } : fg, lineHeight: 1.5, align: 'center', name: 'Subhead', opacity: soft ? 1 : 0.78 });
      const btn = centerBtn(button(brand, btnC.label, btnC.url, 0, sub.y + sub.h + S(26), { inverse: onPrimary }));
      const iw = inner - 60, ih = 330;
      const img = image({ x: PAD + 30, y: btn.y + btn.h + S(30), w: iw, h: ih, name: 'Product image', alt: c.imageAlt || 'Sản phẩm', link: btnC.url, assetId: c.image ?? null, fit: 'contain', fill: null, floatShadow: !!c.image, tilt: c.tilt ? { rx: 0, ry: Math.max(-30, Math.min(30, c.tilt)) } : null });
      const props = propsAround(img.x, img.y, iw, ih);
      const cx = W / 2, cy = img.y + Math.round(ih * 0.5);
      h = img.y + ih + S(26) - y;
      const r1 = Math.min(240, y + h - cy - 6, cy - y - 6), r2 = Math.round(r1 * 0.62);
      const glowTok = onPrimary ? 'bg' : 'primary';
      const glow: Node[] = [
        rect({ x: Math.round(cx - r1), y: cy - r1, w: r1 * 2, h: r1 * 2, fill: null, gradient: { from: { token: glowTok, alpha: onPrimary ? 0.45 : soft ? 0.5 : 0.75 }, to: { token: glowTok, alpha: 0 }, angle: 0, radial: true }, name: 'Glow' }),
        rect({ x: Math.round(cx - r2), y: cy - r2, w: r2 * 2, h: r2 * 2, fill: null, gradient: { from: { token: 'accent', alpha: onPrimary ? 0.3 : 0.45 }, to: { token: 'accent', alpha: 0 }, angle: 0, radial: true }, name: 'Glow' }),
      ];
      const bandH = img.y + Math.round(ih * 0.66) - y;
      const bg = style === 'gradient' ? rect({ x: 0, y, w: W, h: bandH, fill: null, gradient: { from: { token: 'primary' }, to: { token: 'accent' }, angle: 135 }, name: 'Band' }) : rect({ x: 0, y, w: W, h: bandH, fill: style === 'band' ? { token: 'primary' } : soft ? { token: 'soft' } : { token: 'ink' }, name: 'Band' });
      const badge = c.badge ? badgeCircle(brand, c.badge, img.x + iw - 54, img.y + 36, 88, soft || onPrimary) : [];
      kids.push(band(h), bg, ...(soft ? [] : blobs(T, y, bandH, true)), pill, pillT, head, sub, btn, ...glow, ...props.slice(0, 2), img, ...props.slice(2), ...badge);
      break;
    }
    case 'ticker': {
      const words = (c.items && c.items.length ? c.items.map((i) => i.name) : c.headline ? c.headline.split(/\s*[✦•·|]\s*/) : ['Freeship toàn quốc', 'Đổi trả 30 ngày', 'Hàng mới mỗi tuần']).filter(Boolean).slice(0, 6);
      const line = words.map((w) => up(w)).join('   ✦   ');
      const t = text(brand, line, { x: 0, y: 0, w: 2000, fontSize: 12, fontWeight: 800, letterSpacing: 2.2, color: { token: 'onPrimary' }, name: 'Ticker' });
      const tw = Math.ceil(measureWidth(brand, t));
      const reps = tw < W ? Math.ceil((W + 200) / (tw + 60)) : 1;
      const full = Array.from({ length: reps }, () => line).join('   ✦   ');
      const tt = text(brand, full, { x: 0, y: 0, w: 4000, fontSize: 12, fontWeight: 800, letterSpacing: 2.2, color: { token: 'onPrimary' }, name: 'Ticker', lineHeight: 1 });
      const fw = Math.ceil(measureWidth(brand, tt));
      h = 46;
      tt.x = PAD; tt.w = fw; tt.y = y + Math.round((h - tt.h) / 2); // starts on a whole word; the right edge runs off like a marquee
      kids.push(band(h, { token: 'primary' }, 'Band'), tt);
      break;
    }
    case 'offer': {
      const st = (c.stats && c.stats[0]) || { value: '-30%', label: 'toàn bộ' };
      const btnC = c.button ?? { label: 'Mua ngay', url: `${B0}/sale` };
      const cardY = y + S(20), padC = 28, leftW = 200;
      const card = rect({ x: PAD, y: cardY, w: inner, h: 10, fill: null, gradient: { from: { token: 'primary' }, to: { token: 'accent' }, angle: 20 }, radius: R, name: 'Offer card', shadow: cardShadow(T) });
      const big = H(st.value, { x: PAD + padC, y: cardY + S(30), w: leftW, fontSize: hs(64), lineHeight: 0.95, color: { token: 'onPrimary' }, letterSpacing: T.track * 1.5, name: 'Big number' });
      const bl = text(brand, up(st.label), { x: PAD + padC, y: big.y + big.h + 8, w: leftW, fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: { token: 'onPrimary' }, name: 'Label', opacity: 0.8 });
      const rx = PAD + padC + leftW + 10, rw = inner - padC * 2 - leftW - 10;
      const head = H(c.heading || 'Toàn bộ bộ sưu tập', { x: rx, y: cardY + S(32), w: rw, fontSize: 24, lineHeight: 1.12, color: { token: 'onPrimary' }, name: 'Heading' });
      const sub = text(brand, c.subhead || 'Đến hết Chủ nhật. Không cần mã.', { x: rx, y: head.y + head.h + 8, w: rw, fontSize: 14, lineHeight: 1.5, color: { token: 'onPrimary' }, name: 'Sub', opacity: 0.85 });
      const btn = button(brand, btnC.label, btnC.url, rx, sub.y + sub.h + 16, { inverse: true, fontSize: 14, h: 42 });
      const cardH = Math.max(bl.y + bl.h, btn.y + btn.h) + S(30) - cardY;
      card.h = cardH;
      const deco = T.blobs ? [rect({ x: PAD + inner - 90, y: cardY - 14, w: 110, h: 110, fill: '#FFFFFF', radius: 999, opacity: 0.12, name: 'Blob' })] : [];
      h = cardH + S(40);
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), card, ...deco, big, bl, head, sub, btn);
      break;
    }
    case 'reviews': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Minh Anh', body: 'Mua lần đầu vì tò mò, mua lần hai vì chất lượng.', badge: 'Khách từ 2024' }, { name: 'Quốc Bảo', body: 'Giao nhanh, đóng gói đẹp, đúng như ảnh.', badge: 'Đã mua 3 lần' }, { name: 'Hà My', body: 'Dùng mỗi ngày, bền hơn mong đợi.', badge: 'Khách mới' }]).slice(0, 3);
      const n = items.length, gap = 14, cw = Math.floor((inner - gap * (n - 1)) / n), padC = n === 3 ? 16 : 20;
      const sh = sectionHead(y + S(36), { eyebrow: c.eyebrow, heading: c.heading, align: 'center' });
      const top = sh.nodes.length ? sh.bottom + 4 : y + S(24);
      const cards: GroupNode[] = [];
      let bottom = top;
      items.forEach((it, i) => {
        const x = PAD + i * (cw + gap);
        const stars = text(brand, '★★★★★', { x: x + padC, y: top + padC, w: cw - padC * 2, fontSize: 14, color: { token: 'accent' }, letterSpacing: 1.5, name: 'Stars' });
        const q = text(brand, `“${(it.body || '').replace(/^[“"]|[”"]$/g, '')}”`, { x: x + padC, y: stars.y + stars.h + 10, w: cw - padC * 2, fontSize: n === 3 ? 14 : 15, lineHeight: 1.5, color: { token: 'ink' }, name: 'Quote' });
        const who = text(brand, it.name, { x: x + padC, y: q.y + q.h + 12, w: cw - padC * 2, fontSize: 13, fontWeight: 800, name: 'Name' });
        const sub = it.badge || it.price ? text(brand, it.badge || it.price || '', { x: x + padC, y: who.y + who.h + 2, w: cw - padC * 2, fontSize: 12, color: { token: 'muted' }, name: 'Sub' }) : null;
        const ch = (sub ? sub.y + sub.h : who.y + who.h) + padC - top;
        bottom = Math.max(bottom, top + ch);
        cards.push(group(`Review ${i + 1}`, [rect({ x, y: top, w: cw, h: ch, fill: c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Card', shadow: cardShadow(T), stroke: cardStroke(T) }), stars, q, who, ...(sub ? [sub] : [])], { alt: it.name }));
      });
      cards.forEach((g) => { const card = g.children[0] as RectNode; card.h = bottom - top; });
      h = bottom + S(36) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...sh.nodes, ...cards.map((g) => syncGroup(g)));
      break;
    }
    case 'overlap': {
      const d = DEF.feature; const linkC = c.link ?? d.link;
      const img = image({ x: 0, y, w: W, h: 340, name: 'Overlap image', alt: c.imageAlt || d.imageAlt, assetId: c.image ?? null, link: linkC.url });
      const cardX = PAD + 12, cardW = inner - 24, padC = 26;
      const cardY = img.y + img.h - 72;
      let cy = cardY + padC;
      const eb = text(brand, up(c.eyebrow || 'Câu chuyện'), { x: cardX + padC, y: cy, w: cardW - padC * 2, fontSize: 11, fontWeight: 800, letterSpacing: 1.8, color: { token: 'primary' }, name: 'Eyebrow' });
      cy = eb.y + eb.h + 10;
      const head = H(c.heading || c.headline || d.heading, { x: cardX + padC, y: cy, w: cardW - padC * 2, fontSize: hs(28), lineHeight: 1.12, name: 'Heading' });
      const body = text(brand, c.body || d.body, { x: cardX + padC, y: head.y + head.h + 10, w: cardW - padC * 2, fontSize: 15, color: { token: 'muted' }, lineHeight: 1.55, name: 'Body' });
      const more = c.button ? button(brand, c.button.label, c.button.url, cardX + padC, body.y + body.h + 18, { fontSize: 14, h: 42 }) : text(brand, linkC.label, { x: cardX + padC, y: body.y + body.h + 14, w: cardW - padC * 2, fontSize: 14, fontWeight: 700, color: { token: 'primary' }, name: 'Link', link: linkC.url });
      const cardH = more.y + more.h + padC - cardY;
      h = cardY + cardH + S(32) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), img, rect({ x: cardX, y: cardY, w: cardW, h: cardH, fill: { token: 'bg' }, radius: R, name: 'Card', shadow: posterShadow(T) || cardShadow(T), stroke: cardStroke(T) }), eb, head, body, more);
      break;
    }
    case 'hero-card': {
      // Photo on a brand-colour band, a white card overlapping its bottom with centred copy (MeUndies-style).
      const d = DEF.hero; const btnC = c.button ?? d.button;
      const bandTok = c.style === 'soft' || c.style === 'light' ? 'soft' : c.style === 'dark' || c.style === 'ink' ? 'ink' : 'primary';
      const img = image({ x: PAD, y: y + S(24), w: inner, h: 400, radius: T.stroke ? 0 : Math.max(R, 10), name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null });
      const cardX = PAD + 14, cardW = inner - 28, padC = 30;
      const cardY = img.y + img.h - 80;
      const eb = text(brand, up(c.eyebrow || d.eyebrow), { x: cardX + padC, y: cardY + S(34), w: cardW - padC * 2, fontSize: 11, fontWeight: 800, letterSpacing: 3.2, color: { token: 'ink' }, align: 'center', name: 'Eyebrow', opacity: 0.8 });
      const head = H(c.headline || d.headline, { x: cardX + padC, y: eb.y + eb.h + 14, w: cardW - padC * 2, fontSize: hs(36), lineHeight: 1.08, align: 'center', name: 'Headline' });
      const sub = text(brand, c.subhead || d.subhead, { x: cardX + padC + 10, y: head.y + head.h + 14, w: cardW - padC * 2 - 20, fontSize: 15, lineHeight: 1.6, color: { token: 'muted' }, align: 'center', name: 'Subhead' });
      const btn = centerBtn(button(brand, up(btnC.label), btnC.url, 0, sub.y + sub.h + S(24), { fontSize: 13, radius: T.btnRadius >= 999 ? 999 : Math.min(T.btnRadius, 4) }));
      const cardH = btn.y + btn.h + S(34) - cardY;
      const bandH = cardY + Math.round(cardH * 0.5) - y;
      h = cardY + cardH + S(36) - y;
      const badge = c.badge ? badgeCircle(brand, c.badge, img.x + img.w - 56, img.y + 40, 88, false) : [];
      kids.push(band(h), rect({ x: 0, y, w: W, h: bandH, fill: { token: bandTok }, name: 'Band' }), img, ...badge, rect({ x: cardX, y: cardY, w: cardW, h: cardH, fill: { token: 'bg' }, radius: T.stroke ? 0 : R, name: 'Card', shadow: posterShadow(T) }), eb, head, sub, btn);
      break;
    }
    case 'zigzag': {
      // Lookbook rows: edge-to-edge photo on one side, copy on the other, alternating.
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Áo khoác gió', body: 'Ba lớp, chống nước, phản quang.', price: '1.290.000₫', url: `${B0}/p/1` }, { name: 'Quần jogger', body: 'Co giãn bốn chiều, túi khoá.', price: '690.000₫', url: `${B0}/p/2` }, { name: 'Mũ len', body: 'Len merino, một cỡ.', price: '290.000₫', url: `${B0}/p/3` }]).slice(0, 4);
      const rowH = 236, half = W / 2;
      const sh = sectionHead(y + S(32), { eyebrow: c.eyebrow, heading: c.heading, align: 'center' });
      let cy = sh.nodes.length ? sh.bottom : y;
      const rows: Node[] = [];
      items.forEach((it, i) => {
        const left = i % 2 === 0;
        const img = image({ x: left ? 0 : half, y: cy, w: half, h: rowH, name: `Zig image ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null, link: it.url || null });
        const tx = (left ? half : 0) + 30, tw = half - 60;
        const parts: TextNode[] = [];
        if (it.badge) parts.push(text(brand, up(it.badge), { x: tx, y: 0, w: tw, fontSize: 10, fontWeight: 800, letterSpacing: 2, color: { token: 'primary' }, name: 'Eyebrow' }));
        const nm = H(it.name, { x: tx, y: 0, w: tw, fontSize: 20, lineHeight: 1.18, letterSpacing: T.track / 2, name: 'Name' }); parts.push(nm);
        if (it.body) parts.push(text(brand, it.body, { x: tx, y: 0, w: tw, fontSize: 13, lineHeight: 1.55, color: { token: 'muted' }, name: 'Body' }));
        if (it.price) parts.push(text(brand, it.price, { x: tx, y: 0, w: tw, fontSize: 14, fontWeight: 800, color: { token: 'ink' }, name: 'Price' }));
        const link = text(brand, up(c.link?.label || 'Xem ngay →'), { x: tx, y: 0, w: tw, fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: { token: 'primary' }, name: 'Link', link: it.url || null }); parts.push(link);
        const totalH = parts.reduce((a, t) => a + t.h, 0) + (parts.length - 1) * 10;
        let ty = cy + Math.round((rowH - totalH) / 2);
        for (const t of parts) { t.y = ty; ty += t.h + 10; }
        rows.push(group(`Row ${i + 1} · ${it.name}`, [rect({ x: left ? half : 0, y: cy, w: half, h: rowH, fill: i % 2 === 0 ? { token: 'bg' } : { token: 'soft' }, name: 'Row bg' }), img, ...parts], { link: it.url || null, alt: it.name }));
        cy += rowH;
      });
      h = cy - y;
      kids.push(band(h), ...sh.nodes, ...rows);
      break;
    }
    case 'statement': {
      // One giant line of type, tracked label under it: "-50%" / "MEMBER ONLY".
      const dark = c.style === 'dark';
      const fg = dark ? { token: 'bg' as const } : { token: 'ink' as const };
      const big = H(c.headline || '-50%', { x: PAD, y: y + S(52), w: inner, fontSize: hs(76), lineHeight: 0.95, letterSpacing: T.track * 2, color: dark ? { token: 'bg' } : { token: 'primary' }, align: 'center', name: 'Statement', effect: fxFor(dark) });
      const lbl = text(brand, up(c.eyebrow || c.heading || 'Member only'), { x: PAD, y: big.y + big.h + 14, w: inner, fontSize: 13, fontWeight: 800, letterSpacing: 5, color: fg, align: 'center', name: 'Label' });
      const body = c.body || c.subhead ? text(brand, c.body || c.subhead || '', { x: PAD + 60, y: lbl.y + lbl.h + 14, w: inner - 120, fontSize: 14, lineHeight: 1.55, color: dark ? { token: 'bg' } : { token: 'muted' }, align: 'center', name: 'Body', opacity: dark ? 0.75 : 1 }) : null;
      const btn = c.button ? centerBtn(button(brand, c.button.label, c.button.url, 0, (body ? body.y + body.h : lbl.y + lbl.h) + S(22), { inverse: dark })) : null;
      const last = btn ? btn.y + btn.h : body ? body.y + body.h : lbl.y + lbl.h;
      h = last + S(52) - y;
      kids.push(band(h, dark ? { token: 'ink' } : c.tint ? { token: 'soft' } : { token: 'bg' }), big, lbl, ...(body ? [body] : []), ...(btn ? [btn] : []));
      break;
    }
    case 'menu': {
      // Dish / service rows: copy left, round photo right, price and a small button (food-delivery style).
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Phở bò tái', body: 'Nước dùng ninh 12 giờ, bánh phở tươi.', price: '65.000₫', url: `${B0}/menu/pho` }, { name: 'Bún chả', body: 'Chả nướng than, nước mắm pha nhà làm.', price: '55.000₫', url: `${B0}/menu/bun-cha` }, { name: 'Cà phê sữa', body: 'Robusta Buôn Ma Thuột, sữa đặc.', price: '29.000₫', url: `${B0}/menu/ca-phe` }]).slice(0, 4);
      const sh = sectionHead(y + S(32), { eyebrow: c.eyebrow, heading: c.heading, link: c.link, align: 'center' });
      let cy = sh.nodes.length ? sh.bottom : y + S(20);
      const gap = 14, padC = 20, photo = 108;
      const cards: Node[] = [];
      items.forEach((it, i) => {
        const cardY = cy;
        const tx = PAD + padC, tw = inner - padC * 2 - photo - 18;
        const nm = H(it.name, { x: tx, y: cardY + padC, w: tw, fontSize: 18, lineHeight: 1.2, letterSpacing: T.track / 2, name: 'Name' });
        const bd = text(brand, it.body || '', { x: tx, y: nm.y + nm.h + 6, w: tw, fontSize: 13, lineHeight: 1.5, color: { token: 'muted' }, name: 'Body' });
        const btn = button(brand, c.button?.label || 'Đặt ngay', it.url || c.button?.url || `${B0}/menu`, tx, bd.y + bd.h + 12, { fontSize: 12, h: 32 });
        const pr = it.price ? text(brand, it.price, { x: btn.x + btn.w + 12, y: btn.y + 7, w: 120, fontSize: 15, fontWeight: 800, color: { token: 'primary' }, name: 'Price' }) : null;
        const cardH = Math.max(btn.y + btn.h + padC, cardY + photo + padC * 2) - cardY;
        const img = image({ x: PAD + inner - padC - photo, y: cardY + Math.round((cardH - photo) / 2), w: photo, h: photo, radius: 999, name: `Dish ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null, shadow: cardShadow(T) });
        cards.push(group(`Menu · ${it.name}`, [rect({ x: PAD, y: cardY, w: inner, h: cardH, fill: c.tint ? { token: 'bg' } : { token: 'soft' }, radius: R, name: 'Card', stroke: cardStroke(T) }), img, nm, bd, syncGroup(btn), ...(pr ? [pr] : [])], { link: it.url || null, alt: `${it.name}${it.price ? ' — ' + it.price : ''}` }));
        cy = cardY + cardH + gap;
      });
      h = cy - gap + S(28) - y;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), ...sh.nodes, ...cards);
      break;
    }
    case 'divider': {
      h = 33;
      kids.push(band(h, c.tint ? { token: 'soft' } : { token: 'bg' }), T.stroke ? rect({ x: Math.round(W / 2 - 24), y: y + 15, w: 48, h: 2, fill: { token: 'primary' }, name: 'Ornament' }) : rect({ x: PAD, y: y + 16, w: inner, h: 1, fill: { token: 'line' }, name: 'Line' }));
      break;
    }
    case 'spacer': {
      h = 24;
      kids.push(band(h));
      break;
    }
    case 'footer': {
      const d = DEF.footer;
      const strip = c.style === 'band' || c.style === 'dark';
      const stripH = strip ? 58 : 0;
      const brandT = logoNode(brand, c, PAD, y + stripH + 40, 24, 'center', brand.links?.website || c.links?.[0]?.url || 'https://example.com', { token: 'soft' });
      const addr = text(brand, c.address || d.address, { x: PAD, y: brandT.y + brandT.h + 10, w: inner, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Address' });
      const unsub = text(brand, c.unsubscribeLabel || 'Huỷ đăng ký', { x: 0, y: addr.y + addr.h + 12, w: 90, fontSize: 12, color: { token: 'muted' }, align: 'right', underline: true, name: 'Unsubscribe', link: c.unsubscribeUrl || d.unsubscribeUrl });
      const prefs = text(brand, c.preferencesLabel || 'Cập nhật thông tin', { x: 0, y: unsub.y, w: 120, fontSize: 12, color: { token: 'muted' }, align: 'left', underline: true, name: 'Preferences', link: c.preferencesUrl || d.preferencesUrl });
      const uw = Math.ceil(measureWidth(brand, unsub)) + 2, pw = Math.ceil(measureWidth(brand, prefs)) + 2;
      unsub.w = uw; prefs.w = pw;
      const total = uw + 20 + pw; unsub.x = Math.round((W - total) / 2); prefs.x = unsub.x + uw + 20;
      const socials: Node[] = [];
      const GLYPH: Record<string, string> = { youtube: '▶', instagram: '◎', tiktok: '♪', facebook: 'f', x: 'X', twitter: 'X', linkedin: 'in', zalo: 'Z', website: '⌂' };
      const list = (c.social && c.social.length ? c.social : brand.links?.socials || []).slice(0, 6);
      if (strip) {
        // Brand strip on top: "Theo dõi" + icons, like the social bars of big retail emails.
        const stripFill = c.style === 'dark' ? { token: 'ink' as const } : { token: 'primary' as const };
        const fgTok = c.style === 'dark' ? contrastToken(brand, { token: 'ink' }) : 'onPrimary';
        socials.push(rect({ x: 0, y, w: W, h: stripH, fill: stripFill, name: 'Social strip' }));
        const lbl = text(brand, c.heading || 'Theo dõi', { x: PAD, y: y + 20, w: 200, fontSize: 13, fontWeight: 700, color: { token: fgTok }, name: 'Follow' });
        socials.push(lbl);
        const sz = 30, gap = 10; let sx = PAD + Math.ceil(measureWidth(brand, lbl)) + 18;
        for (const so of list) { const key = so.label.toLowerCase().replace(/[^a-z]/g, ''); const ring = rect({ x: sx, y: y + 14, w: sz, h: sz, fill: null, radius: 999, stroke: { color: { token: fgTok }, width: 1 }, name: `${so.label} ring`, opacity: 0.7 }); const g = text(brand, GLYPH[key] || so.label.slice(0, 1).toUpperCase(), { x: sx, y: y + 14, w: sz, h: sz, fontSize: 12, fontWeight: 800, color: { token: fgTok }, align: 'center', autoHeight: false, vAlign: 'middle', name: so.label }); socials.push(group(`Social · ${so.label}`, [ring, g], { link: so.url, alt: so.label })); sx += sz + gap; }
        if (c.link) { const t = text(brand, c.link.label, { x: W - PAD - 200, y: y + 21, w: 200, fontSize: 12, fontWeight: 700, color: { token: fgTok }, align: 'right', name: 'Strip link', link: c.link.url }); socials.push(t); }
      } else if (list.length) {
        const sz = 32, gap = 10;
        let sx = Math.round((W - (list.length * sz + (list.length - 1) * gap)) / 2);
        const sy = unsub.y + unsub.h + 18;
        for (const so of list) {
          const key = so.label.toLowerCase().replace(/[^a-z]/g, '');
          const bg = rect({ x: sx, y: sy, w: sz, h: sz, fill: { token: 'primary' }, radius: 999, name: `${so.label} bg` });
          const g = text(brand, GLYPH[key] || so.label.slice(0, 1).toUpperCase(), { x: sx, y: sy, w: sz, h: sz, fontSize: 13, fontWeight: 800, color: { token: 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: so.label });
          socials.push(group(`Social · ${so.label}`, [bg, g], { link: so.url, alt: so.label }));
          sx += sz + gap;
        }
      }
      const bottomRow = !strip && list.length ? unsub.y + unsub.h + 18 + 32 : unsub.y + unsub.h;
      h = bottomRow + 30 - y;
      kids.push(band(h, { token: 'soft' }), rect({ x: 0, y: y + h - 4, w: W, h: 4, fill: { token: 'primary' }, name: 'Accent bar' }), ...socials, brandT, addr, unsub, prefs);
      break;
    }
  }
  return group(BLOCKS.find((b) => b.kind === kind)?.name ?? kind, kids, { block: kind, content: c as Record<string, unknown> });
}

/** A block spec: kind + content. Templates and the AI composer both produce lists of these. */
export interface BlockSpec { kind: BlockKind; content?: BlockContent }

export const TINTABLE = new Set<BlockKind>(['products-2', 'products-3', 'feature-row', 'checklist', 'social', 'stats', 'steps', 'articles', 'quote', 'icon-row', 'badges', 'bento', 'categories', 'gallery', 'collage', 'spotlight', 'stat-tiles', 'countdown', 'code', 'text', 'reviews', 'offer', 'overlap', 'menu', 'statement']);
export const DARK = new Set<BlockKind>(['dark-band', 'hero-product', 'ticker', 'hero-card', 'hero-band']);
export function buildDoc(specs: BlockSpec[], brand: Brand): Doc {
  const nodes: Node[] = [];
  let y = 0;
  // Rhythm: content blocks alternate white / soft bands so long emails never read as one flat sheet; a dark band resets the beat.
  let tintNext = false;
  // The nav takes the colour of the band right under it (dark stage, brand band, soft band), so the top reads as one composition.
  specs = specs.map((sp, i) => {
    if (sp.kind !== 'nav' || sp.content?.style) return sp;
    const nx = specs[i + 1]; if (!nx) return sp;
    const st = nx.content?.style;
    let navStyle: BlockContent['style'] | undefined;
    if (nx.kind === 'hero-product') navStyle = st === 'band' || st === 'gradient' ? 'band' : st === 'soft' || st === 'light' ? 'soft' : 'dark';
    else if (nx.kind === 'dark-band' || nx.kind === 'hero-overlay' || nx.kind === 'glass-hero') navStyle = 'dark';
    else if (nx.kind === 'hero-band') navStyle = 'band';
    else if (nx.kind === 'hero-card') navStyle = st === 'soft' || st === 'light' ? 'soft' : st === 'dark' || st === 'ink' ? 'dark' : 'band';
    else if (nx.kind === 'hero-center' && (st === 'band' || st === 'gradient' || st === 'ink')) navStyle = 'band';
    else if (nx.kind === 'stats' && st === 'dark') navStyle = 'dark';
    return navStyle ? { ...sp, content: { ...(sp.content || {}), style: navStyle } } : sp;
  });
  specs = specs.map((sp) => {
    const st = sp.content?.style;
    if (DARK.has(sp.kind) || st === 'dark' || st === 'ink' || st === 'band' || st === 'gradient') { tintNext = false; return sp; }
    if (!TINTABLE.has(sp.kind)) return sp;
    const out = { ...sp, content: { ...(sp.content || {}), tint: tintNext } }; tintNext = !tintNext; return out;
  });
  for (const s of specs) { const g = makeBlock(s.kind, brand, y, s.content); nodes.push(g); y += g.h; }
  return { width: W, height: Math.max(y, 400), bg: { token: 'bg' }, nodes };
}

export interface TemplateDef { kind: TemplateKind; name: string; desc: string; blocks: BlockSpec[]; fields: EmailFields; preset?: string; brand?: Partial<Brand>; tag?: string }

const B = 'https://example.com';
const sampleBrand = 'Terra';
const navLinks = [{ label: 'Sản phẩm', url: `${B}/shop` }, { label: 'Bộ sưu tập', url: `${B}/collections` }, { label: 'Về Terra', url: `${B}/about` }];
const footer = { brand: sampleBrand, address: 'Terra Co. · 123 Lê Lợi, Quận 1, TP.HCM · hello@terra.vn' };

export const TEMPLATES: TemplateDef[] = [
  {
    kind: 'newsletter', name: 'Newsletter', desc: 'Hero ảnh · câu chuyện · ảnh + card đè · 3 bài · số liệu · trích dẫn · footer social', preset: 'Forest', brand: { vibe: 'editorial', headingFamily: 'Lora', name: 'Terra' },
    fields: { campaignName: 'Newsletter tháng 10', subject: 'Tháng này ở Terra: 3 điều đáng xem', preheader: 'Bộ sưu tập thu, cửa hàng mới và một câu chuyện nhỏ' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero', content: { eyebrow: 'Newsletter · Tháng 10', headline: 'Mùa thu về, bàn làm việc cũng cần thay áo', subhead: 'Ba món đồ gốm mới, một cửa hàng mới ở Đà Nẵng, và câu chuyện về người thợ làm ra chiếc cốc bạn đang dùng.', button: { label: 'Đọc tiếp', url: `${B}/journal/thu-2026` }, imageAlt: 'Bộ sưu tập gốm thu 2026 trên bàn gỗ' } },
      { kind: 'text', content: { style: 'center', eyebrow: 'Câu chuyện', heading: 'Một chiếc cốc mất 11 ngày để ra lò', body: 'Từ đất sét Bát Tràng đến men tro trấu, mỗi mẻ nung chỉ 40 chiếc. Chúng tôi kể lại từng bước, có cả những mẻ hỏng.' } },
      { kind: 'overlap', content: { eyebrow: 'Cửa hàng mới', heading: 'Terra đến Đà Nẵng', body: 'Khai trương 18/10 tại 56 Bạch Đằng. Giảm 15% cho 100 khách đầu tiên, có góc vuốt gốm thử.', link: { label: 'Xem bản đồ →', url: `https://example.com/stores/da-nang` }, imageAlt: 'Mặt tiền cửa hàng Terra Đà Nẵng' } },
      { kind: 'articles', content: { eyebrow: 'Mới trên blog', heading: 'Ba bài đáng đọc tháng này', items: [{ name: 'Một chiếc cốc mất 11 ngày để ra lò', badge: 'Câu chuyện', url: `https://example.com/journal/11-ngay` }, { name: 'Workshop vuốt gốm: còn 6 chỗ', badge: 'Sự kiện', url: `https://example.com/workshop` }, { name: 'Cách chọn cốc theo loại trà', badge: 'Hướng dẫn', url: `https://example.com/journal/chon-coc` }] } },
      { kind: 'stats', content: { stats: [{ value: '11 ngày', label: 'cho một chiếc cốc' }, { value: '40', label: 'chiếc mỗi mẻ nung' }, { value: '3', label: 'cửa hàng' }] } },
      { kind: 'quote', content: { style: 'center', quote: 'Tháng nào cũng đợi thư Terra. Đọc xong là muốn pha trà.', author: 'Lan Chi, Hà Nội' } },
      { kind: 'cta', content: { heading: 'Ghé Terra cuối tuần này', subhead: 'Uống thử trà trong cốc mới, không cần mua gì.', button: { label: 'Tìm cửa hàng gần bạn', url: `${B}/stores` } } },
      { kind: 'footer', content: { ...footer, style: 'band', social: [{ label: 'Instagram', url: 'https://instagram.com' }, { label: 'Facebook', url: 'https://facebook.com' }] } },
    ],
  },
  {
    kind: 'promo', name: 'Promo / Sale', desc: 'Poster chữ đùn khối 3D · ticker · 2 sản phẩm · đánh giá · CTA dải màu', preset: 'Coral', tag: '3d', brand: { headingFamily: 'Montserrat', name: 'Terra' },
    fields: { campaignName: 'Sale cuối tuần', subject: 'Giảm 30% đến hết Chủ nhật', preheader: 'Mã TERRA30 · Freeship toàn quốc' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-band', content: { effect: 'extrude', eyebrow: 'Chỉ 3 ngày', headline: 'Giảm 30% toàn bộ đồ gốm', subhead: 'Đến hết Chủ nhật 19/10. Nhập mã TERRA30 khi thanh toán. Freeship mọi đơn.', button: { label: 'Mua ngay', url: `${B}/sale` }, imageAlt: 'Bộ cốc và đĩa gốm đang giảm giá' } },
      { kind: 'ticker', content: { items: [{ name: 'Giảm 30%' }, { name: 'Freeship mọi đơn' }, { name: 'Đến hết Chủ nhật' }, { name: 'Mã TERRA30' }] } },
      { kind: 'products-2', content: { eyebrow: 'Đang giảm sâu', heading: 'Hai món bán chạy nhất', link: { label: 'Xem tất cả →', url: `${B}/sale` }, items: [{ name: 'Cốc men tro 300ml', oldPrice: '245.000₫', price: '171.000₫', badge: '-30%', url: `${B}/p/coc-men-tro` }, { name: 'Đĩa ăn 24cm', oldPrice: '320.000₫', price: '224.000₫', badge: '-30%', url: `${B}/p/dia-24` }] } },
      { kind: 'reviews', content: { eyebrow: '2.300 đánh giá', heading: 'Khách nói gì', items: [{ name: 'Minh Anh', body: 'Mua lần đầu vì tò mò, mua lần hai vì chất lượng.', badge: 'Khách từ 2024' }, { name: 'Quốc Bảo', body: 'Giao nhanh, đóng gói đẹp, đúng như ảnh.', badge: 'Đã mua 3 lần' }, { name: 'Hà My', body: 'Cốc giữ nhiệt tốt, cầm rất vừa tay.', badge: 'Khách mới' }] } },
      { kind: 'cta', content: { style: 'band', heading: 'Còn 72 giờ', subhead: 'Hàng giảm giá không áp dụng đổi trả. Mỗi mã dùng một lần.', button: { label: 'Xem tất cả sale', url: `${B}/sale` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'product-grid', name: 'Product grid', desc: 'Nav boutique · card trắng đè ảnh · 2 lưới có tiêu đề · chữ khổng lồ · footer social', preset: 'Mono', brand: { headingFamily: 'DM Sans', name: 'Terra' },
    fields: { campaignName: 'Hàng mới về', subject: 'Hàng mới về: 6 món vừa lên kệ', preheader: 'Chọn trước khi hết, mỗi mẫu chỉ 40 chiếc' },
    blocks: [
      { kind: 'nav', content: { style: 'menu', brand: sampleBrand, links: navLinks } },
      { kind: 'hero-card', content: { style: 'soft', eyebrow: 'Vừa lên kệ', headline: '6 món mới, mỗi mẫu 40 chiếc', subhead: 'Mẻ nung tháng 10 vừa ra lò. Lần trước hết trong 4 ngày.', button: { label: 'Xem tất cả', url: `https://example.com/new` }, imageAlt: 'Sáu món gốm mới xếp trên kệ gỗ' } },
      { kind: 'products-3', content: { eyebrow: 'Bàn ăn', heading: 'Cho bữa sáng chậm', items: [{ name: 'Cốc tai 250ml', price: '210.000₫', url: `${B}/p/1` }, { name: 'Bát cơm 12cm', price: '150.000₫', url: `${B}/p/2` }, { name: 'Ấm trà 600ml', price: '690.000₫', url: `${B}/p/3` }] } },
      { kind: 'products-3', content: { eyebrow: 'Bàn trà', heading: 'Cho buổi chiều', items: [{ name: 'Đĩa lót 15cm', price: '120.000₫', url: `${B}/p/4` }, { name: 'Lọ hoa nhỏ', price: '260.000₫', url: `${B}/p/5` }, { name: 'Bộ 4 chén trà', price: '380.000₫', url: `${B}/p/6` }] } },
      { kind: 'statement', content: { headline: 'Mua 2', eyebrow: 'Freeship toàn quốc', body: 'Áp dụng cho mọi đơn từ 2 món, không cần mã.', button: { label: 'Mua ngay', url: `https://example.com/new` } } },
      { kind: 'footer', content: { ...footer, style: 'band', social: [{ label: 'Instagram', url: 'https://instagram.com' }, { label: 'Facebook', url: 'https://facebook.com' }] } },
    ],
  },
  {
    kind: 'welcome', name: 'Welcome', desc: 'Dải màu chào mừng (bóng chữ 3D) · 4 lợi ích · 3 bước · trích dẫn · CTA · footer social', preset: 'Mint', tag: '3d', brand: { name: 'Terra' },
    fields: { campaignName: 'Welcome #1', subject: 'Chào mừng bạn đến Terra', preheader: 'Ưu đãi 10% cho đơn đầu tiên, dùng trong 7 ngày' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-band', content: { effect: 'shadow', eyebrow: 'Chào mừng', headline: 'Rất vui được gặp bạn', subhead: 'Cảm ơn bạn đã đăng ký. Đây là mã giảm 10% cho đơn đầu tiên: WELCOME10.', button: { label: 'Dùng mã ngay', url: `${B}/shop?code=WELCOME10` }, imageAlt: 'Người thợ gốm cầm chiếc cốc vừa ra lò' } },
      { kind: 'icon-row', content: { items: [{ name: 'Đổi trả 30 ngày', body: '↩', url: `https://example.com/returns` }, { name: 'Freeship từ 500k', body: '🚚', url: `https://example.com/shipping` }, { name: 'Gốm thủ công', body: '🏺', url: `https://example.com/about` }, { name: 'Gói quà miễn phí', body: '🎁', url: `https://example.com/gift` }] } },
      { kind: 'steps', content: { eyebrow: 'Bắt đầu thế nào', heading: 'Ba bước đến tách trà ngon', items: [{ name: 'Chọn cốc', body: 'Theo loại trà bạn hay uống.' }, { name: 'Dùng mã', body: 'WELCOME10 ở bước thanh toán.' }, { name: 'Nhận hàng', body: '48 giờ, gói kỹ trong rơm.' }] } },
      { kind: 'quote', content: { style: 'center', eyebrow: '★★★★★', quote: 'Mua lần đầu vì tò mò, mua lần hai vì chất lượng. Giao nhanh, đóng gói đẹp.', author: 'Minh Anh, khách từ 2024' } },
      { kind: 'cta', content: { style: 'band', heading: 'Bắt đầu với một chiếc cốc', subhead: 'Mã WELCOME10 có hiệu lực 7 ngày.', button: { label: 'Chọn cốc', url: `${B}/cups` } } },
      { kind: 'footer', content: { ...footer, style: 'band', social: [{ label: 'Instagram', url: 'https://instagram.com' }, { label: 'TikTok', url: 'https://tiktok.com' }] } },
    ],
  },
  {
    kind: 'cart', name: 'Cart reminder', desc: 'Lời nhắn căn giữa · 2 món có tiêu đề · đếm ngược · CTA tối', preset: 'Ocean',
    fields: { campaignName: 'Nhắc giỏ hàng', subject: 'Bạn để quên 2 món trong giỏ', preheader: 'Giữ giỏ hàng thêm 24 giờ, freeship nếu hoàn tất hôm nay' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'text', content: { style: 'center', eyebrow: 'Giỏ hàng của bạn', heading: 'Còn 2 món đang chờ', body: 'Chúng tôi giữ giỏ hàng thêm 24 giờ. Hoàn tất hôm nay để được freeship.' } },
      { kind: 'products-2', content: { eyebrow: 'Giỏ hàng của bạn', heading: 'Hai món đang chờ', link: { label: 'Mở giỏ →', url: `${B}/cart` }, items: [{ name: 'Cốc men tro 300ml', price: '245.000₫', url: `${B}/cart` }, { name: 'Đĩa ăn 24cm', price: '320.000₫', url: `${B}/cart` }] } },
      { kind: 'countdown', content: { heading: 'Giữ giỏ hàng thêm', stats: [{ value: '00', label: 'Ngày' }, { value: '23', label: 'Giờ' }, { value: '59', label: 'Phút' }, { value: '30', label: 'Giây' }] } },
      { kind: 'cta', content: { style: 'dark', heading: 'Hoàn tất đơn hàng', subhead: 'Tổng 565.000₫ · Freeship nếu thanh toán trong 24 giờ.', button: { label: 'Về giỏ hàng', url: `${B}/cart` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'launch', name: 'Ra mắt sản phẩm', desc: 'Hero sản phẩm 3D (chữ đùn khối, ảnh nghiêng, bóng nổi) · 3 điểm nổi bật · số liệu · đặt trước', preset: 'Royal', tag: '3d', brand: { headingFamily: 'Montserrat', name: 'Terra' },
    fields: { campaignName: 'Ra mắt Terra Thermo', subject: 'Ra mắt: Bình giữ nhiệt Terra Thermo 500ml', preheader: 'Giữ nóng 12 giờ, đặt trước giảm 20% đến 25/10' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-product', content: { style: 'ink', effect: 'extrude', tilt: 14, eyebrow: 'Sản phẩm mới', headline: 'Terra Thermo.', subhead: 'Bình giữ nhiệt 500ml đầu tiên của Terra. Giữ nóng 12 giờ, lạnh 24 giờ. Đặt trước giảm 20%.', button: { label: 'Đặt trước', url: `${B}/thermo` }, imageAlt: 'Bình giữ nhiệt Terra Thermo màu đất' } },
      { kind: 'feature-row', content: { heading: 'Vỏ gốm nung 1.250°C', body: 'Cầm ấm tay như cốc gốm, không bị trơn như kim loại.', link: { label: 'Xem chất liệu →', url: `${B}/thermo#material` }, imageAlt: 'Cận cảnh vỏ gốm' } },
      { kind: 'feature-row', content: { style: 'right', heading: 'Lõi thép 316 hai lớp', body: 'Chân không giữa hai lớp. Không ám mùi, rửa máy được.', link: { label: 'Xem cấu tạo →', url: `${B}/thermo#core` }, imageAlt: 'Mặt cắt lõi thép' } },
      { kind: 'feature-row', content: { heading: 'Nắp xoay kín, một tay mở', body: 'Thử 2.000 lần đóng mở, không rò.', link: { label: 'Xem video →', url: `${B}/thermo#lid` }, imageAlt: 'Nắp bình đang mở' } },
      { kind: 'stats', content: { style: 'dark', stats: [{ value: '12 giờ', label: 'giữ nóng' }, { value: '24 giờ', label: 'giữ lạnh' }, { value: '-20%', label: 'đặt trước' }] } },
      { kind: 'cta', content: { heading: 'Giao từ 1/11', subhead: 'Đặt trước đến 25/10. Thanh toán khi nhận hàng.', button: { label: 'Đặt trước 480.000₫', url: `${B}/thermo` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'event', name: 'Mời sự kiện', desc: 'Hero phủ ảnh (ngày giờ) · số liệu · lời mời căn giữa · chi tiết · CTA · footer social', preset: 'Plum', brand: { headingFamily: 'Playfair Display', name: 'Terra' },
    fields: { campaignName: 'Mời workshop 26/10', subject: 'Mời bạn: Workshop vuốt gốm sáng Chủ nhật', preheader: '26/10 · 9:00 · Terra Đà Nẵng · còn 6 chỗ' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-overlay', content: { eyebrow: 'Thứ Bảy 25/10 · 15:00', headline: 'Workshop vuốt gốm cùng Terra', subhead: 'Hai tiếng, một bàn xoay, mang về chiếc bát do chính tay bạn làm. Còn 6 chỗ.', button: { label: 'Giữ chỗ', url: `https://example.com/workshop` }, imageAlt: 'Học viên đang vuốt gốm trên bàn xoay' } },
      { kind: 'stats', content: { stats: [{ value: '26/10', label: 'Chủ nhật' }, { value: '9:00', label: 'đến 11:00' }, { value: '6', label: 'chỗ còn lại' }] } },
      { kind: 'text', content: { style: 'center', eyebrow: 'Chương trình', heading: 'Từ cục đất đến chiếc bát', body: '9:00 giới thiệu đất và men · 9:20 vuốt trên bàn xoay · 10:30 tạo hình miệng bát · 10:50 ký tên dưới đáy. Trà và bánh có sẵn.' } },
      { kind: 'feature-row', content: { heading: 'Địa điểm', body: 'Terra Đà Nẵng · 56 Bạch Đằng, Hải Châu. Có chỗ gửi xe máy.', link: { label: 'Mở bản đồ →', url: `${B}/stores/da-nang` }, imageAlt: 'Bản đồ cửa hàng' } },
      { kind: 'cta', content: { style: 'band', heading: 'Phí tham gia 350.000₫', subhead: 'Đã gồm đất, nung và một ly trà. Hoàn tiền nếu huỷ trước 24 giờ.', button: { label: 'Giữ chỗ ngay', url: `${B}/workshop/26-10` } } },
      { kind: 'footer', content: { ...footer, style: 'band', social: [{ label: 'Instagram', url: 'https://instagram.com' }, { label: 'Facebook', url: 'https://facebook.com' }] } },
    ],
  },
  {
    kind: 'digest', name: 'Bản tin biên tập', desc: 'Nav boutique · mở đầu căn giữa · 3 bài · zig-zag 2 món · trích dẫn · CTA', preset: 'Mono', brand: { vibe: 'editorial', headingFamily: 'Lora', name: 'Terra Journal' },
    fields: { campaignName: 'Digest tuần 42', subject: '3 bài đáng đọc tuần này', preheader: 'Men tro trấu, bàn ăn kiểu Nhật, và cách rửa gốm đúng' },
    blocks: [
      { kind: 'nav', content: { style: 'menu', brand: 'Terra Journal', links: [{ label: 'Câu chuyện', url: `https://example.com/journal` }, { label: 'Hướng dẫn', url: `https://example.com/guides` }, { label: 'Cửa hàng', url: `https://example.com/shop` }] } },
      { kind: 'text', content: { style: 'center', eyebrow: 'Tuần 42', heading: 'Ba bài đáng đọc, mười phút là xong', body: 'Tuần này chúng tôi viết về men, về cách bày bàn, và trả lời câu hỏi được hỏi nhiều nhất: rửa gốm thế nào cho đúng.' } },
      { kind: 'articles', content: { eyebrow: 'Số 12', heading: 'Ba câu chuyện tháng này', items: [{ name: 'Người thợ cuối cùng làm men tro ở Bát Tràng', badge: 'Câu chuyện', url: `https://example.com/journal/men-tro` }, { name: 'Pha trà bằng cốc gốm có gì khác?', badge: 'Hướng dẫn', url: `https://example.com/guides/pha-tra` }, { name: 'Bàn làm việc của một kiến trúc sư', badge: 'Góc nhà', url: `https://example.com/journal/ban-lam-viec` }] } },
      { kind: 'zigzag', content: { items: [{ name: 'Bộ ấm trà Sương', body: 'Men tro, 1 ấm 4 chén, hộp quà tre.', price: '1.290.000₫', url: `https://example.com/p/am-suong` }, { name: 'Đĩa lót 15cm', body: 'Dùng cho cốc và chén, bốn màu đất.', price: '120.000₫', url: `https://example.com/p/dia-lot` }] } },
      { kind: 'quote', content: { style: 'center', quote: 'Đọc xong số nào cũng thấy nhà mình thiếu một cái cốc.', author: 'Quốc Bảo, Sài Gòn' } },
      { kind: 'cta', content: { heading: 'Bạn thích chủ đề nào?', subhead: 'Trả lời email này, chúng tôi đọc hết.', button: { label: 'Xem tất cả bài', url: `${B}/journal` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'testimonial', name: 'Khách nói gì', desc: 'Hero ảnh · 3 card đánh giá · trích dẫn lớn · 2 món được khen · CTA dải màu', preset: 'Sunset',
    fields: { campaignName: 'Social proof', subject: '4.9/5 từ 2.300 đánh giá', preheader: 'Hai khách hàng kể lại, và hai món họ mua nhiều nhất' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero', content: { eyebrow: '2.300 đánh giá', headline: 'Khách hàng nói về Terra', subhead: 'Chúng tôi không viết quảng cáo. Đây là lời của người đã dùng.', button: { label: 'Đọc đánh giá', url: `${B}/reviews` }, imageAlt: 'Bàn ăn gia đình với đồ gốm Terra' } },
      { kind: 'reviews', content: { eyebrow: '2.300 đánh giá', heading: 'Khách nói gì về Terra', items: [{ name: 'Minh Anh', body: 'Mua lần đầu vì tò mò, mua lần hai vì chất lượng.', badge: 'Khách từ 2024' }, { name: 'Quốc Bảo', body: 'Giao nhanh, đóng gói đẹp, đúng như ảnh.', badge: 'Đã mua 3 lần' }, { name: 'Hà My', body: 'Cốc giữ nhiệt tốt, cầm rất vừa tay.', badge: 'Khách mới' }] } },
      { kind: 'quote', content: { style: 'center', eyebrow: '★★★★★', quote: 'Đóng gói kỹ đến mức tiếc giấy. Bát nặng tay, đựng canh không nóng tay.', author: '— Quốc Bảo, TP.HCM · ★★★★★' } },
      { kind: 'products-2', content: { eyebrow: 'Được khen nhiều nhất', heading: 'Hai món khách mua lại', items: [{ name: 'Cốc men tro 300ml · bán chạy #1', price: '245.000₫', url: `${B}/p/coc-men-tro` }, { name: 'Bát canh 16cm · bán chạy #2', price: '190.000₫', url: `${B}/p/bat-canh` }] } },
      { kind: 'cta', content: { style: 'band', heading: 'Thử một món, đổi trả 30 ngày', subhead: 'Không hợp thì gửi lại, Terra chịu phí ship.', button: { label: 'Mua món bán chạy', url: `${B}/bestsellers` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'seasonal', name: 'Sale theo mùa', desc: 'Poster bóng chữ 3D · ticker · 3 món · -40% khổng lồ · CTA dải màu', preset: 'Sunset', tag: '3d', brand: { headingFamily: 'Playfair Display', name: 'Terra' },
    fields: { campaignName: 'Tết 2027', subject: 'Quà Tết Terra: giảm 25%, gói sẵn, giao trước 28 Tết', preheader: 'Bộ quà 3 món từ 590.000₫ · đặt trước 20/1' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-band', content: { effect: 'shadow', eyebrow: 'Quà Tết 2027', headline: 'Quà gốm gói sẵn, giao trước 28 Tết', subhead: 'Giảm 25% bộ quà 3 món. Kèm thiệp viết tay và hộp giấy dó. Đặt trước 20/1 để chắc chắn kịp.', button: { label: 'Chọn bộ quà', url: `${B}/tet` }, imageAlt: 'Hộp quà Tết Terra với giấy dó và thiệp' } },
      { kind: 'ticker', content: { items: [{ name: 'Sale thu' }, { name: '-40% chọn lọc' }, { name: 'Freeship' }, { name: 'Đến 31/10' }] } },
      { kind: 'products-3', content: { eyebrow: 'Giảm sâu nhất', heading: 'Ba món của mùa', link: { label: 'Xem tất cả →', url: `${B}/sale` }, items: [{ name: 'Bộ trà 5 món', price: '890.000₫', url: `${B}/tet/tra` }, { name: 'Bộ bát đĩa 6 món', price: '1.190.000₫', url: `${B}/tet/ban-an` }, { name: 'Bộ cốc đôi', price: '590.000₫', url: `${B}/tet/coc-doi` }] } },
      { kind: 'statement', content: { headline: '-40%', eyebrow: 'Chỉ đến hết tháng', body: 'Áp dụng cho bộ sưu tập Thu. Không cần mã.', button: { label: 'Mua ngay', url: `https://example.com/sale` } } },
      { kind: 'cta', content: { style: 'band', heading: 'Đặt sớm, khỏi lo', subhead: 'Sau 20/1 chúng tôi không nhận đơn giao trước Tết.', button: { label: 'Đặt quà Tết', url: `${B}/tet` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'reengagement', name: 'Lâu không gặp', desc: 'Hero gradient chữ neon · 2 món mới · mã giảm · CTA tối', preset: 'Plum', tag: '3d',
    fields: { campaignName: 'Win-back', subject: 'Lâu rồi không gặp, Terra có món mới', preheader: 'Giảm 15% cho đơn quay lại, dùng trong 10 ngày' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-center', content: { style: 'gradient', effect: 'neon', eyebrow: 'Lâu không gặp', headline: 'Nhớ bạn rồi đó', subhead: 'Ba tháng rồi bạn chưa ghé. Terra có hai món mới và một mã giảm 15% để chào bạn quay lại.', button: { label: 'Xem có gì mới', url: `https://example.com/new` }, imageAlt: 'Góc bàn trà với cốc gốm mới' } },
      { kind: 'products-2', content: { eyebrow: 'Mới từ lần bạn ghé', heading: 'Hai món vừa ra lò', items: [{ name: 'Ấm trà 600ml · mới', price: '690.000₫', url: `${B}/p/am-tra` }, { name: 'Lọ hoa nhỏ · mới', price: '260.000₫', url: `${B}/p/lo-hoa` }] } },
      { kind: 'code', content: { eyebrow: 'Mã chào bạn quay lại', headline: 'COMEBACK15', subhead: 'Giảm 15%, dùng đến 31/10.' } },
      { kind: 'cta', content: { style: 'dark', heading: 'Mã COMEBACK15', subhead: 'Giảm 15% mọi đơn, hiệu lực 10 ngày, không áp dụng cùng mã khác.', button: { label: 'Xem món mới', url: `${B}/new?code=COMEBACK15` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'drop', name: 'Streetwear drop', desc: 'Dải tối chữ đùn khối 3D · ticker · nhãn · gallery · 3 món · CTA to', preset: 'Neon', tag: '3d', brand: { vibe: 'bold', headingFamily: 'Space Grotesk', name: 'VOLT' },
    fields: { campaignName: 'Drop 03', subject: 'DROP 03 mở bán 24.10 · 48 giờ', preheader: 'Áo khoác gió VOLT Wind, 300 chiếc, không restock' },
    blocks: [
      { kind: 'nav', content: { brand: 'VOLT', links: [{ label: 'Drop', url: `${B}/drop` }, { label: 'Lookbook', url: `${B}/lookbook` }, { label: 'Size', url: `${B}/size` }] } },
      { kind: 'dark-band', content: { effect: 'extrude', eyebrow: 'Drop 03 · 24.10 · 20:00', headline: 'VOLT WIND. 300 CHIẾC. KHÔNG RESTOCK.', subhead: 'Áo khoác gió 3 lớp, chống nước 10k, phản quang toàn thân. Mở bán 48 giờ hoặc đến khi hết.', button: { label: 'Vào hàng chờ', url: `${B}/drop/03` } } },
      { kind: 'ticker', content: { items: [{ name: 'Drop 03' }, { name: '300 chiếc' }, { name: 'Không restock' }, { name: '24.10 · 20:00' }] } },
      { kind: 'badges', content: { stats: [{ value: '300', label: 'chiếc' }, { value: '48h', label: 'mở bán' }, { value: 'Freeship', label: '' }, { value: 'Đổi size 7 ngày', label: '' }] } },
      { kind: 'gallery', content: { items: [{ name: 'Mặt trước', url: `${B}/drop/03` }, { name: 'Mặt sau phản quang', url: `${B}/drop/03` }, { name: 'Chi tiết khoá', url: `${B}/drop/03` }] } },
      { kind: 'products-3', content: { eyebrow: 'Ba màu', heading: 'Chọn màu của bạn', items: [{ name: 'Wind · Đen', price: '1.290.000₫', url: `${B}/p/wind-black` }, { name: 'Wind · Xám tro', price: '1.290.000₫', url: `${B}/p/wind-ash` }, { name: 'Wind · Neon', price: '1.390.000₫', badge: 'Mới', url: `${B}/p/wind-neon` }] } },
      { kind: 'cta-wide', content: { button: { label: 'Vào hàng chờ trước 20:00', url: `${B}/drop/03` }, subhead: 'Hàng chờ được mua trước 15 phút. Mỗi tài khoản 1 chiếc.' } },
      { kind: 'footer', content: { brand: 'VOLT', address: 'VOLT Studio · 12 Nguyễn Huệ, Q1, TP.HCM · drop@volt.vn' } },
    ],
  },
  {
    kind: 'bento', name: 'Ra mắt app', desc: 'Hero phủ ảnh · bento · số liệu nền tối · CTA to', preset: 'Midnight', tag: 'trend', brand: { headingFamily: 'Space Grotesk', name: 'Lumo' },
    fields: { campaignName: 'Lumo 2.0', subject: 'Lumo 2.0: ghi chú tự sắp xếp, offline, nhanh gấp đôi', preheader: 'Bản mới cho mọi người dùng, miễn phí nâng cấp' },
    blocks: [
      { kind: 'nav', content: { brand: 'Lumo', links: [{ label: 'Tính năng', url: `${B}/features` }, { label: 'Giá', url: `${B}/pricing` }, { label: 'Blog', url: `${B}/blog` }] } },
      { kind: 'hero-overlay', content: { eyebrow: 'Phiên bản 2.0', headline: 'Ghi chú tự sắp xếp. Bạn chỉ cần viết.', subhead: 'Lumo 2.0 gom ý tưởng rời rạc thành trang có cấu trúc, chạy offline, đồng bộ khi có mạng.', button: { label: 'Cập nhật miễn phí', url: `${B}/update` }, imageAlt: 'Giao diện Lumo 2.0 trên laptop' } },
      { kind: 'bento', content: { items: [{ name: 'Tự gom ý theo chủ đề', body: 'Viết liên tục, Lumo xếp thành mục. Không cần tag, không cần thư mục.', url: `${B}/features#organize` }, { name: 'Nhanh gấp 2×', body: 'Mở app dưới 300ms, tìm kiếm tức thì.', url: `${B}/features#speed` }, { name: 'Offline hoàn toàn', body: 'Máy bay, hầm, vùng sóng yếu: vẫn ghi.', url: `${B}/features#offline` }] } },
      { kind: 'stats', content: { style: 'dark', stats: [{ value: '300ms', label: 'mở app' }, { value: '1,2M', label: 'ghi chú mỗi ngày' }, { value: '4.8★', label: 'App Store' }] } },
      { kind: 'cta-wide', content: { button: { label: 'Cập nhật Lumo 2.0', url: `${B}/update` }, subhead: 'Miễn phí cho mọi tài khoản. Dữ liệu cũ giữ nguyên.' } },
      { kind: 'footer', content: { brand: 'Lumo', address: 'Lumo Labs · lumo.app · support@lumo.app' } },
    ],
  },
  {
        kind: 'luxe', name: 'Lookbook thời trang', desc: 'Card trắng đè ảnh · zig-zag · chữ khổng lồ · lưới 4 ảnh · trích dẫn · footer social', preset: 'Linen', tag: 'trend', brand: { vibe: 'luxury', headingFamily: 'Cormorant Garamond', name: 'MAISON' },
    fields: { campaignName: 'Sóng · Serum mới', subject: 'Serum Sóng No.3: 12 tuần, da đều màu', preheader: 'Công thức mới, giá ra mắt đến 31/10' },
    blocks: [
      { kind: 'nav', content: { style: 'menu', brand: 'MAISON', links: [{ label: 'Mới về', url: `${B}/new` }, { label: 'Áo', url: `${B}/tops` }, { label: 'Váy', url: `${B}/dresses` }, { label: 'Phụ kiện', url: `${B}/accessories` }] } },
      { kind: 'hero-card', content: { style: 'soft', eyebrow: 'Bộ sưu tập Thu', headline: 'Mềm như sớm mai', subhead: 'Len merino dệt thưa, cashmere Mông Cổ và lụa tơ tằm. Mười hai dáng, bốn tông màu đất.', button: { label: 'Xem bộ sưu tập', url: `${B}/fall` }, imageAlt: 'Người mẫu mặc áo len kem trên nền be' } },
      { kind: 'zigzag', content: { items: [{ name: 'Áo len Sương', body: 'Cổ tròn, len merino dệt thưa, nhẹ như không mặc.', price: '1.890.000₫', badge: 'Mới', url: `${B}/p/suong` }, { name: 'Váy lụa Hạ Tuần', body: 'Lụa tơ tằm Bảo Lộc, dáng suông, dài qua gối.', price: '2.450.000₫', url: `${B}/p/ha-tuan` }, { name: 'Khăn cashmere', body: 'Cashmere Mông Cổ, 70×200, bốn màu.', price: '1.290.000₫', url: `${B}/p/khan` }] } },
      { kind: 'statement', content: { headline: '-20%', eyebrow: 'Dành riêng thành viên', body: 'Đến hết 31/10. Tự động áp dụng khi đăng nhập.', button: { label: 'Mua sớm', url: `${B}/members` } } },
      { kind: 'gallery', content: { eyebrow: 'Phối cùng', heading: 'Bốn món mặc cả tuần', items: [{ name: 'Quần ống rộng', price: '1.650.000₫', url: `${B}/p/1` }, { name: 'Áo sơ mi lụa', price: '1.950.000₫', url: `${B}/p/2` }, { name: 'Giày loafer', price: '2.900.000₫', url: `${B}/p/3` }, { name: 'Túi da bò', price: '3.200.000₫', url: `${B}/p/4` }] } },
      { kind: 'quote', content: { style: 'center', quote: 'Chiếc áo len đầu tiên tôi mặc đi làm, đi chơi và đi ngủ trưa cuối tuần. Nhẹ, ấm, không ngứa.', author: 'Thu Hà, Hà Nội' } },
      { kind: 'footer', content: { style: 'band', brand: 'MAISON', address: 'Maison · 18 Nguyễn Huệ, Quận 1, TP.HCM · hello@maison.vn', social: [{ label: 'Instagram', url: 'https://instagram.com' }, { label: 'Facebook', url: 'https://facebook.com' }, { label: 'TikTok', url: 'https://tiktok.com' }], link: { label: 'Tìm cửa hàng', url: `${B}/stores` } } },
    ],
  },
  {
    kind: 'travel', name: 'Du lịch', desc: 'Hero phủ ảnh · danh mục · 2 gợi ý xen kẽ · lưới 4 điểm có giá · CTA to · footer social', preset: 'Ocean', tag: 'trend', brand: { headingFamily: 'Montserrat', name: 'Hành Trình' },
    fields: { campaignName: 'Đi Đà Lạt tháng 11', subject: 'Đà Lạt tháng 11: phòng view đồi từ 890k', preheader: 'Giữ chỗ không mất phí, huỷ miễn phí đến 48h trước' },
    blocks: [
      { kind: 'nav', content: { brand: 'Hành Trình', links: [{ label: 'Khách sạn', url: `${B}/hotels` }, { label: 'Tour', url: `${B}/tours` }, { label: 'Ưu đãi', url: `${B}/deals` }] } },
      { kind: 'hero-overlay', content: { eyebrow: 'Tháng 11 · mùa dã quỳ', headline: 'Đà Lạt đang vàng cả đồi', subhead: 'Phòng view đồi từ 890.000₫/đêm. Giữ chỗ không mất phí, huỷ miễn phí đến 48 giờ trước.', button: { label: 'Xem phòng', url: `${B}/da-lat` }, imageAlt: 'Đồi dã quỳ vàng ở Đà Lạt lúc bình minh' } },
      { kind: 'categories', content: { items: [{ name: 'Homestay', url: `${B}/da-lat/homestay` }, { name: 'Resort', url: `${B}/da-lat/resort` }, { name: 'Tour 1 ngày', url: `${B}/da-lat/tours` }] } },
      { kind: 'feature-row', content: { heading: 'Nhà gỗ Trăng Non · 1.190.000₫', body: '2 người, bữa sáng, bồn tắm nhìn ra thung lũng. Còn 3 đêm tuần này.', link: { label: 'Giữ chỗ →', url: `${B}/stay/trang-non` }, imageAlt: 'Nhà gỗ nhìn ra thung lũng' } },
      { kind: 'feature-row', content: { style: 'right', heading: 'Săn mây Cầu Đất · 350.000₫', body: 'Xuất phát 4:30, về 9:00, có xe đón và cà phê nóng.', link: { label: 'Đặt tour →', url: `${B}/tour/cau-dat` }, imageAlt: 'Biển mây ở Cầu Đất' } },
      { kind: 'gallery', content: { eyebrow: 'Gợi ý', heading: 'Bốn điểm đi cuối tuần', items: [{ name: 'Đà Lạt', price: 'từ 1.290.000₫', url: `https://example.com/da-lat` }, { name: 'Hội An', price: 'từ 990.000₫', url: `https://example.com/hoi-an` }, { name: 'Phú Quốc', price: 'từ 2.490.000₫', url: `https://example.com/phu-quoc` }, { name: 'Sa Pa', price: 'từ 1.590.000₫', url: `https://example.com/sa-pa` }] } },
      { kind: 'cta-wide', content: { button: { label: 'Giữ chỗ, không mất phí', url: `${B}/da-lat` }, subhead: 'Thanh toán khi nhận phòng. Huỷ miễn phí đến 48 giờ trước.' } },
      { kind: 'footer', content: { style: 'band', social: [{ label: 'Facebook', url: 'https://facebook.com' }, { label: 'Instagram', url: 'https://instagram.com' }, { label: 'TikTok', url: 'https://tiktok.com' }], brand: 'Hành Trình', address: 'Hành Trình Travel · 45 Trần Phú, Đà Lạt · chao@hanhtrinh.vn' } },
    ],
  },
  {
        kind: 'food', name: 'F&B ấm áp', desc: 'Hero nền soft + badge tròn · thực đơn ảnh tròn · trích dẫn · CTA · footer social', preset: 'Sunset', tag: 'trend', brand: { vibe: 'playful', headingFamily: 'Baloo 2', name: 'Bếp Nhà' },
    fields: { campaignName: 'Menu thu', subject: 'Menu thu đã lên: 6 món mới, giao nóng 30 phút', preheader: 'Giảm 20% đơn đầu qua app, hết 31/10' },
    blocks: [
      { kind: 'nav', content: { brand: 'Bếp Nhà', links: [{ label: 'Thực đơn', url: `${B}/menu` }, { label: 'Đặt bàn', url: `${B}/book` }, { label: 'Giao tận nơi', url: `${B}/delivery` }] } },
      { kind: 'hero-product', content: { style: 'soft', eyebrow: 'Món mới tuần này', headline: 'Bún bò Huế, nấu kiểu nhà', subhead: 'Nước dùng ninh 10 giờ từ xương ống và sả tươi. Giao nóng trong 30 phút quanh Quận 1, 3, Bình Thạnh.', button: { label: 'Đặt ngay', url: `${B}/menu/bun-bo` }, badge: '-30%', imageAlt: 'Tô bún bò Huế tách nền' } },
      { kind: 'menu', content: { eyebrow: 'Thực đơn', heading: 'Ba món gọi nhiều nhất', items: [{ name: 'Bún bò Huế', body: 'Giò heo, chả cua, rau sống Đà Lạt.', price: '69.000₫', url: `${B}/menu/bun-bo` }, { name: 'Cơm tấm sườn bì', body: 'Sườn nướng than, bì tươi, mỡ hành.', price: '59.000₫', url: `${B}/menu/com-tam` }, { name: 'Chè khúc bạch', body: 'Hạnh nhân, nhãn tươi, nước đường phèn.', price: '35.000₫', url: `${B}/menu/che` }], button: { label: 'Đặt ngay', url: `${B}/menu` } } },
      { kind: 'quote', content: { style: 'center', eyebrow: '★★★★★', quote: 'Đặt lúc 11:40, 12:05 đã có tô bún nóng hổi trên bàn. Nước dùng đậm đúng kiểu Huế.', author: 'Minh Quân, khách tuần nào cũng đặt' } },
      { kind: 'cta', content: { style: 'band', heading: 'Freeship đơn đầu tiên', subhead: 'Nhập mã NHA30 khi thanh toán. Áp dụng đến Chủ nhật.', button: { label: 'Xem thực đơn', url: `${B}/menu` } } },
      { kind: 'footer', content: { style: 'band', brand: 'Bếp Nhà', address: 'Bếp Nhà · 45 Lê Thánh Tôn, Quận 1, TP.HCM · 1900 1234', social: [{ label: 'Facebook', url: 'https://facebook.com' }, { label: 'Instagram', url: 'https://instagram.com' }, { label: 'Zalo', url: 'https://zalo.me' }], link: { label: 'Tải app đặt món', url: `${B}/app` } } },
    ],
  },
  {
    kind: 'flash', name: 'Flash sale', desc: 'Hero sản phẩm 3D trên dải màu (chữ đùn khối, badge tròn) · ticker · 3 món · đếm ngược · CTA to', preset: 'Coral', tag: '3d', brand: { vibe: 'bold', headingFamily: 'Montserrat', name: 'Terra' },
    fields: { campaignName: 'Flash sale 6 giờ', subject: '⚡ 6 giờ: giảm 40% ba món bán chạy', preheader: 'Từ 18:00 đến 24:00 hôm nay, hết là hết' },
    blocks: [
      { kind: 'nav', content: { brand: 'Terra', links: navLinks } },
      { kind: 'hero-product', content: { style: 'band', effect: 'extrude', tilt: 12, badge: '-50%', eyebrow: 'Flash sale · 4 giờ', headline: 'GIẢM NỬA GIÁ', subhead: 'Từ 20:00 đến 24:00 hôm nay. Ba món bán chạy nhất, số lượng có hạn.', button: { label: 'Mua ngay', url: `https://example.com/flash` }, imageAlt: 'Cốc gốm tách nền' } },
      { kind: 'ticker', content: { items: [{ name: 'Chỉ 4 giờ' }, { name: '-50%' }, { name: 'Freeship' }, { name: 'Hết là thôi' }] } },
      { kind: 'products-3', content: { eyebrow: 'Đang giảm 50%', heading: 'Ba món, bốn giờ', items: [{ name: 'Cốc men tro', oldPrice: '245.000₫', price: '147.000₫', badge: '-40%', url: `${B}/p/coc-men-tro` }, { name: 'Bát canh 16cm', oldPrice: '190.000₫', price: '114.000₫', badge: '-40%', url: `${B}/p/bat-canh` }, { name: 'Đĩa ăn 24cm', oldPrice: '320.000₫', price: '192.000₫', badge: '-40%', url: `${B}/p/dia-24` }] } },
      { kind: 'countdown', content: { heading: 'Kết thúc sau', stats: [{ value: '00', label: 'Ngày' }, { value: '03', label: 'Giờ' }, { value: '41', label: 'Phút' }, { value: '09', label: 'Giây' }] } },
      { kind: 'cta-wide', content: { button: { label: 'Vào flash sale', url: `${B}/flash` }, subhead: 'Giá đã giảm hiển thị trong giỏ. Không cần mã.' } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'fitness', name: 'Fitness · app', desc: 'Dải tối chữ neon · số liệu nền tối · 4 bước · trích dẫn · CTA to', preset: 'Mint', tag: '3d', brand: { vibe: 'bold', headingFamily: 'Space Grotesk', name: 'Fitly' },
    fields: { campaignName: 'Thử thách 21 ngày', subject: 'Thử thách 21 ngày bắt đầu thứ Hai', preheader: '15 phút mỗi sáng, có huấn luyện viên nhắn mỗi ngày' },
    blocks: [
      { kind: 'nav', content: { brand: 'Fitly', links: [{ label: 'Chương trình', url: `${B}/programs` }, { label: 'HLV', url: `${B}/coaches` }, { label: 'Cộng đồng', url: `${B}/community` }] } },
      { kind: 'dark-band', content: { effect: 'neon', eyebrow: 'Thử thách 21 ngày', headline: '15 PHÚT MỖI SÁNG. 21 NGÀY. XONG.', subhead: 'Bắt đầu thứ Hai 20/10. Huấn luyện viên nhắn bạn mỗi ngày. Bỏ 1 buổi vẫn tính, bỏ 3 buổi thì bắt đầu lại.', button: { label: 'Tham gia miễn phí', url: `${B}/21` } } },
      { kind: 'stats', content: { style: 'dark', stats: [{ value: '15′', label: 'mỗi ngày' }, { value: '21', label: 'ngày' }, { value: '8.400', label: 'người đã xong' }] } },
      { kind: 'steps', content: { eyebrow: 'Cách hoạt động', heading: 'Bốn tuần, một thói quen', items: [{ name: 'Đo', body: 'Nhập mục tiêu và lịch rảnh.' }, { name: 'Lịch', body: 'App xếp buổi tập 25 phút.' }, { name: 'Tập', body: 'Video dẫn, đếm nhịp, nhắc nghỉ.' }, { name: 'Tiến bộ', body: 'Báo cáo tuần, huy hiệu, streak.' }] } },
      { kind: 'quote', content: { quote: 'Lần đầu tôi tập đủ 21 ngày. Vì có người nhắn mỗi sáng.', author: '— Thanh Tùng, 34 tuổi, Hà Nội' } },
      { kind: 'cta-wide', content: { button: { label: 'Tham gia thử thách 20/10', url: `${B}/21` }, subhead: 'Miễn phí. Không cần thiết bị. Huỷ bất cứ lúc nào.' } },
      { kind: 'footer', content: { brand: 'Fitly', address: 'Fitly · fitly.vn · hi@fitly.vn' } },
    ],
  },
  {
    kind: 'kids', name: 'Giáo dục trẻ em', desc: 'Hero giữa chữ đùn khối · hàng icon · tập mới · lưới 4 thế giới · checklist · CTA to', preset: 'Candy', tag: '3d', brand: { vibe: 'playful', headingFamily: 'Be Vietnam Pro', name: 'DorisEdu Kids' },
    fields: { campaignName: 'Welcome DorisEdu', subject: 'Chào mừng đến DorisEdu Kids!', preheader: 'Video, sách, trò chơi cho bé từ 3–8 tuổi, an toàn 100%' },
    blocks: [
      { kind: 'nav', content: { brand: 'DorisEdu Kids', links: [{ label: 'Học', url: `${B}/learn` }, { label: 'Video', url: `${B}/videos` }, { label: 'Sách', url: `${B}/books` }, { label: 'Shop', url: `${B}/shop` }] } },
      { kind: 'hero-center', content: { effect: 'extrude', style: 'light', eyebrow: 'Xin chào bạn nhỏ', headline: 'Chào mừng đến DorisEdu Kids!', subhead: 'Một thế giới học tập vui vẻ: video 5 phút, sách tranh, trò chơi và những câu chuyện truyền cảm hứng cho bé mỗi ngày.', button: { label: 'Bắt đầu khám phá', url: `${B}/start` }, imageAlt: 'Bé gái và gấu bông cười tươi trước lâu đài' } },
      { kind: 'icon-row', content: { items: [{ name: 'Xem video', body: '▶', url: `${B}/videos` }, { name: 'Đọc sách', body: '📘', url: `${B}/books` }, { name: 'Chơi game', body: '🎮', url: `${B}/games` }, { name: 'Học cùng nhau', body: '💛', url: `${B}/together` }] } },
      { kind: 'articles', content: { items: [{ name: 'Động vật: 10 bạn thú đầu tiên', badge: 'EP01', url: `${B}/ep/1` }, { name: 'Gia đình: ai là ai trong nhà', badge: 'EP02', url: `${B}/ep/2` }, { name: 'Cơ thể: mắt, mũi, tay, chân', badge: 'EP03', url: `${B}/ep/3` }] } },
      { kind: 'gallery', content: { eyebrow: 'Góc chơi', heading: 'Bốn thế giới mới', items: [{ name: 'Rừng số', url: `https://example.com/worlds/rung` }, { name: 'Biển chữ', url: `https://example.com/worlds/bien` }, { name: 'Núi màu', url: `https://example.com/worlds/nui` }, { name: 'Phố nhạc', url: `https://example.com/worlds/pho` }] } },
      { kind: 'checklist', content: { heading: 'Vì sao bố mẹ yên tâm', items: [{ name: 'Nội dung được giáo viên duyệt' }, { name: 'Không quảng cáo, không chat lạ' }, { name: '15 phút mỗi ngày là đủ' }] } },
      { kind: 'cta-wide', content: { button: { label: 'Mở khoá 7 ngày miễn phí', url: `${B}/trial` }, subhead: 'Không cần thẻ. Huỷ bất cứ lúc nào.' } },
      { kind: 'footer', content: { brand: 'DorisEdu Kids', address: 'DorisEdu · 12 Nguyễn Văn Cừ, Q5, TP.HCM · hello@dorisedu.kids', social: [{ label: 'YouTube', url: `${B}/yt` }, { label: 'Instagram', url: `${B}/ig` }, { label: 'TikTok', url: `${B}/tt` }, { label: 'Facebook', url: `${B}/fb` }] } },
    ],
  },
  {
    kind: 'offer', name: 'Ưu đãi lớn', desc: 'Hero gradient chữ đùn khối · mã · đếm ngược · checklist · 3 gói · CTA to', preset: 'Lavender', tag: '3d', brand: { headingFamily: 'Montserrat', name: 'Doris Studio' },
    fields: { campaignName: 'Ưu đãi 20%', subject: 'Giảm 20% dự án tiếp theo của bạn, đến 1/11', preheader: 'Mã DORIS20 · web, 3D, game, thương hiệu' },
    blocks: [
      { kind: 'nav', content: { brand: 'Doris Studio', links: [{ label: 'Dịch vụ', url: `${B}/services` }, { label: 'Dự án', url: `${B}/work` }, { label: 'Liên hệ', url: `${B}/contact` }] } },
      { kind: 'hero-center', content: { effect: 'extrude', style: 'gradient', eyebrow: 'Ưu đãi có hạn · 3/8 – 1/11', headline: 'GIẢM 20% DỰ ÁN TIẾP THEO', subhead: 'Website, 3D, game, nhận diện thương hiệu. Chất lượng cao, đúng hạn, đúng brand.', button: { label: 'Nhận ưu đãi ngay', url: `${B}/offer` }, imageAlt: 'Hộp quà và tinh thể phát sáng' } },
      { kind: 'code', content: { eyebrow: 'Dùng mã khi đặt dự án', headline: 'DORIS20', subhead: 'Áp dụng cho mọi gói, không giới hạn số lần dùng đến 1/11.' } },
      { kind: 'countdown', content: { heading: 'Ưu đãi kết thúc sau', stats: [{ value: '06', label: 'Ngày' }, { value: '12', label: 'Giờ' }, { value: '24', label: 'Phút' }, { value: '18', label: 'Giây' }] } },
      { kind: 'checklist', content: { heading: 'Gói Website + Brand kit', items: [{ name: 'Thiết kế web 3D' }, { name: 'Logo & nhận diện' }, { name: 'UI/UX' }, { name: 'Hỗ trợ ra mắt' }] } },
      { kind: 'products-3', content: { eyebrow: 'Trong ưu đãi', heading: 'Ba gói được chọn nhiều', items: [{ name: 'Web 3D', oldPrice: '$2.000', price: '$1.600', badge: '-20%', url: `${B}/s/web` }, { name: 'Game world', oldPrice: '$3.500', price: '$2.800', badge: '-20%', url: `${B}/s/game` }, { name: 'Brand & visual', oldPrice: '$1.200', price: '$960', badge: '-20%', url: `${B}/s/brand` }] } },
      { kind: 'cta-wide', content: { button: { label: 'Bắt đầu dự án với -20%', url: `${B}/offer` }, subhead: 'Tư vấn miễn phí 30 phút trước khi ký.' } },
      { kind: 'footer', content: { brand: 'Doris Studio', address: 'Doris Studio · 3D web & game · hello@doris.studio', social: [{ label: 'Instagram', url: `${B}/ig` }, { label: 'TikTok', url: `${B}/tt` }, { label: 'LinkedIn', url: `${B}/li` }] } },
    ],
  },
  {
    kind: 'agency', name: 'Agency · dịch vụ', desc: 'Hero phủ ảnh · tiles kết quả · 4 bước · trích dẫn · CTA tối', preset: 'Neon', tag: 'trend', brand: { vibe: 'bold', headingFamily: 'Space Grotesk', name: 'Phloem Email' },
    fields: { campaignName: 'Agency intro', subject: 'Email đẹp. Chiến lược rõ. Chuyển đổi cao.', preheader: 'Case study: +320% doanh thu từ email trong 3 tháng' },
    blocks: [
      { kind: 'nav', content: { brand: 'Phloem Email', links: [{ label: 'Dịch vụ', url: `${B}/services` }, { label: 'Dự án', url: `${B}/work` }, { label: 'Giới thiệu', url: `${B}/about` }] } },
      { kind: 'hero-overlay', content: { eyebrow: 'Chào mừng đến Phloem Email', headline: 'Thiết kế email giúp thương hiệu lớn lên.', subhead: 'Chúng tôi làm chiến dịch, template và automation chuyển đổi cao cho thương hiệu hiện đại.', button: { label: 'Xem dự án', url: `${B}/work` }, imageAlt: 'Mockup email trên nền lá xanh' } },
      { kind: 'steps', content: { eyebrow: 'Cách làm việc', heading: 'Từ audit đến vận hành trong hai tuần', items: [{ name: 'Audit', body: 'Soát dữ liệu, kênh, hệ thống.' }, { name: 'Nhúng', body: 'Operator vào họp hằng ngày của bạn.' }, { name: 'Vận hành', body: 'Chạy chiến dịch, ship tính năng.' }, { name: 'Chịu kết quả', body: 'Báo cáo số, không báo cáo việc.' }] } },
      { kind: 'stat-tiles', content: { stats: [{ value: '+320%', label: 'doanh thu từ email' }, { value: '+45%', label: 'tỉ lệ mở' }, { value: '+62%', label: 'tỉ lệ click' }, { value: '2.8×', label: 'ROI trong 3 tháng' }] } },
      { kind: 'quote', content: { quote: 'Phloem Email thay đổi cách chúng tôi làm email. Kết quả tự nói lên tất cả.', author: '— Giám đốc marketing, thương hiệu lifestyle' } },
      { kind: 'cta', content: { style: 'dark', heading: 'Cùng làm chiến dịch tiếp theo', subhead: 'Gọi 30 phút, nhận bản phác thảo trong 48 giờ.', button: { label: 'Đặt lịch', url: `${B}/book` } } },
      { kind: 'footer', content: { brand: 'Phloem Email', address: 'Phloem Email · email design · hello@phloem.studio', social: [{ label: 'Instagram', url: `${B}/ig` }, { label: 'LinkedIn', url: `${B}/li` }, { label: 'Website', url: `${B}` }] } },
    ],
  },
  {
    kind: 'assets', name: 'Sản phẩm số · asset', desc: 'Hero dải màu · 2 lưới có tiêu đề · -30% khổng lồ · CTA to', preset: 'Sky', tag: 'trend', brand: { headingFamily: 'Montserrat', name: 'Doris Assets' },
    fields: { campaignName: 'Deal asset 3D', subject: 'Mua 1 tặng 1: 8 bộ asset 3D cho dự án tiếp theo', preheader: 'Giá từ $9, dùng thương mại, hết 1/11' },
    blocks: [
      { kind: 'nav', content: { brand: 'Doris Assets', links: [{ label: 'Asset', url: `${B}/assets` }, { label: 'Bộ sưu tập', url: `${B}/packs` }, { label: 'Giấy phép', url: `${B}/license` }] } },
      { kind: 'hero-center', content: { style: 'band', eyebrow: 'Mua 1 tặng 1 · đến 1/11', headline: 'Asset 3D cho dự án của bạn', subhead: 'Môi trường, nhân vật, UI, props. Dùng thương mại, cập nhật trọn đời.', button: { label: 'Xem deal', url: `${B}/deals` }, image: null } },
      { kind: 'products-3', content: { eyebrow: 'Bán chạy', heading: 'Bộ UI kit tuần này', items: [{ name: 'Nhà gỗ cổ tích', oldPrice: '$29', price: '$15', badge: 'Mua 1 tặng 1', url: `${B}/a/house` }, { name: 'Cây phong cách low-poly', oldPrice: '$19', price: '$9', badge: '-50%', url: `${B}/a/tree` }, { name: 'Cầu gỗ', oldPrice: '$25', price: '$12', badge: '-50%', url: `${B}/a/bridge` }] } },
      { kind: 'products-3', content: { eyebrow: 'Mới', heading: 'Icon & mockup vừa lên', items: [{ name: 'Đèn đường', oldPrice: '$15', price: '$8', badge: '-45%', url: `${B}/a/lamp` }, { name: 'Ghế công viên', oldPrice: '$18', price: '$9', badge: '-50%', url: `${B}/a/bench` }, { name: 'Đá & cỏ', oldPrice: '$22', price: '$11', badge: '-50%', url: `${B}/a/rocks` }] } },
      { kind: 'statement', content: { headline: '-30%', eyebrow: 'Gói trọn bộ', body: 'Mua trọn bộ 12 kit, tiết kiệm 30% so với mua lẻ. Đến Chủ nhật.', button: { label: 'Lấy trọn bộ', url: `https://example.com/bundle` } } },
      { kind: 'cta-wide', content: { button: { label: 'Mua asset, nhận quà', url: `${B}/deals` }, subhead: 'Tự động tặng sản phẩm rẻ hơn trong giỏ.' } },
      { kind: 'footer', content: { brand: 'Doris Assets', address: 'Doris Assets · doris.assets · support@doris.assets', social: [{ label: 'YouTube', url: `${B}/yt` }, { label: 'Instagram', url: `${B}/ig` }, { label: 'X', url: `${B}/x` }] } },
    ],
  },
  {
    kind: 'portfolio', name: 'Portfolio · case study', desc: 'Nav boutique · hero ảnh · tiles kết quả · zig-zag 3 case study · trích dẫn · CTA · footer social', preset: 'Lavender', tag: 'trend', brand: { vibe: 'luxury', headingFamily: 'Playfair Display', name: 'Doris' },
    fields: { campaignName: 'Case study tháng 10', subject: 'Từ ý tưởng đến thế giới sống động', preheader: 'Case study: website 3D giúp thương hiệu tăng 2.8× chuyển đổi' },
    blocks: [
      { kind: 'nav', content: { style: 'menu', brand: 'Doris Studio', links: [{ label: 'Dự án', url: `https://example.com/work` }, { label: 'Dịch vụ', url: `https://example.com/services` }, { label: 'Liên hệ', url: `https://example.com/contact` }] } },
      { kind: 'hero', content: { eyebrow: 'Case study', headline: 'Từ ý tưởng đến một thế giới sống động', subhead: 'Chúng tôi biến ý tưởng của một thương hiệu lifestyle thành trải nghiệm 3D giữ chân người xem 3 phút.', button: { label: 'Đọc case study', url: `${B}/case/lifestyle` }, imageAlt: 'Lâu đài nổi giữa thác nước, phong cách 3D' } },
      { kind: 'stat-tiles', content: { stats: [{ value: '+320%', label: 'tương tác người dùng' }, { value: '+150%', label: 'thời gian trên trang' }, { value: '2.8×', label: 'tỉ lệ chuyển đổi' }] } },
      { kind: 'zigzag', content: { eyebrow: 'Dự án gần đây', heading: 'Ba case study', items: [{ name: 'Terra · Nhận diện & web', body: 'Bộ nhận diện gốm thủ công, web bán hàng, 3 tháng.', badge: 'Thương hiệu', url: `https://example.com/work/terra` }, { name: 'Fitly · App fitness', body: 'UI/UX 48 màn, onboarding tăng 31% giữ chân.', badge: 'Sản phẩm', url: `https://example.com/work/fitly` }, { name: 'Lumo · Ra mắt', body: 'Landing, email, quảng cáo cho ngày ra mắt.', badge: 'Chiến dịch', url: `https://example.com/work/lumo` }] } },
      { kind: 'quote', content: { style: 'center', quote: 'Doris Studio biến tầm nhìn của chúng tôi thành một thế giới mà khách hàng không muốn rời đi.', author: '— CEO, thương hiệu lifestyle' } },
      { kind: 'cta', content: { style: 'band', heading: 'Có dự án trong đầu?', subhead: 'Tư vấn miễn phí, trả lời trong 24 giờ.', button: { label: 'Bắt đầu dự án', url: `${B}/start` } } },
      { kind: 'footer', content: { style: 'band', brand: 'Doris', address: 'Doris · 3D web & game designer · hi@doris.design', social: [{ label: 'Instagram', url: `${B}/ig` }, { label: 'TikTok', url: `${B}/tt` }, { label: 'LinkedIn', url: `${B}/li` }] } },
    ],
  },
  {
    kind: 'appkids', name: 'Game · app cho bé', desc: 'Hero sản phẩm nền soft (chữ đùn khối, badge) · hàng icon · mã quà · CTA to', preset: 'Sky', tag: '3d', brand: { vibe: 'playful', headingFamily: 'Be Vietnam Pro', name: 'HappyTown' },
    fields: { campaignName: 'HappyTown update', subject: 'Khám phá vùng đất mới trong HappyTown!', preheader: 'Nông trại, trang trí, câu cá, đua xe. Mã HAPPYTOWN25 tặng 50.000 xu' },
    blocks: [
      { kind: 'nav', content: { brand: 'HappyTown', links: [{ label: 'Chơi', url: `${B}/play` }, { label: 'Tin mới', url: `${B}/news` }, { label: 'Cộng đồng', url: `${B}/community` }] } },
      { kind: 'hero-product', content: { style: 'soft', effect: 'extrude', badge: 'Mới', eyebrow: 'Cập nhật tháng 10', headline: 'Bạn thỏ biết hát!', subhead: 'Thế giới Phố Nhạc mở cửa: 12 bài hát, 4 nhạc cụ, chơi cùng bố mẹ.', button: { label: 'Vào chơi ngay', url: `https://example.com/play` }, imageAlt: 'Nhân vật thỏ tách nền' } },
      { kind: 'icon-row', content: { items: [{ name: 'Bay tới đảo mới', body: '✈', url: `${B}/islands` }, { name: 'Trang trí nhà', body: '🏠', url: `${B}/house` }, { name: 'Mini game', body: '🏁', url: `${B}/minigames` }, { name: 'Thú cưng', body: '🐶', url: `${B}/pets` }] } },
      { kind: 'code', content: { eyebrow: 'Nhập mã trong game', headline: 'HAPPYTOWN25', subhead: 'Nhận 50.000 xu và 10 kim cương. Hết hạn 31/10.' } },
      { kind: 'cta-wide', content: { button: { label: 'Chơi HappyTown', url: `${B}/play` }, subhead: 'Miễn phí trên iOS và Android.' } },
      { kind: 'footer', content: { brand: 'HappyTown', address: 'HappyTown Games · happytown.app · hi@happytown.app', social: [{ label: 'YouTube', url: `${B}/yt` }, { label: 'Instagram', url: `${B}/ig` }, { label: 'TikTok', url: `${B}/tt` }, { label: 'Facebook', url: `${B}/fb` }] } },
    ],
  },
  { kind: 'blank', name: 'Trống', desc: 'Artboard 600px trắng', blocks: [], fields: { campaignName: 'Email mới', subject: '', preheader: '' } },
];

/** Brand a template was designed with: palette preset + its own fonts, on top of the caller's brand. */
export function templateBrand(def: TemplateDef, base: Brand, presets: { name: string; brand: Partial<Brand> }[]): Brand {
  const preset = presets.find((p) => p.name === def.preset)?.brand || {};
  return { ...base, ...preset, ...(def.brand || {}) };
}

export function makeTemplate(kind: TemplateKind, brand: Brand): { doc: Doc; fields: EmailFields; name: string; brand: Brand } {
  const def = TEMPLATES.find((t) => t.kind === kind) ?? TEMPLATES[0];
  const b: Brand = { ...brand, ...(def.brand || {}) };
  return { doc: buildDoc(def.blocks, b), fields: { ...def.fields }, name: def.name, brand: b };
}
