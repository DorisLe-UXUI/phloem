// Blocks and templates as document nodes. Every colour references a brand token, so picking a palette re-themes
// the whole email (bands, cards, eyebrows, prices, buttons, footer). Blocks take optional content so templates and
// the AI composer can fill real copy, products, images and links.
import type { BlockKind, TemplateKind } from '../../../src/shared/types';
import type { Brand, Doc, EmailFields, GroupNode, ImageNode, Node, RectNode, TextNode } from './types';
import { uid } from './types';
import { layoutText, textHeight } from '../render/textLayout';
import { syncGroup } from './ops';

export const W = 600;
const PAD = 24;

const base = (name: string) => ({ id: uid(), name, visible: true, locked: false, opacity: 1, link: null as string | null, alt: '' });

export function text(brand: Brand, t: string, o: Partial<TextNode> & { x: number; y: number; w: number }): TextNode {
  const n: TextNode = {
    ...base(o.name ?? t.slice(0, 24)), type: 'text', text: t, h: 0,
    fontFamily: o.fontFamily ?? 'brand', fontSize: o.fontSize ?? 15, fontWeight: o.fontWeight ?? 400, italic: false, underline: false,
    color: o.color ?? { token: 'ink' }, align: o.align ?? 'left', lineHeight: o.lineHeight ?? 1.45, letterSpacing: o.letterSpacing ?? 0,
    autoHeight: true, vAlign: 'top', ...o,
  } as TextNode;
  n.h = o.h ?? textHeight(n, brand);
  return n;
}

export function rect(o: Partial<RectNode> & { x: number; y: number; w: number; h: number }): RectNode {
  return { ...base(o.name ?? 'Rectangle'), type: 'rect', fill: { token: 'soft' }, stroke: null, radius: 0, ...o } as RectNode;
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
export interface ItemC { name: string; price?: string; url?: string; image?: string | null; alt?: string }
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
      kids.push(text(brand, up(c.brand || DEF.brand), { x: PAD, y: y + 25, w: 220, fontSize: 18, fontWeight: 800, letterSpacing: 1.5, name: 'Logo', link: c.links?.[0]?.url ? c.links[0].url.replace(/\/[^/]*$/, '') : 'https://example.com' }));
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
        const priceT = it.price ? text(brand, it.price, { x: x + 12, y: name.y + name.h + 4, w: cw - 24, fontSize: n === 3 ? 14 : 15, fontWeight: 700, color: { token: 'primary' }, name: 'Price' }) : null;
        const last = priceT ?? name;
        const cardH = last.y + last.h + 14 - top;
        const card = rect({ x, y: top, w: cw, h: cardH, fill: { token: 'soft' }, radius: 12, name: 'Card' });
        bottom = Math.max(bottom, top + cardH);
        cards.push(group(`Product ${i + 1}`, [card, img, name, ...(priceT ? [priceT] : [])], { link: url, alt: `${it.name}${it.price ? ' — ' + it.price : ''}` }));
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
      const brandT = text(brand, up(c.brand || DEF.brand), { x: PAD, y: y + 30, w: inner, fontSize: 13, fontWeight: 800, letterSpacing: 1.5, align: 'center', name: 'Brand' });
      const addr = text(brand, c.address || d.address, { x: PAD, y: brandT.y + brandT.h + 8, w: inner, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Address' });
      const unsub = text(brand, 'Huỷ đăng ký', { x: 0, y: addr.y + addr.h + 12, w: 90, fontSize: 12, color: { token: 'muted' }, align: 'right', underline: true, name: 'Unsubscribe', link: c.unsubscribeUrl || d.unsubscribeUrl });
      const prefs = text(brand, 'Cập nhật thông tin', { x: 0, y: unsub.y, w: 120, fontSize: 12, color: { token: 'muted' }, align: 'left', underline: true, name: 'Preferences', link: c.preferencesUrl || d.preferencesUrl });
      const uw = Math.ceil(measureWidth(brand, unsub)) + 2, pw = Math.ceil(measureWidth(brand, prefs)) + 2;
      unsub.w = uw; prefs.w = pw;
      const total = uw + 20 + pw; unsub.x = Math.round((W - total) / 2); prefs.x = unsub.x + uw + 20;
      h = unsub.y + unsub.h + 30 - y;
      kids.push(band(h, { token: 'soft' }), rect({ x: 0, y: y + h - 4, w: W, h: 4, fill: { token: 'primary' }, name: 'Accent bar' }), brandT, addr, unsub, prefs);
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

export interface TemplateDef { kind: TemplateKind; name: string; desc: string; blocks: BlockSpec[]; fields: EmailFields; preset?: string }

const B = 'https://example.com';
const sampleBrand = 'Terra';
const navLinks = [{ label: 'Sản phẩm', url: `${B}/shop` }, { label: 'Bộ sưu tập', url: `${B}/collections` }, { label: 'Về Terra', url: `${B}/about` }];
const footer = { brand: sampleBrand, address: 'Terra Co. · 123 Lê Lợi, Quận 1, TP.HCM · hello@terra.vn' };

export const TEMPLATES: TemplateDef[] = [
  {
    kind: 'newsletter', name: 'Newsletter', desc: 'Hero ảnh · câu chuyện · 2 bài · số liệu · CTA', preset: 'Forest',
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
    kind: 'promo', name: 'Promo / Sale', desc: 'Dải màu lớn · 2 sản phẩm · trích dẫn · CTA', preset: 'Coral',
    fields: { campaignName: 'Sale cuối tuần', subject: 'Giảm 30% đến hết Chủ nhật', preheader: 'Mã TERRA30 · Freeship toàn quốc' },
    blocks: [
      { kind: 'nav', content: { brand: sampleBrand, links: navLinks } },
      { kind: 'hero-band', content: { eyebrow: 'Chỉ 3 ngày', headline: 'Giảm 30% toàn bộ đồ gốm', subhead: 'Đến hết Chủ nhật 19/10. Nhập mã TERRA30 khi thanh toán. Freeship mọi đơn.', button: { label: 'Mua ngay', url: `${B}/sale` }, imageAlt: 'Bộ cốc và đĩa gốm đang giảm giá' } },
      { kind: 'products-2', content: { items: [{ name: 'Cốc men tro 300ml', price: '245.000₫  →  171.000₫', url: `${B}/p/coc-men-tro` }, { name: 'Đĩa ăn 24cm', price: '320.000₫  →  224.000₫', url: `${B}/p/dia-24` }] } },
      { kind: 'quote', content: { quote: 'Mua lần đầu vì tò mò, mua lần hai vì chất lượng. Giao nhanh, đóng gói đẹp, đúng như ảnh.', author: '— Minh Anh, khách hàng từ 2024' } },
      { kind: 'cta', content: { heading: 'Còn 72 giờ', subhead: 'Hàng giảm giá không áp dụng đổi trả. Mỗi mã dùng một lần.', button: { label: 'Xem tất cả sale', url: `${B}/sale` } } },
      { kind: 'footer', content: footer },
    ],
  },
  {
    kind: 'product-grid', name: 'Product grid', desc: 'Hero ảnh · lưới 3 cột ×2 · CTA', preset: 'Mono',
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
    kind: 'welcome', name: 'Welcome', desc: 'Dải màu chào mừng · lợi ích · số liệu · ưu đãi đầu', preset: 'Mint',
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
    kind: 'launch', name: 'Ra mắt sản phẩm', desc: 'Dải màu · 3 điểm nổi bật · số liệu · đặt trước', preset: 'Royal',
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
    kind: 'event', name: 'Mời sự kiện', desc: 'Hero ảnh · thời gian & địa điểm · chương trình · giữ chỗ', preset: 'Plum',
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
    kind: 'digest', name: 'Bản tin biên tập', desc: 'Mở đầu · 3 bài viết · divider · CTA đọc tiếp', preset: 'Mono',
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
    kind: 'seasonal', name: 'Sale theo mùa', desc: 'Dải màu lễ hội · lưới 3 · số liệu · đếm ngược', preset: 'Sunset',
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
  { kind: 'blank', name: 'Trống', desc: 'Artboard 600px trắng', blocks: [], fields: { campaignName: 'Email mới', subject: '', preheader: '' } },
];

export function makeTemplate(kind: TemplateKind, brand: Brand): { doc: Doc; fields: EmailFields; name: string } {
  const def = TEMPLATES.find((t) => t.kind === kind) ?? TEMPLATES[0];
  return { doc: buildDoc(def.blocks, brand), fields: { ...def.fields }, name: def.name };
}
