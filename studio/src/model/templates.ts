// Blocks and templates as document nodes. Every colour references a brand token, so picking a palette re-themes
// the whole email (bands, cards, eyebrows, prices, buttons, footer). Blocks take optional content so templates and
// the AI composer can fill real copy, products, images and links.
import type { BlockKind, TemplateKind } from '../../../src/shared/types';
import type { Brand, Doc, EmailFields, GroupNode, ImageNode, Node, RectNode, TextNode } from './types';
import { uid } from './types';
import { layoutText, textHeight } from '../render/textLayout';
import { syncGroup } from './ops';
import { assets } from '../storage/assets';

export const W = 600;
const PAD = 24;

const base = (name: string) => ({ id: uid(), name, visible: true, locked: false, opacity: 1, link: null as string | null, alt: '' });

export function text(brand: Brand, t: string, o: Partial<TextNode> & { x: number; y: number; w: number }): TextNode {
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
  const fs = o.fontSize ?? 15;
  const probe = text(brand, label, { x: 0, y: 0, w: 400, fontSize: fs, fontWeight: 700, name: label });
  const wText = Math.min(400, Math.ceil(measureWidth(brand, probe)));
  const w = o.w ?? wText + 56, h = o.h ?? 48;
  const bg = rect({ x, y, w, h, fill: { token: o.inverse ? 'bg' : 'primary' }, radius: o.radius ?? 8, name: 'Button bg' });
  const t = text(brand, label, { x, y, w, h, fontSize: fs, fontWeight: 700, color: { token: o.inverse ? 'primary' : 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: label });
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
  /** Footer social links (label is the network name). */
  social?: LinkC[];
  /** hero-center: 'light' (bg), 'band' (primary), 'gradient' (primary → accent). */
  style?: 'light' | 'band' | 'gradient';
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

const up = (s: string) => s.toUpperCase();
const B0 = 'https://example.com';

/** Brand logo slot: the uploaded logo image when the brand has one, otherwise the wordmark text. */
export function logoNode(brand: Brand, c: BlockContent, x: number, cy: number, h: number, align: 'left' | 'center', link: string): Node {
  if (brand.logoAssetId) {
    const meta = assets.get(brand.logoAssetId);
    const ratio = meta ? meta.w / Math.max(1, meta.h) : 3.2;
    const w = Math.max(40, Math.min(220, Math.round(h * ratio)));
    const xx = align === 'center' ? Math.round((W - w) / 2) : x;
    return image({ x: xx, y: Math.round(cy - h / 2), w, h, assetId: brand.logoAssetId, fit: 'contain', name: 'Logo', alt: brand.name, link });
  }
  const t = text(brand, up(c.brand || brand.name || 'BRAND'), { x: align === 'center' ? PAD : x, y: 0, w: align === 'center' ? W - PAD * 2 : 260, fontSize: h >= 28 ? 18 : 13, fontWeight: 800, letterSpacing: 1.5, name: 'Logo', link, align: align === 'center' ? 'center' : 'left' });
  t.y = Math.round(cy - t.h / 2);
  return t;
}

export function makeBlock(kind: BlockKind, brand: Brand, y: number, c: BlockContent = {}): GroupNode {
  const kids: Node[] = [];
  let h = 0;
  const band = (hh: number, fill: RectNode['fill'] = { token: 'bg' }, name = 'Block bg') => rect({ x: 0, y, w: W, h: hh, fill, name });
  const inner = W - PAD * 2;
  switch (kind) {
    case 'nav': {
      h = 68;
      kids.push(band(h));
      kids.push(rect({ x: 0, y, w: W, h: 4, fill: { token: 'primary' }, name: 'Accent bar' }));
      kids.push(logoNode(brand, c, PAD, y + 34, 30, 'left', c.links?.[0]?.url ? c.links[0].url.replace(/\/[^/]*$/, '') : 'https://example.com'));
      const links = (c.links && c.links.length ? c.links : DEF.links).slice(0, 4);
      let x = W - PAD;
      for (let i = links.length - 1; i >= 0; i--) {
        const t = text(brand, links[i].label, { x: 0, y: y + 27, w: 120, fontSize: 14, fontWeight: 500, color: { token: 'muted' }, align: 'right', name: links[i].label, link: links[i].url });
        const tw = Math.ceil(measureWidth(brand, t)) + 2; t.w = tw; t.x = x - tw; x -= tw + 22;
        kids.push(t);
      }
      break;
    }
    case 'hero': {
      const d = DEF.hero;
      const imgH = 360;
      const btnC = c.button ?? d.button;
      const img = image({ x: 0, y, w: W, h: imgH, name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null });
      let cy = y + imgH + 30;
      const eyebrow = c.eyebrow !== '' ? text(brand, up(c.eyebrow || d.eyebrow), { x: PAD, y: cy, w: inner, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: { token: 'primary' }, name: 'Eyebrow' }) : null;
      if (eyebrow) cy = eyebrow.y + eyebrow.h + 10;
      const head = text(brand, c.headline || d.headline, { x: PAD, y: cy, w: inner, fontSize: 32, fontWeight: 800, lineHeight: 1.18, fontFamily: 'heading', name: 'Headline' });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: head.y + head.h + 12, w: inner, fontSize: 16, color: { token: 'muted' }, lineHeight: 1.55, name: 'Subhead' });
      const btn = button(brand, btnC.label, btnC.url, PAD, sub.y + sub.h + 22);
      h = btn.y + btn.h + 36 - y;
      kids.push(band(h), img, ...(eyebrow ? [eyebrow] : []), head, sub, btn);
      break;
    }
    case 'hero-band': {
      const d = DEF.band;
      const btnC = c.button ?? d.button;
      const eyebrow = text(brand, up(c.eyebrow || d.eyebrow), { x: PAD, y: y + 40, w: inner, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: { token: 'onPrimary' }, name: 'Eyebrow', opacity: 0.8 });
      const head = text(brand, c.headline || d.headline, { x: PAD, y: eyebrow.y + eyebrow.h + 12, w: inner, fontSize: 38, fontWeight: 800, lineHeight: 1.12, fontFamily: 'heading', color: { token: 'onPrimary' }, name: 'Headline' });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: head.y + head.h + 14, w: inner, fontSize: 16, color: { token: 'onPrimary' }, lineHeight: 1.5, name: 'Subhead', opacity: 0.85 });
      const btn = button(brand, btnC.label, btnC.url, PAD, sub.y + sub.h + 24, { inverse: true });
      const bandH = btn.y + btn.h + 40 - y;
      const img = image({ x: 0, y: y + bandH, w: W, h: 300, name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null });
      h = bandH + img.h;
      kids.push(band(bandH, { token: 'primary' }, 'Band'), eyebrow, head, sub, btn, img);
      break;
    }
    case 'text': {
      const d = DEF.text;
      let cy = y + 28;
      const eyebrow = c.eyebrow !== '' ? text(brand, up(c.eyebrow || d.eyebrow), { x: PAD, y: cy, w: inner, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: { token: 'primary' }, name: 'Eyebrow' }) : null;
      if (eyebrow) cy = eyebrow.y + eyebrow.h + 8;
      const head = text(brand, c.heading || d.heading, { x: PAD, y: cy, w: inner, fontSize: 24, fontWeight: 700, lineHeight: 1.25, fontFamily: 'heading', name: 'Heading' });
      const body = text(brand, c.body || d.body, { x: PAD, y: head.y + head.h + 10, w: inner, fontSize: 15, lineHeight: 1.6, name: 'Paragraph' });
      h = body.y + body.h + 28 - y;
      kids.push(band(h), ...(eyebrow ? [eyebrow] : []), head, body);
      break;
    }
    case 'cta': {
      const d = DEF.cta;
      const btnC = c.button ?? d.button;
      const cardY = y + 16;
      const head = text(brand, c.heading || d.heading, { x: PAD + 24, y: cardY + 28, w: inner - 48, fontSize: 22, fontWeight: 700, align: 'center', fontFamily: 'heading', name: 'Heading' });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD + 24, y: head.y + head.h + 6, w: inner - 48, fontSize: 14, color: { token: 'muted' }, align: 'center', name: 'Sub' });
      const btn = button(brand, btnC.label, btnC.url, 0, sub.y + sub.h + 18);
      btn.x = Math.round((W - btn.w) / 2); const dx = btn.x - btn.children[0].x; btn.children.forEach((k) => { k.x += dx; });
      const cardH = btn.y + btn.h + 28 - cardY;
      h = cardH + 32;
      kids.push(band(h), rect({ x: PAD, y: cardY, w: inner, h: cardH, fill: { token: 'soft' }, radius: 12, name: 'Card' }), head, sub, syncGroup(btn));
      break;
    }
    case 'products-2':
    case 'products-3': {
      const n = kind === 'products-3' ? 3 : 2;
      const gap = 16, cw = Math.floor((inner - gap * (n - 1)) / n);
      const items: ItemC[] = (c.items && c.items.length ? c.items : Array.from({ length: n }, (_, i) => ({ name: n === 3 ? `Sản phẩm ${i + 1}` : `Tên sản phẩm ${i + 1}`, price: '450.000₫', url: `https://example.com/products/item-${i + 1}` }))).slice(0, n);
      while (items.length < n) items.push({ name: `Sản phẩm ${items.length + 1}`, price: '', url: 'https://example.com/shop' });
      const cards: Node[] = [];
      let bottom = y;
      items.forEach((it, i) => {
        const x = PAD + i * (cw + gap);
        const url = it.url || 'https://example.com/shop';
        const top = y + 16;
        const img = image({ x, y: top, w: cw, h: cw, radius: 10, name: `Product image ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null });
        const name = text(brand, it.name, { x: x + 12, y: img.y + img.h + 12, w: cw - 24, fontSize: n === 3 ? 14 : 16, fontWeight: 600, name: 'Name' });
        const extra: Node[] = [];
        let last: TextNode = name;
        if (it.oldPrice) { const o = text(brand, it.oldPrice, { x: x + 12, y: last.y + last.h + 4, w: cw - 24, fontSize: 12, color: { token: 'muted' }, strike: true, name: 'Old price' }); extra.push(o); last = o; }
        if (it.price) { const pr = text(brand, it.price, { x: x + 12, y: last.y + last.h + (it.oldPrice ? 2 : 4), w: cw - 24, fontSize: n === 3 ? 15 : 16, fontWeight: 800, color: { token: 'primary' }, name: 'Price' }); extra.push(pr); last = pr; }
        if (it.badge) { const bt = text(brand, it.badge, { x: 0, y: 0, w: 200, fontSize: 11, fontWeight: 800, color: { token: 'onPrimary' }, name: 'Badge' }); const bw = Math.ceil(measureWidth(brand, bt)) + 16; const bg = rect({ x: x + 8, y: top + 8, w: bw, h: 22, fill: { token: 'primary' }, radius: 999, name: 'Badge bg' }); bt.x = x + 16; bt.w = bw - 16; bt.y = top + 8 + Math.round((22 - bt.h) / 2); extra.push(bg, bt); }
        const cardH = last.y + last.h + 14 - top;
        const card = rect({ x, y: top, w: cw, h: cardH, fill: { token: 'soft' }, radius: 12, name: 'Card' });
        bottom = Math.max(bottom, top + cardH);
        cards.push(group(`Product ${i + 1}`, [card, img, name, ...extra], { link: url, alt: `${it.name}${it.price ? ' — ' + it.price : ''}` }));
      });
      h = bottom + 16 - y;
      kids.push(band(h), ...cards);
      break;
    }
    case 'feature-row': {
      const d = DEF.feature;
      const linkC = c.link ?? d.link;
      const cardY = y + 12, imgW = 232, imgH = 180;
      const img = image({ x: PAD + 14, y: cardY + 14, w: imgW, h: imgH, radius: 8, name: 'Feature image', alt: c.imageAlt || d.imageAlt, assetId: c.image ?? null, link: linkC.url });
      const cx = PAD + 14 + imgW + 20, cwid = W - PAD - 14 - cx;
      const head = text(brand, c.heading || d.heading, { x: cx, y: cardY + 24, w: cwid, fontSize: 19, fontWeight: 700, lineHeight: 1.3, fontFamily: 'heading', name: 'Heading' });
      const body = text(brand, c.body || d.body, { x: cx, y: head.y + head.h + 8, w: cwid, fontSize: 14, color: { token: 'muted' }, lineHeight: 1.55, name: 'Body' });
      const more = text(brand, linkC.label, { x: cx, y: body.y + body.h + 12, w: cwid, fontSize: 14, fontWeight: 700, color: { token: 'primary' }, name: 'Link', link: linkC.url });
      const cardH = Math.max(img.y + img.h + 14, more.y + more.h + 22) - cardY;
      h = cardH + 24;
      kids.push(band(h), rect({ x: PAD, y: cardY, w: inner, h: cardH, fill: { token: 'soft' }, radius: 12, name: 'Card' }), img, head, body, more);
      break;
    }
    case 'stats': {
      const items = (c.stats && c.stats.length ? c.stats : DEF.stats).slice(0, 4);
      const cw = Math.floor(inner / items.length);
      let bottom = y;
      const cells: Node[] = [];
      items.forEach((st, i) => {
        const x = PAD + i * cw;
        const nT = text(brand, st.value, { x, y: y + 26, w: cw, fontSize: items.length > 3 ? 26 : 32, fontWeight: 800, color: { token: 'primary' }, align: 'center', fontFamily: 'heading', name: `Stat ${i + 1}` });
        const lT = text(brand, st.label, { x, y: nT.y + nT.h + 2, w: cw, fontSize: 13, color: { token: 'muted' }, align: 'center', name: `Label ${i + 1}` });
        bottom = Math.max(bottom, lT.y + lT.h);
        cells.push(nT, lT);
      });
      h = bottom + 26 - y;
      kids.push(band(h), rect({ x: PAD, y: y, w: inner, h: 1, fill: { token: 'line' }, name: 'Line top' }), ...cells, rect({ x: PAD, y: y + h - 1, w: inner, h: 1, fill: { token: 'line' }, name: 'Line bottom' }));
      break;
    }
    case 'quote': {
      const d = DEF.quote;
      const cardY = y + 16;
      const mark = text(brand, '“', { x: PAD + 24, y: cardY + 10, w: 60, fontSize: 64, fontWeight: 800, color: { token: 'primary' }, fontFamily: 'heading', lineHeight: 1, name: 'Quote mark' });
      const q = text(brand, c.quote || d.quote, { x: PAD + 24, y: mark.y + 48, w: inner - 48, fontSize: 18, fontWeight: 500, lineHeight: 1.5, italic: true, name: 'Quote' });
      const who = text(brand, c.author || d.author, { x: PAD + 24, y: q.y + q.h + 12, w: inner - 48, fontSize: 13, color: { token: 'muted' }, name: 'Author' });
      const cardH = who.y + who.h + 26 - cardY;
      h = cardH + 32;
      kids.push(band(h), rect({ x: PAD, y: cardY, w: inner, h: cardH, fill: { token: 'soft' }, radius: 12, name: 'Card' }), mark, q, who);
      break;
    }
    case 'hero-overlay': {
      const d = DEF.hero; const btnC = c.button ?? d.button;
      const H = 440;
      const img = image({ x: 0, y, w: W, h: H, name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null, overlay: { color: '#07100b', opacity: 0.82, gradient: true } });
      const btn = button(brand, btnC.label, btnC.url, PAD, y + H - 30 - 48);
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: 0, w: inner - 40, fontSize: 16, color: '#FFFFFF', lineHeight: 1.5, name: 'Subhead', opacity: 0.9 });
      sub.y = btn.y - 18 - sub.h;
      const head = text(brand, c.headline || d.headline, { x: PAD, y: 0, w: inner - 20, fontSize: 40, fontWeight: 800, lineHeight: 1.08, fontFamily: 'heading', color: '#FFFFFF', name: 'Headline' });
      head.y = sub.y - 12 - head.h;
      const pillT = text(brand, up(c.eyebrow || d.eyebrow), { x: PAD + 12, y: 0, w: 300, fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: { token: 'onPrimary' }, name: 'Eyebrow' });
      const pw = Math.ceil(measureWidth(brand, pillT)) + 26; pillT.w = pw - 24;
      const pill = rect({ x: PAD, y: head.y - 14 - 26, w: pw, h: 26, fill: { token: 'primary' }, radius: 999, name: 'Eyebrow pill' });
      pillT.y = pill.y + Math.round((26 - pillT.h) / 2);
      h = H;
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
      kids.push(band(h), img, eyebrow, head, body, btn);
      break;
    }
    case 'bento': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Tính năng chính', body: 'Một câu nói kết quả người dùng nhận được, không nói tính năng.', url: `${B0}/a` }, { name: 'Nhanh hơn 2×', body: 'Một số liệu hoặc lợi ích ngắn.', url: `${B0}/b` }, { name: 'Dùng thử 14 ngày', body: 'Không cần thẻ.', url: `${B0}/c` }]).slice(0, 3);
      const gap = 12, colW = Math.floor((inner - gap) / 2), top = y + 16;
      const big = items[0];
      const bigImg = image({ x: PAD, y: top, w: colW, h: 190, radius: 14, name: 'Bento image', alt: big.alt || big.name, assetId: big.image ?? null });
      const bigH1 = text(brand, big.name, { x: PAD + 16, y: bigImg.y + bigImg.h + 14, w: colW - 32, fontSize: 18, fontWeight: 700, fontFamily: 'heading', lineHeight: 1.25, name: 'Heading' });
      const bigB = text(brand, big.body || big.price || '', { x: PAD + 16, y: bigH1.y + bigH1.h + 6, w: colW - 32, fontSize: 13, color: { token: 'muted' }, lineHeight: 1.5, name: 'Body' });
      const bigCardH = bigB.y + bigB.h + 18 - top;
      const bigCard = rect({ x: PAD, y: top, w: colW, h: bigCardH, fill: { token: 'soft' }, radius: 14, name: 'Card' });
      const smallH = Math.floor((bigCardH - gap) / 2);
      const cards: Node[] = [group('Bento 1', [bigCard, bigImg, bigH1, bigB], { link: big.url || null, alt: big.name })];
      [items[1], items[2]].forEach((it, i) => {
        if (!it) return;
        const sy = top + i * (smallH + gap), sx = PAD + colW + gap;
        const card = rect({ x: sx, y: sy, w: colW, h: smallH, fill: i === 0 ? { token: 'primary' } : { token: 'soft' }, radius: 14, name: 'Card' });
        const hT = text(brand, it.name, { x: sx + 16, y: sy + 18, w: colW - 32, fontSize: 17, fontWeight: 700, fontFamily: 'heading', lineHeight: 1.25, color: i === 0 ? { token: 'onPrimary' } : { token: 'ink' }, name: 'Heading' });
        const bT = text(brand, it.body || it.price || '', { x: sx + 16, y: hT.y + hT.h + 6, w: colW - 32, fontSize: 13, color: i === 0 ? { token: 'onPrimary' } : { token: 'muted' }, lineHeight: 1.45, name: 'Body', opacity: i === 0 ? 0.85 : 1 });
        cards.push(group(`Bento ${i + 2}`, [card, hT, bT], { link: it.url || null, alt: it.name }));
      });
      h = bigCardH + 32;
      kids.push(band(h), ...cards);
      break;
    }
    case 'badges': {
      const pills = (c.stats && c.stats.length ? c.stats : [{ value: '-30%', label: 'toàn bộ' }, { value: 'Freeship', label: '' }, { value: '24h', label: 'giao hàng' }]).slice(0, 4);
      const nodes: Node[] = []; const gap = 10, ph = 34;
      const ts = pills.map((pl) => text(brand, [pl.value, pl.label].filter(Boolean).join(' '), { x: 0, y: 0, w: 300, fontSize: 13, fontWeight: 700, color: { token: 'primary' }, name: 'Pill' }));
      const ws = ts.map((t) => Math.ceil(measureWidth(brand, t)) + 28);
      let x = Math.round((W - (ws.reduce((a, b) => a + b, 0) + gap * (ws.length - 1))) / 2);
      ts.forEach((t, i) => { const r = rect({ x, y: y + 14, w: ws[i], h: ph, fill: { token: 'soft' }, radius: 999, name: 'Pill bg', stroke: { color: { token: 'line' }, width: 1 } }); t.x = x + 14; t.w = ws[i] - 28; t.y = y + 14 + Math.round((ph - t.h) / 2); nodes.push(r, t); x += ws[i] + gap; });
      h = ph + 28;
      kids.push(band(h), ...nodes);
      break;
    }
    case 'dark-band': {
      const d = DEF.band; const btnC = c.button ?? d.button;
      const eyebrow = text(brand, up(c.eyebrow || d.eyebrow), { x: PAD, y: y + 44, w: inner, fontSize: 11, fontWeight: 700, letterSpacing: 1.8, color: { token: 'primary' }, name: 'Eyebrow' });
      const head = text(brand, c.headline || d.headline, { x: PAD, y: eyebrow.y + eyebrow.h + 14, w: inner, fontSize: 44, fontWeight: 800, lineHeight: 1.02, fontFamily: 'heading', color: { token: 'bg' }, name: 'Headline' });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: head.y + head.h + 16, w: inner - 60, fontSize: 15, color: { token: 'bg' }, lineHeight: 1.5, name: 'Subhead', opacity: 0.75 });
      const btn = button(brand, btnC.label, btnC.url, PAD, sub.y + sub.h + 26);
      h = btn.y + btn.h + 48 - y;
      kids.push(band(h, { token: 'ink' }, 'Band'), eyebrow, head, sub, btn);
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
      kids.push(band(h), ...nodes);
      break;
    }
    case 'social': {
      const avatars: Node[] = [];
      for (let i = 0; i < 5; i++) avatars.push(image({ x: PAD + i * 26, y: y + 22, w: 36, h: 36, radius: 999, name: `Avatar ${i + 1}`, alt: '' }));
      const stars = text(brand, '★★★★★', { x: PAD + 160, y: y + 20, w: 140, fontSize: 15, color: { token: 'primary' }, name: 'Stars', letterSpacing: 1 });
      const q = text(brand, c.quote || '4.9/5 từ 2.300 đánh giá', { x: PAD + 160, y: stars.y + stars.h + 2, w: inner - 160, fontSize: 14, fontWeight: 600, name: 'Social text' });
      const sub = text(brand, c.author || 'Khách mua lần hai chiếm 61%', { x: PAD + 160, y: q.y + q.h + 2, w: inner - 160, fontSize: 12, color: { token: 'muted' }, name: 'Social sub' });
      h = Math.max(sub.y + sub.h + 22 - y, 84);
      kids.push(band(h), rect({ x: PAD, y: y + h - 1, w: inner, h: 1, fill: { token: 'line' }, name: 'Line' }), ...avatars, stars, q, sub);
      break;
    }
    case 'cta-wide': {
      const d = DEF.cta; const btnC = c.button ?? d.button;
      const bh = 58;
      const bg = rect({ x: PAD, y: y + 20, w: inner, h: bh, fill: { token: 'primary' }, radius: 12, name: 'Button bg' });
      const t = text(brand, btnC.label, { x: PAD, y: y + 20, w: inner, h: bh, fontSize: 17, fontWeight: 800, color: { token: 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: btnC.label });
      const btn = group(`Button · ${btnC.label}`, [bg, t], { link: btnC.url, alt: btnC.label });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD, y: y + 20 + bh + 12, w: inner, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Sub' });
      h = sub.y + sub.h + 22 - y;
      kids.push(band(h), btn, sub);
      break;
    }
    case 'gallery': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [1, 2, 3].map((i) => ({ name: `Ảnh ${i}`, url: `${B0}/gallery/${i}` }))).slice(0, 3);
      const gap = 12, n = items.length, size = Math.floor((inner - gap * (n - 1)) / n);
      const nodes = items.map((it, i) => image({ x: PAD + i * (size + gap), y: y + 16, w: size, h: size, radius: 10, name: `Gallery ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null, link: it.url || null }));
      h = size + 32;
      kids.push(band(h), ...nodes);
      break;
    }
    case 'hero-center': {
      const d = DEF.band; const btnC = c.button ?? d.button;
      const style = c.style || 'light';
      const onBand = style !== 'light';
      const fg = onBand ? { token: 'onPrimary' as const } : { token: 'ink' as const };
      const pillT = text(brand, up(c.eyebrow || d.eyebrow), { x: 0, y: 0, w: 400, fontSize: 11, fontWeight: 800, letterSpacing: 1.6, color: onBand ? { token: 'primary' } : { token: 'onPrimary' }, name: 'Eyebrow', align: 'center' });
      const pw = Math.ceil(measureWidth(brand, pillT)) + 28;
      const pill = rect({ x: Math.round((W - pw) / 2), y: y + 36, w: pw, h: 28, fill: onBand ? { token: 'bg' } : { token: 'primary' }, radius: 999, name: 'Eyebrow pill' });
      pillT.x = pill.x; pillT.w = pw; pillT.y = pill.y + Math.round((28 - pillT.h) / 2);
      const head = text(brand, c.headline || d.headline, { x: PAD, y: pill.y + pill.h + 18, w: inner, fontSize: 46, fontWeight: 800, lineHeight: 1.05, fontFamily: 'heading', color: fg, align: 'center', name: 'Headline' });
      const sub = text(brand, c.subhead || d.subhead, { x: PAD + 30, y: head.y + head.h + 14, w: inner - 60, fontSize: 16, color: onBand ? { token: 'onPrimary' } : { token: 'muted' }, lineHeight: 1.5, align: 'center', name: 'Subhead', opacity: onBand ? 0.85 : 1 });
      const btn = button(brand, btnC.label, btnC.url, 0, sub.y + sub.h + 22, { inverse: onBand });
      btn.x = Math.round((W - btn.w) / 2); const dx = btn.x - btn.children[0].x; btn.children.forEach((k) => { k.x += dx; });
      const bandH = btn.y + btn.h + 36 - y;
      const img = c.image === null && !c.imageAlt ? null : image({ x: 0, y: y + bandH, w: W, h: 300, name: 'Hero image', alt: c.imageAlt || d.imageAlt, link: btnC.url, assetId: c.image ?? null });
      h = bandH + (img ? img.h : 0);
      const bg = style === 'gradient' ? rect({ x: 0, y, w: W, h: bandH, fill: null, gradient: { from: { token: 'primary' }, to: { token: 'accent' }, angle: 135 }, name: 'Band' }) : band(bandH, style === 'band' ? { token: 'primary' } : { token: 'bg' }, 'Band');
      kids.push(bg, pill, pillT, head, sub, syncGroup(btn), ...(img ? [img] : []));
      break;
    }
    case 'icon-row': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Xem video', body: '▶', url: `${B0}/videos` }, { name: 'Đọc sách', body: '📘', url: `${B0}/books` }, { name: 'Chơi game', body: '🎮', url: `${B0}/games` }, { name: 'Học cùng nhau', body: '💛', url: `${B0}/learn` }]).slice(0, 4);
      const n = items.length, cw = Math.floor(inner / n), sz = 60;
      const nodes: Node[] = [];
      items.forEach((it, i) => {
        const cx = PAD + i * cw + cw / 2;
        const circ = rect({ x: Math.round(cx - sz / 2), y: y + 22, w: sz, h: sz, fill: { token: 'soft' }, radius: 999, name: 'Icon bg', stroke: { color: { token: 'line' }, width: 1 } });
        const g = text(brand, it.body || it.name.slice(0, 1), { x: circ.x, y: circ.y, w: sz, h: sz, fontSize: 24, align: 'center', autoHeight: false, vAlign: 'middle', color: { token: 'primary' }, name: 'Icon' });
        const label = text(brand, it.name, { x: PAD + i * cw, y: circ.y + sz + 10, w: cw, fontSize: 12, fontWeight: 600, align: 'center', color: { token: 'ink' }, name: 'Label' });
        nodes.push(group(`Icon · ${it.name}`, [circ, g, label], { link: it.url || null, alt: it.name }));
      });
      h = 22 + sz + 10 + 36 + 16;
      kids.push(band(h), ...nodes);
      break;
    }
    case 'checklist': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [{ name: 'Thiết kế web 3D' }, { name: 'Logo & nhận diện' }, { name: 'UI/UX' }, { name: 'Hỗ trợ ra mắt' }]).slice(0, 6);
      let cy = y + 22;
      const nodes: Node[] = [];
      if (c.heading) { const hd = text(brand, c.heading, { x: PAD, y: cy, w: inner, fontSize: 22, fontWeight: 800, fontFamily: 'heading', lineHeight: 1.2, name: 'Heading' }); nodes.push(hd); cy = hd.y + hd.h + 12; }
      for (const it of items) {
        const circ = rect({ x: PAD, y: cy, w: 24, h: 24, fill: { token: 'primary' }, radius: 999, name: 'Check bg' });
        const ck = text(brand, '✓', { x: PAD, y: cy, w: 24, h: 24, fontSize: 13, fontWeight: 800, color: { token: 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: 'Check' });
        const t = text(brand, it.name, { x: PAD + 36, y: cy + 2, w: inner - 36, fontSize: 15, fontWeight: 600, name: it.name.slice(0, 20) });
        nodes.push(circ, ck, t);
        cy += Math.max(24, t.h) + 10;
      }
      h = cy + 14 - y;
      kids.push(band(h), ...nodes);
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
        nodes.push(rect({ x, y: cy, w: tw, h: th, fill: { token: 'soft' }, radius: 12, name: 'Tile', stroke: { color: { token: 'line' }, width: 1 } }));
        nodes.push(text(brand, u.value, { x, y: cy + 12, w: tw, fontSize: 28, fontWeight: 800, fontFamily: 'heading', align: 'center', color: { token: 'ink' }, name: 'Number' }));
        nodes.push(text(brand, u.label, { x, y: cy + 50, w: tw, fontSize: 11, color: { token: 'muted' }, align: 'center', name: 'Unit' }));
      });
      h = cy + th + 18 - y;
      kids.push(band(h), ...nodes);
      break;
    }
    case 'code': {
      const label = text(brand, up(c.eyebrow || 'Dùng mã'), { x: PAD, y: y + 24, w: inner, fontSize: 11, fontWeight: 700, letterSpacing: 1.6, color: { token: 'muted' }, align: 'center', name: 'Code label' });
      const codeT = text(brand, up(c.headline || 'PHLOEM20'), { x: 0, y: 0, w: 300, fontSize: 22, fontWeight: 800, letterSpacing: 3, color: { token: 'ink' }, align: 'center', name: 'Code', fontFamily: 'heading' });
      const cw = Math.ceil(measureWidth(brand, codeT)) + 72;
      const box = rect({ x: Math.round((W - cw) / 2), y: label.y + label.h + 10, w: cw, h: 52, fill: { token: 'bg' }, radius: 10, stroke: { color: { token: 'primary' }, width: 2 }, name: 'Code box' });
      codeT.x = box.x + 16; codeT.w = cw - 60; codeT.y = box.y + Math.round((52 - codeT.h) / 2);
      const copy = text(brand, '⧉', { x: box.x + cw - 40, y: box.y, w: 28, h: 52, fontSize: 18, color: { token: 'primary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: 'Copy' });
      const note = c.subhead ? text(brand, c.subhead, { x: PAD, y: box.y + box.h + 10, w: inner, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Note' }) : null;
      h = (note ? note.y + note.h : box.y + box.h) + 24 - y;
      kids.push(band(h), label, box, codeT, copy, ...(note ? [note] : []));
      break;
    }
    case 'stat-tiles': {
      const items = (c.stats && c.stats.length ? c.stats : [{ value: '+320%', label: 'doanh thu từ email' }, { value: '+45%', label: 'tỉ lệ mở' }, { value: '+62%', label: 'tỉ lệ click' }, { value: '2.8×', label: 'ROI 3 tháng' }]).slice(0, 4);
      const n = items.length, cols = n === 4 ? 2 : n, rows = n === 4 ? 2 : 1, gap = 10;
      const tw = Math.floor((inner - gap * (cols - 1)) / cols), th = 92;
      const nodes: Node[] = [];
      items.forEach((st, i) => {
        const x = PAD + (i % cols) * (tw + gap), ty = y + 16 + Math.floor(i / cols) * (th + gap);
        nodes.push(rect({ x, y: ty, w: tw, h: th, fill: { token: 'soft' }, radius: 14, name: 'Tile' }));
        nodes.push(text(brand, st.value, { x: x + 16, y: ty + 16, w: tw - 32, fontSize: 30, fontWeight: 800, fontFamily: 'heading', color: { token: 'primary' }, name: 'Value' }));
        nodes.push(text(brand, st.label, { x: x + 16, y: ty + 58, w: tw - 32, fontSize: 12, color: { token: 'muted' }, name: 'Label' }));
      });
      h = 16 + rows * th + (rows - 1) * gap + 16;
      kids.push(band(h), ...nodes);
      break;
    }
    case 'articles': {
      const items: ItemC[] = (c.items && c.items.length ? c.items : [1, 2, 3].map((i) => ({ name: `Bài viết ${i}: tiêu đề ngắn gọn, hai dòng`, badge: `EP0${i}`, url: `${B0}/post/${i}` }))).slice(0, 3);
      const n = items.length, gap = 12, cw = Math.floor((inner - gap * (n - 1)) / n), ih = Math.round(cw * 0.68);
      const nodes: Node[] = [];
      let bottom = y;
      items.forEach((it, i) => {
        const x = PAD + i * (cw + gap), top = y + 16;
        const img = image({ x, y: top, w: cw, h: ih, radius: 10, name: `Article image ${i + 1}`, alt: it.alt || it.name, assetId: it.image ?? null });
        const parts: Node[] = [img];
        if (it.badge) { const bt = text(brand, it.badge, { x: 0, y: 0, w: 120, fontSize: 10, fontWeight: 800, letterSpacing: 0.5, color: { token: 'onPrimary' }, name: 'Badge' }); const bw = Math.ceil(measureWidth(brand, bt)) + 14; const bg = rect({ x: x + 8, y: top + 8, w: bw, h: 20, fill: { token: 'primary' }, radius: 999, name: 'Badge bg' }); bt.x = x + 15; bt.w = bw - 14; bt.y = top + 8 + Math.round((20 - bt.h) / 2); parts.push(bg, bt); }
        const title = text(brand, it.name, { x, y: top + ih + 10, w: cw, fontSize: 14, fontWeight: 700, lineHeight: 1.3, name: 'Title' });
        const more = text(brand, it.body || 'Đọc thêm →', { x, y: title.y + title.h + 6, w: cw, fontSize: 12, fontWeight: 700, color: { token: 'primary' }, name: 'Link' });
        parts.push(title, more);
        bottom = Math.max(bottom, more.y + more.h);
        nodes.push(group(`Article ${i + 1}`, parts, { link: it.url || null, alt: it.name }));
      });
      h = bottom + 20 - y;
      kids.push(band(h), ...nodes);
      break;
    }
    case 'divider': {
      h = 33;
      kids.push(band(h), rect({ x: PAD, y: y + 16, w: inner, h: 1, fill: { token: 'line' }, name: 'Line' }));
      break;
    }
    case 'spacer': {
      h = 24;
      kids.push(band(h));
      break;
    }
    case 'footer': {
      const d = DEF.footer;
      const brandT = logoNode(brand, c, PAD, y + 40, 24, 'center', c.links?.[0]?.url || 'https://example.com');
      const addr = text(brand, c.address || d.address, { x: PAD, y: brandT.y + brandT.h + 10, w: inner, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Address' });
      const unsub = text(brand, 'Huỷ đăng ký', { x: 0, y: addr.y + addr.h + 12, w: 90, fontSize: 12, color: { token: 'muted' }, align: 'right', underline: true, name: 'Unsubscribe', link: c.unsubscribeUrl || d.unsubscribeUrl });
      const prefs = text(brand, 'Cập nhật thông tin', { x: 0, y: unsub.y, w: 120, fontSize: 12, color: { token: 'muted' }, align: 'left', underline: true, name: 'Preferences', link: c.preferencesUrl || d.preferencesUrl });
      const uw = Math.ceil(measureWidth(brand, unsub)) + 2, pw = Math.ceil(measureWidth(brand, prefs)) + 2;
      unsub.w = uw; prefs.w = pw;
      const total = uw + 20 + pw; unsub.x = Math.round((W - total) / 2); prefs.x = unsub.x + uw + 20;
      const socials: Node[] = [];
      if (c.social && c.social.length) {
        const GLYPH: Record<string, string> = { youtube: '▶', instagram: '◎', tiktok: '♪', facebook: 'f', x: 'X', twitter: 'X', linkedin: 'in', zalo: 'Z', website: '⌂' };
        const sz = 32, gap = 10, list = c.social.slice(0, 6);
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
      h = (socials.length ? unsub.y + unsub.h + 18 + 32 : unsub.y + unsub.h) + 30 - y;
      kids.push(band(h, { token: 'soft' }), rect({ x: 0, y: y + h - 4, w: W, h: 4, fill: { token: 'primary' }, name: 'Accent bar' }), brandT, addr, unsub, prefs, ...socials);
      break;
    }
  }
  return group(BLOCKS.find((b) => b.kind === kind)?.name ?? kind, kids, { block: kind });
}

/** A block spec: kind + content. Templates and the AI composer both produce lists of these. */
export interface BlockSpec { kind: BlockKind; content?: BlockContent }

export function buildDoc(specs: BlockSpec[], brand: Brand): Doc {
  const nodes: Node[] = [];
  let y = 0;
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
    kind: 'newsletter', name: 'Newsletter', desc: 'Hero ảnh · câu chuyện · 2 bài · số liệu · CTA', preset: 'Forest', brand: { headingFamily: 'Lora', name: 'Terra' },
    fields: { campaignName: 'Newsletter tháng 10', subject: 'Tháng này ở Terra: 3 điều đáng xem', preheader: 'Bộ sưu tập thu, cửa hàng mới và một câu chuyện nhỏ' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero', content: { eyebrow: 'Newsletter · Tháng 10', headline: 'Mùa thu về, bàn làm việc cũng cần thay áo', subhead: 'Ba món đồ gốm mới, một cửa hàng mới ở Đà Nẵng, và câu chuyện về người thợ làm ra chiếc cốc bạn đang dùng.', button: { label: 'Đọc tiếp', url: `${B}/journal/thu-2026` }, imageAlt: 'Bộ sưu tập gốm thu 2026 trên bàn gỗ' } },
      { kind: 'text', content: { eyebrow: 'Câu chuyện', heading: 'Một chiếc cốc mất 11 ngày để ra lò', body: 'Từ đất sét Bát Tràng đến men tro trấu, mỗi mẻ nung chỉ 40 chiếc. Chúng tôi kể lại từng bước, có cả những mẻ hỏng.' } },
      { kind: 'feature-row', content: { heading: 'Cửa hàng mới ở Đà Nẵng', body: 'Khai trương 18/10 tại 56 Bạch Đằng. Giảm 15% cho 100 khách đầu tiên.', link: { label: 'Xem bản đồ →', url: `${B}/stores/da-nang` }, imageAlt: 'Mặt tiền cửa hàng Terra Đà Nẵng' } },
      { kind: 'feature-row', content: { heading: 'Workshop vuốt gốm cuối tuần', body: 'Hai tiếng, một bàn xoay, mang về chiếc bát do chính tay bạn làm. Còn 6 chỗ.', link: { label: 'Giữ chỗ →', url: `${B}/workshop` }, imageAlt: 'Học viên đang vuốt gốm trên bàn xoay' } },
      { kind: 'stats', content: { stats: [{ value: '11 ngày', label: 'cho một chiếc cốc' }, { value: '40', label: 'chiếc mỗi mẻ nung' }, { value: '3', label: 'cửa hàng' }] } },
      { kind: 'cta', content: { heading: 'Ghé Terra cuối tuần này', subhead: 'Uống thử trà trong cốc mới, không cần mua gì.', button: { label: 'Tìm cửa hàng gần bạn', url: `${B}/stores` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'promo', name: 'Promo / Sale', desc: 'Dải màu lớn · 2 sản phẩm · trích dẫn · CTA', preset: 'Coral', brand: { headingFamily: 'Montserrat', name: 'Terra' },
    fields: { campaignName: 'Sale cuối tuần', subject: 'Giảm 30% đến hết Chủ nhật', preheader: 'Mã TERRA30 · Freeship toàn quốc' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-band', content: { eyebrow: 'Chỉ 3 ngày', headline: 'Giảm 30% toàn bộ đồ gốm', subhead: 'Đến hết Chủ nhật 19/10. Nhập mã TERRA30 khi thanh toán. Freeship mọi đơn.', button: { label: 'Mua ngay', url: `${B}/sale` }, imageAlt: 'Bộ cốc và đĩa gốm đang giảm giá' } },
      { kind: 'products-2', content: { items: [{ name: 'Cốc men tro 300ml', oldPrice: '245.000₫', price: '171.000₫', badge: '-30%', url: `${B}/p/coc-men-tro` }, { name: 'Đĩa ăn 24cm', oldPrice: '320.000₫', price: '224.000₫', badge: '-30%', url: `${B}/p/dia-24` }] } },
      { kind: 'quote', content: { quote: 'Mua lần đầu vì tò mò, mua lần hai vì chất lượng. Giao nhanh, đóng gói đẹp, đúng như ảnh.', author: '— Minh Anh, khách hàng từ 2024' } },
      { kind: 'cta', content: { heading: 'Còn 72 giờ', subhead: 'Hàng giảm giá không áp dụng đổi trả. Mỗi mã dùng một lần.', button: { label: 'Xem tất cả sale', url: `${B}/sale` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'product-grid', name: 'Product grid', desc: 'Hero ảnh · lưới 3 cột ×2 · CTA', preset: 'Mono', brand: { headingFamily: 'DM Sans', name: 'Terra' },
    fields: { campaignName: 'Hàng mới về', subject: 'Hàng mới về: 6 món vừa lên kệ', preheader: 'Chọn trước khi hết, mỗi mẫu chỉ 40 chiếc' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero', content: { eyebrow: 'Vừa lên kệ', headline: '6 món mới, mỗi mẫu 40 chiếc', subhead: 'Mẻ nung tháng 10 vừa ra lò. Lần trước hết trong 4 ngày.', button: { label: 'Xem tất cả', url: `${B}/new` }, imageAlt: 'Sáu món gốm mới xếp trên kệ gỗ' } },
      { kind: 'products-3', content: { items: [{ name: 'Cốc tai 250ml', price: '210.000₫', url: `${B}/p/1` }, { name: 'Bát cơm 12cm', price: '150.000₫', url: `${B}/p/2` }, { name: 'Ấm trà 600ml', price: '690.000₫', url: `${B}/p/3` }] } },
      { kind: 'products-3', content: { items: [{ name: 'Đĩa lót 15cm', price: '120.000₫', url: `${B}/p/4` }, { name: 'Lọ hoa nhỏ', price: '260.000₫', url: `${B}/p/5` }, { name: 'Bộ 4 chén trà', price: '380.000₫', url: `${B}/p/6` }] } },
      { kind: 'cta', content: { heading: 'Mua 2 món, freeship', subhead: 'Áp dụng cho mọi đơn từ 2 món trở lên, không cần mã.', button: { label: 'Mua ngay', url: `${B}/new` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'welcome', name: 'Welcome', desc: 'Dải màu chào mừng · lợi ích · số liệu · ưu đãi đầu', preset: 'Mint', brand: { name: 'Terra' },
    fields: { campaignName: 'Welcome #1', subject: 'Chào mừng bạn đến Terra', preheader: 'Ưu đãi 10% cho đơn đầu tiên, dùng trong 7 ngày' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-band', content: { eyebrow: 'Chào mừng', headline: 'Rất vui được gặp bạn', subhead: 'Cảm ơn bạn đã đăng ký. Đây là mã giảm 10% cho đơn đầu tiên: WELCOME10.', button: { label: 'Dùng mã ngay', url: `${B}/shop?code=WELCOME10` }, imageAlt: 'Người thợ gốm cầm chiếc cốc vừa ra lò' } },
      { kind: 'text', content: { eyebrow: 'Terra là ai', heading: 'Gốm thủ công, làm ở Bát Tràng, dùng mỗi ngày', body: 'Chúng tôi làm đồ dùng cho bàn ăn và bàn làm việc: bền, mộc, vừa tay. Không in hoa văn, không sơn phủ, chỉ có đất và men.' } },
      { kind: 'feature-row', content: { heading: 'Đổi trả 30 ngày', body: 'Không hợp thì gửi lại, Terra chịu phí ship hai chiều.', link: { label: 'Chính sách đổi trả →', url: `${B}/returns` }, imageAlt: 'Hộp đóng gói Terra' } },
      { kind: 'stats', content: { stats: [{ value: '12k+', label: 'khách hàng' }, { value: '4.9/5', label: 'đánh giá' }, { value: '48h', label: 'giao toàn quốc' }] } },
      { kind: 'cta', content: { heading: 'Bắt đầu với một chiếc cốc', subhead: 'Mã WELCOME10 có hiệu lực 7 ngày.', button: { label: 'Chọn cốc', url: `${B}/cups` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'cart', name: 'Cart reminder', desc: 'Nhắc giỏ hàng · 2 món · trích dẫn · CTA', preset: 'Ocean',
    fields: { campaignName: 'Nhắc giỏ hàng', subject: 'Bạn để quên 2 món trong giỏ', preheader: 'Giữ giỏ hàng thêm 24 giờ, freeship nếu hoàn tất hôm nay' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'text', content: { eyebrow: 'Giỏ hàng của bạn', heading: 'Còn 2 món đang chờ', body: 'Chúng tôi giữ giỏ hàng thêm 24 giờ. Hoàn tất hôm nay để được freeship.' } },
      { kind: 'products-2', content: { items: [{ name: 'Cốc men tro 300ml', price: '245.000₫', url: `${B}/cart` }, { name: 'Đĩa ăn 24cm', price: '320.000₫', url: `${B}/cart` }] } },
      { kind: 'quote', content: { quote: 'Đặt tối hôm trước, trưa hôm sau đã có. Cốc cầm đầm tay, men mịn hơn ảnh.', author: '— Hoàng Long, Hải Phòng' } },
      { kind: 'cta', content: { heading: 'Hoàn tất đơn hàng', subhead: 'Tổng 565.000₫ · Freeship nếu thanh toán trong 24 giờ.', button: { label: 'Về giỏ hàng', url: `${B}/cart` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'launch', name: 'Ra mắt sản phẩm', desc: 'Dải màu · 3 điểm nổi bật · số liệu · đặt trước', preset: 'Royal', brand: { headingFamily: 'Montserrat', name: 'Terra' },
    fields: { campaignName: 'Ra mắt Terra Thermo', subject: 'Ra mắt: Bình giữ nhiệt Terra Thermo 500ml', preheader: 'Giữ nóng 12 giờ, đặt trước giảm 20% đến 25/10' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-band', content: { eyebrow: 'Sản phẩm mới', headline: 'Terra Thermo. Gốm bên ngoài, thép bên trong.', subhead: 'Bình giữ nhiệt 500ml đầu tiên của Terra. Giữ nóng 12 giờ, lạnh 24 giờ. Đặt trước giảm 20%.', button: { label: 'Đặt trước', url: `${B}/thermo` }, imageAlt: 'Bình giữ nhiệt Terra Thermo màu đất' } },
      { kind: 'feature-row', content: { heading: 'Vỏ gốm nung 1.250°C', body: 'Cầm ấm tay như cốc gốm, không bị trơn như kim loại.', link: { label: 'Xem chất liệu →', url: `${B}/thermo#material` }, imageAlt: 'Cận cảnh vỏ gốm' } },
      { kind: 'feature-row', content: { heading: 'Lõi thép 316 hai lớp', body: 'Chân không giữa hai lớp. Không ám mùi, rửa máy được.', link: { label: 'Xem cấu tạo →', url: `${B}/thermo#core` }, imageAlt: 'Mặt cắt lõi thép' } },
      { kind: 'feature-row', content: { heading: 'Nắp xoay kín, một tay mở', body: 'Thử 2.000 lần đóng mở, không rò.', link: { label: 'Xem video →', url: `${B}/thermo#lid` }, imageAlt: 'Nắp bình đang mở' } },
      { kind: 'stats', content: { stats: [{ value: '12 giờ', label: 'giữ nóng' }, { value: '24 giờ', label: 'giữ lạnh' }, { value: '-20%', label: 'đặt trước' }] } },
      { kind: 'cta', content: { heading: 'Giao từ 1/11', subhead: 'Đặt trước đến 25/10. Thanh toán khi nhận hàng.', button: { label: 'Đặt trước 480.000₫', url: `${B}/thermo` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'event', name: 'Mời sự kiện', desc: 'Hero ảnh · thời gian & địa điểm · chương trình · giữ chỗ', preset: 'Plum', brand: { headingFamily: 'Playfair Display', name: 'Terra' },
    fields: { campaignName: 'Mời workshop 26/10', subject: 'Mời bạn: Workshop vuốt gốm sáng Chủ nhật', preheader: '26/10 · 9:00 · Terra Đà Nẵng · còn 6 chỗ' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero', content: { eyebrow: 'Thư mời', headline: 'Sáng Chủ nhật, làm một chiếc bát bằng tay mình', subhead: 'Workshop vuốt gốm 2 giờ cùng nghệ nhân Nguyễn Văn Hùng. Bạn mang về sản phẩm sau khi nung, 2 tuần sau.', button: { label: 'Giữ chỗ', url: `${B}/workshop/26-10` }, imageAlt: 'Bàn xoay gốm và đôi tay đang vuốt' } },
      { kind: 'stats', content: { stats: [{ value: '26/10', label: 'Chủ nhật' }, { value: '9:00', label: 'đến 11:00' }, { value: '6', label: 'chỗ còn lại' }] } },
      { kind: 'text', content: { eyebrow: 'Chương trình', heading: 'Từ cục đất đến chiếc bát', body: '9:00 giới thiệu đất và men · 9:20 vuốt trên bàn xoay · 10:30 tạo hình miệng bát · 10:50 ký tên dưới đáy. Trà và bánh có sẵn.' } },
      { kind: 'feature-row', content: { heading: 'Địa điểm', body: 'Terra Đà Nẵng · 56 Bạch Đằng, Hải Châu. Có chỗ gửi xe máy.', link: { label: 'Mở bản đồ →', url: `${B}/stores/da-nang` }, imageAlt: 'Bản đồ cửa hàng' } },
      { kind: 'cta', content: { heading: 'Phí tham gia 350.000₫', subhead: 'Đã gồm đất, nung và một ly trà. Hoàn tiền nếu huỷ trước 24 giờ.', button: { label: 'Giữ chỗ ngay', url: `${B}/workshop/26-10` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'digest', name: 'Bản tin biên tập', desc: 'Mở đầu · 3 bài viết · divider · CTA đọc tiếp', preset: 'Mono', brand: { headingFamily: 'Lora', name: 'Terra Journal' },
    fields: { campaignName: 'Digest tuần 42', subject: '3 bài đáng đọc tuần này', preheader: 'Men tro trấu, bàn ăn kiểu Nhật, và cách rửa gốm đúng' },
    blocks: [
      { kind: 'nav', content: { brand: `${sampleBrand} Journal`, links: [{ label: 'Bài mới', url: `${B}/journal` }, { label: 'Chủ đề', url: `${B}/journal/topics` }, { label: 'Cửa hàng', url: `${B}/shop` }] } },
      { kind: 'text', content: { eyebrow: 'Tuần 42', heading: 'Ba bài đáng đọc, mười phút là xong', body: 'Tuần này chúng tôi viết về men, về cách bày bàn, và trả lời câu hỏi được hỏi nhiều nhất: rửa gốm thế nào cho đúng.' } },
      { kind: 'feature-row', content: { heading: 'Men tro trấu là gì', body: 'Vì sao hai chiếc cốc cùng mẻ lại khác màu nhau, và vì sao đó là điều tốt.', link: { label: 'Đọc 4 phút →', url: `${B}/journal/men-tro-trau` }, imageAlt: 'Cận cảnh men tro trấu' } },
      { kind: 'feature-row', content: { heading: 'Bày bàn ăn kiểu Nhật với đồ Việt', body: 'Năm món, ba màu, một quy tắc: để trống một phần ba mặt bàn.', link: { label: 'Đọc 3 phút →', url: `${B}/journal/bay-ban` }, imageAlt: 'Bàn ăn bày theo phong cách Nhật' } },
      { kind: 'feature-row', content: { heading: 'Rửa gốm: máy hay tay?', body: 'Câu trả lời ngắn: cả hai đều được, trừ một trường hợp.', link: { label: 'Đọc 2 phút →', url: `${B}/journal/rua-gom` }, imageAlt: 'Bồn rửa với đồ gốm' } },
      { kind: 'divider' },
      { kind: 'cta', content: { heading: 'Bạn thích chủ đề nào?', subhead: 'Trả lời email này, chúng tôi đọc hết.', button: { label: 'Xem tất cả bài', url: `${B}/journal` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'testimonial', name: 'Khách nói gì', desc: 'Hero · 2 trích dẫn · 2 sản phẩm bán chạy · CTA', preset: 'Sunset',
    fields: { campaignName: 'Social proof', subject: '4.9/5 từ 2.300 đánh giá', preheader: 'Hai khách hàng kể lại, và hai món họ mua nhiều nhất' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero', content: { eyebrow: '2.300 đánh giá', headline: 'Khách hàng nói về Terra', subhead: 'Chúng tôi không viết quảng cáo. Đây là lời của người đã dùng.', button: { label: 'Đọc đánh giá', url: `${B}/reviews` }, imageAlt: 'Bàn ăn gia đình với đồ gốm Terra' } },
      { kind: 'quote', content: { quote: 'Cốc dùng 2 năm, rửa máy mỗi ngày, men vẫn như mới. Mua thêm cho bố mẹ.', author: '— Thu Hà, Hà Nội · ★★★★★' } },
      { kind: 'quote', content: { quote: 'Đóng gói kỹ đến mức tiếc giấy. Bát nặng tay, đựng canh không nóng tay.', author: '— Quốc Bảo, TP.HCM · ★★★★★' } },
      { kind: 'products-2', content: { items: [{ name: 'Cốc men tro 300ml · bán chạy #1', price: '245.000₫', url: `${B}/p/coc-men-tro` }, { name: 'Bát canh 16cm · bán chạy #2', price: '190.000₫', url: `${B}/p/bat-canh` }] } },
      { kind: 'cta', content: { heading: 'Thử một món, đổi trả 30 ngày', subhead: 'Không hợp thì gửi lại, Terra chịu phí ship.', button: { label: 'Mua món bán chạy', url: `${B}/bestsellers` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'seasonal', name: 'Sale theo mùa', desc: 'Dải màu lễ hội · lưới 3 · số liệu · đếm ngược', preset: 'Sunset', brand: { headingFamily: 'Playfair Display', name: 'Terra' },
    fields: { campaignName: 'Tết 2027', subject: 'Quà Tết Terra: giảm 25%, gói sẵn, giao trước 28 Tết', preheader: 'Bộ quà 3 món từ 590.000₫ · đặt trước 20/1' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-band', content: { eyebrow: 'Quà Tết 2027', headline: 'Quà gốm gói sẵn, giao trước 28 Tết', subhead: 'Giảm 25% bộ quà 3 món. Kèm thiệp viết tay và hộp giấy dó. Đặt trước 20/1 để chắc chắn kịp.', button: { label: 'Chọn bộ quà', url: `${B}/tet` }, imageAlt: 'Hộp quà Tết Terra với giấy dó và thiệp' } },
      { kind: 'products-3', content: { items: [{ name: 'Bộ trà 5 món', price: '890.000₫', url: `${B}/tet/tra` }, { name: 'Bộ bát đĩa 6 món', price: '1.190.000₫', url: `${B}/tet/ban-an` }, { name: 'Bộ cốc đôi', price: '590.000₫', url: `${B}/tet/coc-doi` }] } },
      { kind: 'stats', content: { stats: [{ value: '-25%', label: 'đến 20/1' }, { value: '28 Tết', label: 'giao trước' }, { value: '0₫', label: 'phí gói quà' }] } },
      { kind: 'cta', content: { heading: 'Đặt sớm, khỏi lo', subhead: 'Sau 20/1 chúng tôi không nhận đơn giao trước Tết.', button: { label: 'Đặt quà Tết', url: `${B}/tet` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'reengagement', name: 'Lâu không gặp', desc: 'Lời nhắn · ưu đãi quay lại · 2 món mới · trích dẫn', preset: 'Plum',
    fields: { campaignName: 'Win-back', subject: 'Lâu rồi không gặp, Terra có món mới', preheader: 'Giảm 15% cho đơn quay lại, dùng trong 10 ngày' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'text', content: { eyebrow: 'Lâu rồi không gặp', heading: 'Bạn vẫn còn thích đồ gốm chứ?', body: 'Từ lần cuối bạn ghé, Terra có thêm 14 mẫu mới và một cửa hàng ở Đà Nẵng. Nếu quay lại, đây là mã giảm 15%: COMEBACK15.' } },
      { kind: 'products-2', content: { items: [{ name: 'Ấm trà 600ml · mới', price: '690.000₫', url: `${B}/p/am-tra` }, { name: 'Lọ hoa nhỏ · mới', price: '260.000₫', url: `${B}/p/lo-hoa` }] } },
      { kind: 'quote', content: { quote: 'Quay lại sau một năm, chất lượng vẫn thế, mẫu thì nhiều hơn hẳn.', author: '— Lan Phương, Cần Thơ' } },
      { kind: 'cta', content: { heading: 'Mã COMEBACK15', subhead: 'Giảm 15% mọi đơn, hiệu lực 10 ngày, không áp dụng cùng mã khác.', button: { label: 'Xem món mới', url: `${B}/new?code=COMEBACK15` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'drop', name: 'Streetwear drop', desc: 'Dải tối chữ khổ lớn · nhãn · gallery · 3 món · CTA to', preset: 'Neon', tag: 'trend', brand: { headingFamily: 'Space Grotesk', name: 'VOLT' },
    fields: { campaignName: 'Drop 03', subject: 'DROP 03 mở bán 24.10 · 48 giờ', preheader: 'Áo khoác gió VOLT Wind, 300 chiếc, không restock' },
    blocks: [
      { kind: 'nav', content: { brand: 'VOLT', links: [{ label: 'Drop', url: `${B}/drop` }, { label: 'Lookbook', url: `${B}/lookbook` }, { label: 'Size', url: `${B}/size` }] } },
      { kind: 'dark-band', content: { eyebrow: 'Drop 03 · 24.10 · 20:00', headline: 'VOLT WIND. 300 CHIẾC. KHÔNG RESTOCK.', subhead: 'Áo khoác gió 3 lớp, chống nước 10k, phản quang toàn thân. Mở bán 48 giờ hoặc đến khi hết.', button: { label: 'Vào hàng chờ', url: `${B}/drop/03` } } },
      { kind: 'badges', content: { stats: [{ value: '300', label: 'chiếc' }, { value: '48h', label: 'mở bán' }, { value: 'Freeship', label: '' }, { value: 'Đổi size 7 ngày', label: '' }] } },
      { kind: 'gallery', content: { items: [{ name: 'Mặt trước', url: `${B}/drop/03` }, { name: 'Mặt sau phản quang', url: `${B}/drop/03` }, { name: 'Chi tiết khoá', url: `${B}/drop/03` }] } },
      { kind: 'products-3', content: { items: [{ name: 'Wind · Đen', price: '1.290.000₫', url: `${B}/p/wind-black` }, { name: 'Wind · Xám tro', price: '1.290.000₫', url: `${B}/p/wind-ash` }, { name: 'Wind · Neon', price: '1.390.000₫', url: `${B}/p/wind-neon` }] } },
      { kind: 'cta-wide', content: { button: { label: 'Vào hàng chờ trước 20:00', url: `${B}/drop/03` }, subhead: 'Hàng chờ được mua trước 15 phút. Mỗi tài khoản 1 chiếc.' } },
      { kind: 'footer', content: { brand: 'VOLT', address: 'VOLT Studio · 12 Nguyễn Huệ, Q1, TP.HCM · drop@volt.vn' } },
    ],
  },
  {
    kind: 'bento', name: 'Ra mắt app', desc: 'Hero phủ ảnh · bento · số liệu · CTA to', preset: 'Midnight', tag: 'trend', brand: { headingFamily: 'Space Grotesk', name: 'Lumo' },
    fields: { campaignName: 'Lumo 2.0', subject: 'Lumo 2.0: ghi chú tự sắp xếp, offline, nhanh gấp đôi', preheader: 'Bản mới cho mọi người dùng, miễn phí nâng cấp' },
    blocks: [
      { kind: 'nav', content: { brand: 'Lumo', links: [{ label: 'Tính năng', url: `${B}/features` }, { label: 'Giá', url: `${B}/pricing` }, { label: 'Blog', url: `${B}/blog` }] } },
      { kind: 'hero-overlay', content: { eyebrow: 'Phiên bản 2.0', headline: 'Ghi chú tự sắp xếp. Bạn chỉ cần viết.', subhead: 'Lumo 2.0 gom ý tưởng rời rạc thành trang có cấu trúc, chạy offline, đồng bộ khi có mạng.', button: { label: 'Cập nhật miễn phí', url: `${B}/update` }, imageAlt: 'Giao diện Lumo 2.0 trên laptop' } },
      { kind: 'bento', content: { items: [{ name: 'Tự gom ý theo chủ đề', body: 'Viết liên tục, Lumo xếp thành mục. Không cần tag, không cần thư mục.', url: `${B}/features#organize` }, { name: 'Nhanh gấp 2×', body: 'Mở app dưới 300ms, tìm kiếm tức thì.', url: `${B}/features#speed` }, { name: 'Offline hoàn toàn', body: 'Máy bay, hầm, vùng sóng yếu: vẫn ghi.', url: `${B}/features#offline` }] } },
      { kind: 'stats', content: { stats: [{ value: '300ms', label: 'mở app' }, { value: '1,2M', label: 'ghi chú mỗi ngày' }, { value: '4.8★', label: 'App Store' }] } },
      { kind: 'cta-wide', content: { button: { label: 'Cập nhật Lumo 2.0', url: `${B}/update` }, subhead: 'Miễn phí cho mọi tài khoản. Dữ liệu cũ giữ nguyên.' } },
      { kind: 'footer', content: { brand: 'Lumo', address: 'Lumo Labs · lumo.app · support@lumo.app' } },
    ],
  },
  {
    kind: 'luxe', name: 'Beauty tối giản', desc: 'Chia đôi · câu chuyện · 2 sản phẩm · trích dẫn', preset: 'Linen', tag: 'trend', brand: { headingFamily: 'Playfair Display', name: 'Sóng' },
    fields: { campaignName: 'Sóng · Serum mới', subject: 'Serum Sóng No.3: 12 tuần, da đều màu', preheader: 'Công thức mới, giá ra mắt đến 31/10' },
    blocks: [
      { kind: 'nav', content: { brand: 'Sóng', links: [{ label: 'Da mặt', url: `${B}/face` }, { label: 'Cơ thể', url: `${B}/body` }, { label: 'Triết lý', url: `${B}/about` }] } },
      { kind: 'split', content: { eyebrow: 'Mới', heading: 'Serum No.3. Ít thành phần hơn, hiệu quả rõ hơn.', body: '5 thành phần, không hương liệu. Thử nghiệm 12 tuần trên 120 người: 87% da đều màu hơn.', button: { label: 'Khám phá No.3', url: `${B}/p/serum-3` }, imageAlt: 'Chai serum Sóng No.3 trên nền vải linen' } },
      { kind: 'text', content: { eyebrow: 'Triết lý', heading: 'Chúng tôi bỏ đi 23 thành phần', body: 'Mỗi thứ còn lại phải trả lời được một câu hỏi: nó làm gì cho da bạn? Không trả lời được thì không có trong chai.' } },
      { kind: 'products-2', content: { items: [{ name: 'Serum No.3 · 30ml', price: '890.000₫', url: `${B}/p/serum-3` }, { name: 'Kem dưỡng No.1 · 50ml', price: '650.000₫', url: `${B}/p/cream-1` }] } },
      { kind: 'quote', content: { quote: 'Tôi đã thử nhiều serum. Đây là chai đầu tiên tôi dùng hết.', author: '— Khánh Linh, biên tập viên làm đẹp' } },
      { kind: 'cta', content: { heading: 'Giá ra mắt đến 31/10', subhead: 'Giảm 15% và tặng mẫu thử kem dưỡng No.1.', button: { label: 'Mua No.3', url: `${B}/p/serum-3` } } },
      { kind: 'footer', content: { brand: 'Sóng', address: 'Sóng Skincare · 8 Hàn Thuyên, Q1, TP.HCM · hello@song.vn' } },
    ],
  },
  {
    kind: 'travel', name: 'Du lịch', desc: 'Hero phủ ảnh · danh mục · 2 gợi ý · social proof · CTA to', preset: 'Ocean', tag: 'trend', brand: { headingFamily: 'Montserrat', name: 'Hành Trình' },
    fields: { campaignName: 'Đi Đà Lạt tháng 11', subject: 'Đà Lạt tháng 11: phòng view đồi từ 890k', preheader: 'Giữ chỗ không mất phí, huỷ miễn phí đến 48h trước' },
    blocks: [
      { kind: 'nav', content: { brand: 'Hành Trình', links: [{ label: 'Khách sạn', url: `${B}/hotels` }, { label: 'Tour', url: `${B}/tours` }, { label: 'Ưu đãi', url: `${B}/deals` }] } },
      { kind: 'hero-overlay', content: { eyebrow: 'Tháng 11 · mùa dã quỳ', headline: 'Đà Lạt đang vàng cả đồi', subhead: 'Phòng view đồi từ 890.000₫/đêm. Giữ chỗ không mất phí, huỷ miễn phí đến 48 giờ trước.', button: { label: 'Xem phòng', url: `${B}/da-lat` }, imageAlt: 'Đồi dã quỳ vàng ở Đà Lạt lúc bình minh' } },
      { kind: 'categories', content: { items: [{ name: 'Homestay', url: `${B}/da-lat/homestay` }, { name: 'Resort', url: `${B}/da-lat/resort` }, { name: 'Tour 1 ngày', url: `${B}/da-lat/tours` }] } },
      { kind: 'feature-row', content: { heading: 'Nhà gỗ Trăng Non · 1.190.000₫', body: '2 người, bữa sáng, bồn tắm nhìn ra thung lũng. Còn 3 đêm tuần này.', link: { label: 'Giữ chỗ →', url: `${B}/stay/trang-non` }, imageAlt: 'Nhà gỗ nhìn ra thung lũng' } },
      { kind: 'feature-row', content: { heading: 'Săn mây Cầu Đất · 350.000₫', body: 'Xuất phát 4:30, về 9:00, có xe đón và cà phê nóng.', link: { label: 'Đặt tour →', url: `${B}/tour/cau-dat` }, imageAlt: 'Biển mây ở Cầu Đất' } },
      { kind: 'social', content: { quote: '4.9/5 từ 12.400 chuyến đi', author: '96% khách nói sẽ đặt lại' } },
      { kind: 'cta-wide', content: { button: { label: 'Giữ chỗ, không mất phí', url: `${B}/da-lat` }, subhead: 'Thanh toán khi nhận phòng. Huỷ miễn phí đến 48 giờ trước.' } },
      { kind: 'footer', content: { brand: 'Hành Trình', address: 'Hành Trình Travel · 45 Trần Phú, Đà Lạt · chao@hanhtrinh.vn' } },
    ],
  },
  {
    kind: 'food', name: 'Nhà hàng · F&B', desc: 'Chia đôi · nhãn · 3 món · social proof · CTA', preset: 'Sunset', tag: 'trend', brand: { headingFamily: 'Montserrat', name: 'Bếp Nhà' },
    fields: { campaignName: 'Menu thu', subject: 'Menu thu đã lên: 6 món mới, giao nóng 30 phút', preheader: 'Giảm 20% đơn đầu qua app, hết 31/10' },
    blocks: [
      { kind: 'nav', content: { brand: 'Bếp Nhà', links: [{ label: 'Menu', url: `${B}/menu` }, { label: 'Đặt bàn', url: `${B}/book` }, { label: 'Giao hàng', url: `${B}/delivery` }] } },
      { kind: 'split', content: { eyebrow: 'Menu thu', heading: 'Sáu món mới, nấu từ 6 giờ sáng', body: 'Bò kho sả, canh chua cá lóc, cơm gà xối mỡ… Nguyên liệu chợ sớm, nấu theo đơn, giao nóng trong 30 phút.', button: { label: 'Xem menu', url: `${B}/menu` }, imageAlt: 'Mâm cơm với bò kho và canh chua' } },
      { kind: 'badges', content: { stats: [{ value: '-20%', label: 'đơn đầu' }, { value: '30 phút', label: 'giao nóng' }, { value: 'Không MSG', label: '' }] } },
      { kind: 'products-3', content: { items: [{ name: 'Bò kho sả', price: '79.000₫', url: `${B}/menu/bo-kho` }, { name: 'Canh chua cá lóc', price: '69.000₫', url: `${B}/menu/canh-chua` }, { name: 'Cơm gà xối mỡ', price: '65.000₫', url: `${B}/menu/com-ga` }] } },
      { kind: 'social', content: { quote: '4.8/5 từ 3.100 đơn tháng này', author: 'Món được đặt lại nhiều nhất: bò kho sả' } },
      { kind: 'cta', content: { heading: 'Đói rồi?', subhead: 'Đặt qua app, nhập BEP20 cho đơn đầu tiên.', button: { label: 'Đặt ngay', url: `${B}/order` } } },
      { kind: 'footer', content: { brand: 'Bếp Nhà', address: 'Bếp Nhà · 21 Võ Văn Tần, Q3, TP.HCM · 1900 1234' } },
    ],
  },
  {
    kind: 'flash', name: 'Flash sale', desc: 'Nhãn · dải màu · 3 món · CTA to', preset: 'Coral', tag: 'trend', brand: { headingFamily: 'Montserrat', name: 'Terra' },
    fields: { campaignName: 'Flash sale 6 giờ', subject: '⚡ 6 giờ: giảm 40% ba món bán chạy', preheader: 'Từ 18:00 đến 24:00 hôm nay, hết là hết' },
    blocks: [
      { kind: 'nav', content: { brand: 'Terra', links: navLinks } },
      { kind: 'badges', content: { stats: [{ value: '⚡ 18:00–24:00', label: 'hôm nay' }, { value: '-40%', label: '' }, { value: '3 món', label: 'bán chạy' }] } },
      { kind: 'hero-band', content: { eyebrow: 'Flash sale 6 giờ', headline: 'Giảm 40% ba món bán chạy nhất', subhead: 'Chỉ từ 18:00 đến 24:00 hôm nay. Mỗi tài khoản tối đa 2 chiếc mỗi mẫu.', button: { label: 'Mua ngay', url: `${B}/flash` }, imageAlt: 'Ba món gốm bán chạy xếp cạnh nhau' } },
      { kind: 'products-3', content: { items: [{ name: 'Cốc men tro', oldPrice: '245.000₫', price: '147.000₫', badge: '-40%', url: `${B}/p/coc-men-tro` }, { name: 'Bát canh 16cm', oldPrice: '190.000₫', price: '114.000₫', badge: '-40%', url: `${B}/p/bat-canh` }, { name: 'Đĩa ăn 24cm', oldPrice: '320.000₫', price: '192.000₫', badge: '-40%', url: `${B}/p/dia-24` }] } },
      { kind: 'cta-wide', content: { button: { label: 'Vào flash sale', url: `${B}/flash` }, subhead: 'Giá đã giảm hiển thị trong giỏ. Không cần mã.' } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'fitness', name: 'Fitness · app', desc: 'Dải tối · số liệu · bento · trích dẫn · CTA to', preset: 'Mint', tag: 'trend', brand: { headingFamily: 'Space Grotesk', name: 'Fitly' },
    fields: { campaignName: 'Thử thách 21 ngày', subject: 'Thử thách 21 ngày bắt đầu thứ Hai', preheader: '15 phút mỗi sáng, có huấn luyện viên nhắn mỗi ngày' },
    blocks: [
      { kind: 'nav', content: { brand: 'Fitly', links: [{ label: 'Chương trình', url: `${B}/programs` }, { label: 'HLV', url: `${B}/coaches` }, { label: 'Cộng đồng', url: `${B}/community` }] } },
      { kind: 'dark-band', content: { eyebrow: 'Thử thách 21 ngày', headline: '15 PHÚT MỖI SÁNG. 21 NGÀY. XONG.', subhead: 'Bắt đầu thứ Hai 20/10. Huấn luyện viên nhắn bạn mỗi ngày. Bỏ 1 buổi vẫn tính, bỏ 3 buổi thì bắt đầu lại.', button: { label: 'Tham gia miễn phí', url: `${B}/21` } } },
      { kind: 'stats', content: { stats: [{ value: '15′', label: 'mỗi ngày' }, { value: '21', label: 'ngày' }, { value: '8.400', label: 'người đã xong' }] } },
      { kind: 'bento', content: { items: [{ name: 'Bài tập theo trình độ', body: 'Ba mức, tự điều chỉnh theo nhịp tim tuần trước.', url: `${B}/21#levels` }, { name: 'HLV nhắn mỗi sáng', body: 'Một tin nhắn, một việc cần làm.', url: `${B}/21#coach` }, { name: 'Nhóm 12 người', body: 'Cùng ngày bắt đầu, cùng ngày về đích.', url: `${B}/21#group` }] } },
      { kind: 'quote', content: { quote: 'Lần đầu tôi tập đủ 21 ngày. Vì có người nhắn mỗi sáng.', author: '— Thanh Tùng, 34 tuổi, Hà Nội' } },
      { kind: 'cta-wide', content: { button: { label: 'Tham gia thử thách 20/10', url: `${B}/21` }, subhead: 'Miễn phí. Không cần thiết bị. Huỷ bất cứ lúc nào.' } },
      { kind: 'footer', content: { brand: 'Fitly', address: 'Fitly · fitly.vn · hi@fitly.vn' } },
    ],
  },
  {
    kind: 'kids', name: 'Giáo dục trẻ em', desc: 'Hero giữa · hàng icon · tập mới · checklist · footer social', preset: 'Candy', tag: 'trend', brand: { headingFamily: 'Be Vietnam Pro', name: 'DorisEdu Kids' },
    fields: { campaignName: 'Welcome DorisEdu', subject: 'Chào mừng đến DorisEdu Kids!', preheader: 'Video, sách, trò chơi cho bé từ 3–8 tuổi, an toàn 100%' },
    blocks: [
      { kind: 'nav', content: { brand: 'DorisEdu Kids', links: [{ label: 'Học', url: `${B}/learn` }, { label: 'Video', url: `${B}/videos` }, { label: 'Sách', url: `${B}/books` }, { label: 'Shop', url: `${B}/shop` }] } },
      { kind: 'hero-center', content: { style: 'light', eyebrow: 'Xin chào bạn nhỏ', headline: 'Chào mừng đến DorisEdu Kids!', subhead: 'Một thế giới học tập vui vẻ: video 5 phút, sách tranh, trò chơi và những câu chuyện truyền cảm hứng cho bé mỗi ngày.', button: { label: 'Bắt đầu khám phá', url: `${B}/start` }, imageAlt: 'Bé gái và gấu bông cười tươi trước lâu đài' } },
      { kind: 'icon-row', content: { items: [{ name: 'Xem video', body: '▶', url: `${B}/videos` }, { name: 'Đọc sách', body: '📘', url: `${B}/books` }, { name: 'Chơi game', body: '🎮', url: `${B}/games` }, { name: 'Học cùng nhau', body: '💛', url: `${B}/together` }] } },
      { kind: 'articles', content: { items: [{ name: 'Động vật: 10 bạn thú đầu tiên', badge: 'EP01', url: `${B}/ep/1` }, { name: 'Gia đình: ai là ai trong nhà', badge: 'EP02', url: `${B}/ep/2` }, { name: 'Cơ thể: mắt, mũi, tay, chân', badge: 'EP03', url: `${B}/ep/3` }] } },
      { kind: 'checklist', content: { heading: 'Vì sao bố mẹ yên tâm', items: [{ name: 'Nội dung được giáo viên duyệt' }, { name: 'Không quảng cáo, không chat lạ' }, { name: '15 phút mỗi ngày là đủ' }] } },
      { kind: 'cta-wide', content: { button: { label: 'Mở khoá 7 ngày miễn phí', url: `${B}/trial` }, subhead: 'Không cần thẻ. Huỷ bất cứ lúc nào.' } },
      { kind: 'footer', content: { brand: 'DorisEdu Kids', address: 'DorisEdu · 12 Nguyễn Văn Cừ, Q5, TP.HCM · hello@dorisedu.kids', social: [{ label: 'YouTube', url: `${B}/yt` }, { label: 'Instagram', url: `${B}/ig` }, { label: 'TikTok', url: `${B}/tt` }, { label: 'Facebook', url: `${B}/fb` }] } },
    ],
  },
  {
    kind: 'offer', name: 'Ưu đãi lớn', desc: 'Gradient 20% OFF · mã giảm giá · đếm ngược · checklist · bảng giá', preset: 'Lavender', tag: 'trend', brand: { headingFamily: 'Montserrat', name: 'Doris Studio' },
    fields: { campaignName: 'Ưu đãi 20%', subject: 'Giảm 20% dự án tiếp theo của bạn, đến 1/11', preheader: 'Mã DORIS20 · web, 3D, game, thương hiệu' },
    blocks: [
      { kind: 'nav', content: { brand: 'Doris Studio', links: [{ label: 'Dịch vụ', url: `${B}/services` }, { label: 'Dự án', url: `${B}/work` }, { label: 'Liên hệ', url: `${B}/contact` }] } },
      { kind: 'hero-center', content: { style: 'gradient', eyebrow: 'Ưu đãi có hạn · 3/8 – 1/11', headline: 'GIẢM 20% DỰ ÁN TIẾP THEO', subhead: 'Website, 3D, game, nhận diện thương hiệu. Chất lượng cao, đúng hạn, đúng brand.', button: { label: 'Nhận ưu đãi ngay', url: `${B}/offer` }, imageAlt: 'Hộp quà và tinh thể phát sáng' } },
      { kind: 'code', content: { eyebrow: 'Dùng mã khi đặt dự án', headline: 'DORIS20', subhead: 'Áp dụng cho mọi gói, không giới hạn số lần dùng đến 1/11.' } },
      { kind: 'countdown', content: { heading: 'Ưu đãi kết thúc sau', stats: [{ value: '06', label: 'Ngày' }, { value: '12', label: 'Giờ' }, { value: '24', label: 'Phút' }, { value: '18', label: 'Giây' }] } },
      { kind: 'checklist', content: { heading: 'Gói Website + Brand kit', items: [{ name: 'Thiết kế web 3D' }, { name: 'Logo & nhận diện' }, { name: 'UI/UX' }, { name: 'Hỗ trợ ra mắt' }] } },
      { kind: 'products-3', content: { items: [{ name: 'Web 3D', oldPrice: '$2.000', price: '$1.600', badge: '-20%', url: `${B}/s/web` }, { name: 'Game world', oldPrice: '$3.500', price: '$2.800', badge: '-20%', url: `${B}/s/game` }, { name: 'Brand & visual', oldPrice: '$1.200', price: '$960', badge: '-20%', url: `${B}/s/brand` }] } },
      { kind: 'cta-wide', content: { button: { label: 'Bắt đầu dự án với -20%', url: `${B}/offer` }, subhead: 'Tư vấn miễn phí 30 phút trước khi ký.' } },
      { kind: 'footer', content: { brand: 'Doris Studio', address: 'Doris Studio · 3D web & game · hello@doris.studio', social: [{ label: 'Instagram', url: `${B}/ig` }, { label: 'TikTok', url: `${B}/tt` }, { label: 'LinkedIn', url: `${B}/li` }] } },
    ],
  },
  {
    kind: 'agency', name: 'Agency · dịch vụ', desc: 'Hero phủ ảnh · 4 dịch vụ · tiles kết quả · trích dẫn · CTA', preset: 'Neon', tag: 'trend', brand: { headingFamily: 'Space Grotesk', name: 'Phloem Studio' },
    fields: { campaignName: 'Agency intro', subject: 'Email đẹp. Chiến lược rõ. Chuyển đổi cao.', preheader: 'Case study: +320% doanh thu từ email trong 3 tháng' },
    blocks: [
      { kind: 'nav', content: { brand: 'Phloem Studio', links: [{ label: 'Dịch vụ', url: `${B}/services` }, { label: 'Dự án', url: `${B}/work` }, { label: 'Giới thiệu', url: `${B}/about` }] } },
      { kind: 'hero-overlay', content: { eyebrow: 'Chào mừng đến Phloem Studio', headline: 'Thiết kế email giúp thương hiệu lớn lên.', subhead: 'Chúng tôi làm chiến dịch, template và automation chuyển đổi cao cho thương hiệu hiện đại.', button: { label: 'Xem dự án', url: `${B}/work` }, imageAlt: 'Mockup email trên nền lá xanh' } },
      { kind: 'icon-row', content: { items: [{ name: 'Chiến lược', body: '◆', url: `${B}/s/strategy` }, { name: 'Thiết kế', body: '✎', url: `${B}/s/design` }, { name: 'Phát triển', body: '</>', url: `${B}/s/dev` }, { name: 'Automation', body: '⟳', url: `${B}/s/auto` }] } },
      { kind: 'stat-tiles', content: { stats: [{ value: '+320%', label: 'doanh thu từ email' }, { value: '+45%', label: 'tỉ lệ mở' }, { value: '+62%', label: 'tỉ lệ click' }, { value: '2.8×', label: 'ROI trong 3 tháng' }] } },
      { kind: 'quote', content: { quote: 'Phloem Studio thay đổi cách chúng tôi làm email. Kết quả tự nói lên tất cả.', author: '— Giám đốc marketing, thương hiệu lifestyle' } },
      { kind: 'cta', content: { heading: 'Cùng làm chiến dịch tiếp theo', subhead: 'Gọi 30 phút, nhận bản phác thảo trong 48 giờ.', button: { label: 'Đặt lịch', url: `${B}/book` } } },
      { kind: 'footer', content: { brand: 'Phloem Studio', address: 'Phloem Studio · email design · hello@phloem.studio', social: [{ label: 'Instagram', url: `${B}/ig` }, { label: 'LinkedIn', url: `${B}/li` }, { label: 'Website', url: `${B}` }] } },
    ],
  },
  {
    kind: 'assets', name: 'Sản phẩm số · asset', desc: 'Hero giữa · 6 sản phẩm giá cũ/mới · đếm ngược · CTA to', preset: 'Sky', tag: 'trend', brand: { headingFamily: 'Montserrat', name: 'Doris Assets' },
    fields: { campaignName: 'Deal asset 3D', subject: 'Mua 1 tặng 1: 8 bộ asset 3D cho dự án tiếp theo', preheader: 'Giá từ $9, dùng thương mại, hết 1/11' },
    blocks: [
      { kind: 'nav', content: { brand: 'Doris Assets', links: [{ label: 'Asset', url: `${B}/assets` }, { label: 'Bộ sưu tập', url: `${B}/packs` }, { label: 'Giấy phép', url: `${B}/license` }] } },
      { kind: 'hero-center', content: { style: 'band', eyebrow: 'Mua 1 tặng 1 · đến 1/11', headline: 'Asset 3D cho dự án của bạn', subhead: 'Môi trường, nhân vật, UI, props. Dùng thương mại, cập nhật trọn đời.', button: { label: 'Xem deal', url: `${B}/deals` }, image: null } },
      { kind: 'products-3', content: { items: [{ name: 'Nhà gỗ cổ tích', oldPrice: '$29', price: '$15', badge: 'Mua 1 tặng 1', url: `${B}/a/house` }, { name: 'Cây phong cách low-poly', oldPrice: '$19', price: '$9', badge: '-50%', url: `${B}/a/tree` }, { name: 'Cầu gỗ', oldPrice: '$25', price: '$12', badge: '-50%', url: `${B}/a/bridge` }] } },
      { kind: 'products-3', content: { items: [{ name: 'Đèn đường', oldPrice: '$15', price: '$8', badge: '-45%', url: `${B}/a/lamp` }, { name: 'Ghế công viên', oldPrice: '$18', price: '$9', badge: '-50%', url: `${B}/a/bench` }, { name: 'Đá & cỏ', oldPrice: '$22', price: '$11', badge: '-50%', url: `${B}/a/rocks` }] } },
      { kind: 'countdown', content: { heading: 'Deal kết thúc sau', stats: [{ value: '06', label: 'Ngày' }, { value: '12', label: 'Giờ' }, { value: '24', label: 'Phút' }, { value: '18', label: 'Giây' }] } },
      { kind: 'cta-wide', content: { button: { label: 'Mua asset, nhận quà', url: `${B}/deals` }, subhead: 'Tự động tặng sản phẩm rẻ hơn trong giỏ.' } },
      { kind: 'footer', content: { brand: 'Doris Assets', address: 'Doris Assets · doris.assets · support@doris.assets', social: [{ label: 'YouTube', url: `${B}/yt` }, { label: 'Instagram', url: `${B}/ig` }, { label: 'X', url: `${B}/x` }] } },
    ],
  },
  {
    kind: 'portfolio', name: 'Portfolio · case study', desc: 'Hero ảnh · tiles kết quả · 3 dự án · trích dẫn · CTA', preset: 'Lavender', tag: 'trend', brand: { headingFamily: 'Playfair Display', name: 'Doris' },
    fields: { campaignName: 'Case study tháng 10', subject: 'Từ ý tưởng đến thế giới sống động', preheader: 'Case study: website 3D giúp thương hiệu tăng 2.8× chuyển đổi' },
    blocks: [
      { kind: 'nav', content: { brand: 'Doris', links: [{ label: 'Dự án', url: `${B}/work` }, { label: 'Dịch vụ', url: `${B}/services` }, { label: 'Liên hệ', url: `${B}/contact` }] } },
      { kind: 'hero', content: { eyebrow: 'Case study', headline: 'Từ ý tưởng đến một thế giới sống động', subhead: 'Chúng tôi biến ý tưởng của một thương hiệu lifestyle thành trải nghiệm 3D giữ chân người xem 3 phút.', button: { label: 'Đọc case study', url: `${B}/case/lifestyle` }, imageAlt: 'Lâu đài nổi giữa thác nước, phong cách 3D' } },
      { kind: 'stat-tiles', content: { stats: [{ value: '+320%', label: 'tương tác người dùng' }, { value: '+150%', label: 'thời gian trên trang' }, { value: '2.8×', label: 'tỉ lệ chuyển đổi' }] } },
      { kind: 'articles', content: { items: [{ name: 'Website thương hiệu cao cấp', body: 'Xem dự án →', url: `${B}/work/luxury` }, { name: 'Thiết kế thế giới game', body: 'Xem dự án →', url: `${B}/work/game` }, { name: 'Trải nghiệm 3D tương tác', body: 'Xem dự án →', url: `${B}/work/3d` }] } },
      { kind: 'quote', content: { quote: 'Doris Studio biến tầm nhìn của chúng tôi thành một thế giới mà khách hàng không muốn rời đi.', author: '— CEO, thương hiệu lifestyle' } },
      { kind: 'cta', content: { heading: 'Có dự án trong đầu?', subhead: 'Tư vấn miễn phí, trả lời trong 24 giờ.', button: { label: 'Bắt đầu dự án', url: `${B}/start` } } },
      { kind: 'footer', content: { brand: 'Doris', address: 'Doris · 3D web & game designer · hi@doris.design', social: [{ label: 'Instagram', url: `${B}/ig` }, { label: 'TikTok', url: `${B}/tt` }, { label: 'LinkedIn', url: `${B}/li` }] } },
    ],
  },
  {
    kind: 'appkids', name: 'Game · app cho bé', desc: 'Hero giữa dải màu · hàng icon · mã quà · CTA to · footer social', preset: 'Sky', tag: 'trend', brand: { headingFamily: 'Be Vietnam Pro', name: 'HappyTown' },
    fields: { campaignName: 'HappyTown update', subject: 'Khám phá vùng đất mới trong HappyTown!', preheader: 'Nông trại, trang trí, câu cá, đua xe. Mã HAPPYTOWN25 tặng 50.000 xu' },
    blocks: [
      { kind: 'nav', content: { brand: 'HappyTown', links: [{ label: 'Chơi', url: `${B}/play` }, { label: 'Tin mới', url: `${B}/news` }, { label: 'Cộng đồng', url: `${B}/community` }] } },
      { kind: 'hero-center', content: { style: 'band', eyebrow: 'Cập nhật mới', headline: 'Khám phá vùng đất mới!', subhead: 'Làm nông, trang trí nhà, câu cá, đua xe. Gặp bạn bè khắp thế giới.', button: { label: 'Chơi ngay', url: `${B}/play` }, imageAlt: 'Bé và chú chó corgi trước ngôi nhà nhỏ' } },
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
