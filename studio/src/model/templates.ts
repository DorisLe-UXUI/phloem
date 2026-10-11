// Blocks and templates as document nodes. Colours reference brand tokens so re-theming recolours everything.
import type { BlockKind, TemplateKind } from '../../../src/shared/types';
import type { Brand, Doc, EmailFields, GroupNode, ImageNode, Node, RectNode, TextNode } from './types';
import { uid } from './types';
import { layoutText, textHeight } from '../render/textLayout';
import { syncGroup } from './ops';

export const W = 600;
const PAD = 24;

const base = (name: string) => ({ id: uid(), name, visible: true, locked: true as boolean, opacity: 1, link: null as string | null, alt: '' });

export function text(brand: Brand, t: string, o: Partial<TextNode> & { x: number; y: number; w: number }): TextNode {
  const n: TextNode = {
    ...base(o.name ?? t.slice(0, 24)), type: 'text', locked: false, text: t, h: 0,
    fontFamily: o.fontFamily ?? 'brand', fontSize: o.fontSize ?? 15, fontWeight: o.fontWeight ?? 400, italic: false, underline: false,
    color: o.color ?? { token: 'ink' }, align: o.align ?? 'left', lineHeight: o.lineHeight ?? 1.45, letterSpacing: o.letterSpacing ?? 0,
    autoHeight: true, vAlign: 'top', ...o,
  } as TextNode;
  n.h = o.h ?? textHeight(n, brand);
  return n;
}

export function rect(o: Partial<RectNode> & { x: number; y: number; w: number; h: number }): RectNode {
  return { ...base(o.name ?? 'Rectangle'), type: 'rect', locked: false, fill: { token: 'soft' }, stroke: null, radius: 0, ...o } as RectNode;
}

export function image(o: Partial<ImageNode> & { x: number; y: number; w: number; h: number }): ImageNode {
  return { ...base(o.name ?? 'Image'), type: 'image', locked: false, assetId: null, fit: 'cover', radius: 0, fill: null, overlay: null, ...o } as ImageNode;
}

export function group(name: string, children: Node[], extra: Partial<GroupNode> = {}): GroupNode {
  return syncGroup({ ...base(name), type: 'group', locked: false, x: 0, y: 0, w: 0, h: 0, children, ...extra } as GroupNode);
}

export function button(brand: Brand, label: string, url: string, x: number, y: number, o: { w?: number; h?: number; radius?: number; fontSize?: number } = {}): GroupNode {
  const fs = o.fontSize ?? 15;
  const probe = text(brand, label, { x: 0, y: 0, w: 400, fontSize: fs, fontWeight: 600, name: label });
  const wText = Math.min(400, Math.ceil(measureWidth(brand, probe)));
  const w = o.w ?? wText + 56, h = o.h ?? 48;
  const bg = rect({ x, y, w, h, fill: { token: 'primary' }, radius: o.radius ?? 6, name: 'Button bg' });
  const t = text(brand, label, { x, y, w, h, fontSize: fs, fontWeight: 600, color: { token: 'onPrimary' }, align: 'center', autoHeight: false, vAlign: 'middle', name: label });
  return group(`Button · ${label}`, [bg, t], { link: url, alt: label });
}

/** Natural single-line width of a text node. */
export function measureWidth(brand: Brand, n: TextNode): number {
  return Math.max(...layoutText({ ...n, w: 10000 }, brand).lines.map((l) => l.width), 10);
}

export const BLOCKS: { kind: BlockKind; name: string; desc: string }[] = [
  { kind: 'nav', name: 'Nav', desc: 'Logo + 3 link' },
  { kind: 'hero', name: 'Hero', desc: 'Ảnh lớn, tiêu đề, CTA' },
  { kind: 'text', name: 'Text', desc: 'Tiêu đề + đoạn' },
  { kind: 'cta', name: 'CTA', desc: 'Nút chính giữa' },
  { kind: 'products-2', name: 'Sản phẩm ×2', desc: '2 cột, mỗi ô 1 link' },
  { kind: 'products-3', name: 'Sản phẩm ×3', desc: '3 cột, mỗi ô 1 link' },
  { kind: 'feature-row', name: 'Ảnh + chữ', desc: 'Ảnh trái, nội dung phải' },
  { kind: 'divider', name: 'Divider', desc: 'Đường kẻ mảnh' },
  { kind: 'spacer', name: 'Spacer', desc: 'Khoảng trống 24px' },
  { kind: 'footer', name: 'Footer', desc: 'Địa chỉ, huỷ đăng ký' },
];

export function makeBlock(kind: BlockKind, brand: Brand, y: number): GroupNode {
  const kids: Node[] = [];
  let h = 0;
  const bgRect = (hh: number, fill: RectNode['fill'] = { token: 'bg' }) => rect({ x: 0, y, w: W, h: hh, fill, name: 'Block bg' });
  switch (kind) {
    case 'nav': {
      h = 64;
      kids.push(bgRect(h));
      kids.push(text(brand, 'BRAND', { x: PAD, y: y + 21, w: 120, fontSize: 18, fontWeight: 800, letterSpacing: 1, name: 'Logo', link: 'https://example.com' }));
      const links = ['Sản phẩm', 'Bộ sưu tập', 'Về chúng tôi'];
      let x = W - PAD;
      for (let i = links.length - 1; i >= 0; i--) {
        const t = text(brand, links[i], { x: 0, y: y + 23, w: 120, fontSize: 14, color: { token: 'muted' }, align: 'right', name: links[i], link: `https://example.com/${['shop', 'collections', 'about'][i]}` });
        const tw = Math.ceil(measureWidth(brand, t)) + 2; t.w = tw; t.x = x - tw; x -= tw + 22;
        kids.push(t);
      }
      break;
    }
    case 'hero': {
      const imgH = 340;
      kids.push(image({ x: 0, y, w: W, h: imgH, name: 'Hero image', alt: 'Ảnh chủ đề của email', link: 'https://example.com/shop' }));
      const head = text(brand, 'Tiêu đề lớn, nói thẳng lợi ích', { x: PAD, y: y + imgH + 32, w: W - PAD * 2, fontSize: 30, fontWeight: 800, lineHeight: 1.2, fontFamily: 'heading', name: 'Headline' });
      const sub = text(brand, 'Một câu phụ giải thích vì sao người đọc nên quan tâm hôm nay. Ngắn, cụ thể, có hạn.', { x: PAD, y: head.y + head.h + 12, w: W - PAD * 2, fontSize: 16, color: { token: 'muted' }, lineHeight: 1.5, name: 'Subhead' });
      const btn = button(brand, 'Khám phá ngay', 'https://example.com/shop', PAD, sub.y + sub.h + 20);
      h = btn.y + btn.h + 36 - y;
      kids.unshift(bgRect(h));
      kids.push(head, sub, btn);
      break;
    }
    case 'text': {
      const head = text(brand, 'Tiêu đề phần', { x: PAD, y: y + 24, w: W - PAD * 2, fontSize: 22, fontWeight: 700, lineHeight: 1.3, fontFamily: 'heading', name: 'Heading' });
      const body = text(brand, 'Đoạn nội dung. Giữ 2–4 dòng, mỗi dòng một ý. Email là ảnh nên cỡ chữ từ 14px trở lên để đọc được trên điện thoại.', { x: PAD, y: head.y + head.h + 10, w: W - PAD * 2, fontSize: 15, lineHeight: 1.6, name: 'Paragraph' });
      h = body.y + body.h + 24 - y;
      kids.push(bgRect(h), head, body);
      break;
    }
    case 'cta': {
      const btn = button(brand, 'Mua ngay', 'https://example.com/shop', 0, y + 12);
      btn.x = Math.round((W - btn.w) / 2);
      const dx = btn.x - btn.children[0].x; btn.children.forEach((c) => { c.x += dx; });
      h = btn.h + 24;
      kids.push(bgRect(h), syncGroup(btn));
      break;
    }
    case 'products-2':
    case 'products-3': {
      const n = kind === 'products-3' ? 3 : 2;
      const gap = 24, inner = W - PAD * 2, cw = Math.floor((inner - gap * (n - 1)) / n);
      const cards: Node[] = [];
      let bottom = y;
      for (let i = 0; i < n; i++) {
        const x = PAD + i * (cw + gap);
        const url = `https://example.com/products/item-${i + 1}`;
        const img = image({ x, y: y + 16, w: cw, h: cw, radius: 6, name: `Product image ${i + 1}`, alt: `Sản phẩm ${i + 1}` });
        const name = text(brand, `Tên sản phẩm ${i + 1}`, { x, y: img.y + img.h + 10, w: cw, fontSize: 15, fontWeight: 600, name: 'Name' });
        const price = text(brand, '450.000₫', { x, y: name.y + name.h + 4, w: cw, fontSize: 14, color: { token: 'muted' }, name: 'Price' });
        bottom = Math.max(bottom, price.y + price.h);
        cards.push(group(`Product ${i + 1}`, [img, name, price], { link: url, alt: `Sản phẩm ${i + 1} — 450.000₫` }));
      }
      h = bottom + 16 - y;
      kids.push(bgRect(h), ...cards);
      break;
    }
    case 'feature-row': {
      const imgW = 264, imgH = 200;
      const img = image({ x: PAD, y: y + 16, w: imgW, h: imgH, radius: 6, name: 'Feature image', alt: 'Minh hoạ tính năng' });
      const cx = PAD + imgW + 24, cwid = W - PAD - cx;
      const head = text(brand, 'Điểm nổi bật', { x: cx, y: y + 24, w: cwid, fontSize: 19, fontWeight: 700, lineHeight: 1.3, fontFamily: 'heading', name: 'Heading' });
      const body = text(brand, 'Hai dòng mô tả. Nói kết quả người dùng nhận được, không nói tính năng.', { x: cx, y: head.y + head.h + 8, w: cwid, fontSize: 14, color: { token: 'muted' }, lineHeight: 1.55, name: 'Body' });
      const more = text(brand, 'Xem thêm →', { x: cx, y: body.y + body.h + 10, w: cwid, fontSize: 14, fontWeight: 600, color: { token: 'primary' }, name: 'Link', link: 'https://example.com/feature' });
      h = Math.max(img.y + img.h, more.y + more.h) + 16 - y;
      kids.push(bgRect(h), img, head, body, more);
      break;
    }
    case 'divider': {
      h = 33;
      kids.push(bgRect(h), rect({ x: PAD, y: y + 16, w: W - PAD * 2, h: 1, fill: { token: 'line' }, name: 'Line' }));
      break;
    }
    case 'spacer': {
      h = 24;
      kids.push(bgRect(h));
      break;
    }
    case 'footer': {
      const brandT = text(brand, 'BRAND', { x: PAD, y: y + 28, w: W - PAD * 2, fontSize: 13, fontWeight: 700, letterSpacing: 1, align: 'center', name: 'Brand' });
      const addr = text(brand, '123 Đường Lê Lợi, Quận 1, TP.HCM · hello@example.com', { x: PAD, y: brandT.y + brandT.h + 8, w: W - PAD * 2, fontSize: 12, color: { token: 'muted' }, align: 'center', name: 'Address' });
      const unsub = text(brand, 'Huỷ đăng ký', { x: 0, y: addr.y + addr.h + 10, w: 90, fontSize: 12, color: { token: 'muted' }, align: 'right', underline: true, name: 'Unsubscribe', link: 'https://example.com/unsubscribe' });
      const prefs = text(brand, 'Cập nhật thông tin', { x: 0, y: unsub.y, w: 120, fontSize: 12, color: { token: 'muted' }, align: 'left', underline: true, name: 'Preferences', link: 'https://example.com/preferences' });
      const uw = Math.ceil(measureWidth(brand, unsub)) + 2, pw = Math.ceil(measureWidth(brand, prefs)) + 2;
      unsub.w = uw; prefs.w = pw;
      const total = uw + 20 + pw; unsub.x = Math.round((W - total) / 2); prefs.x = unsub.x + uw + 20;
      h = unsub.y + unsub.h + 28 - y;
      kids.push(bgRect(h, { token: 'soft' }), brandT, addr, unsub, prefs);
      break;
    }
  }
  const g = group(BLOCKS.find((b) => b.kind === kind)?.name ?? kind, kids, { block: kind });
  return g;
}

export interface TemplateDef { kind: TemplateKind; name: string; desc: string; blocks: BlockKind[]; fields: EmailFields }

export const TEMPLATES: TemplateDef[] = [
  { kind: 'newsletter', name: 'Newsletter', desc: 'Nav · hero · bài viết · CTA · footer', blocks: ['nav', 'hero', 'text', 'feature-row', 'divider', 'feature-row', 'cta', 'footer'], fields: { campaignName: 'Newsletter', subject: 'Tháng này có gì mới', preheader: '3 điều đáng xem trong 2 phút' } },
  { kind: 'product-grid', name: 'Product grid', desc: 'Lưới 3 cột ×2, mỗi ô một link', blocks: ['nav', 'hero', 'products-3', 'products-3', 'cta', 'footer'], fields: { campaignName: 'Hàng mới về', subject: 'Hàng mới về — chọn trước khi hết', preheader: '6 sản phẩm vừa lên kệ' } },
  { kind: 'promo', name: 'Promo / Sale', desc: 'Hero lớn, 2 sản phẩm, CTA', blocks: ['nav', 'hero', 'products-2', 'cta', 'footer'], fields: { campaignName: 'Promo cuối tuần', subject: 'Giảm 30% đến hết Chủ nhật', preheader: 'Mã PHLOEM30 · Freeship toàn quốc' } },
  { kind: 'welcome', name: 'Welcome', desc: 'Chào mừng + ưu đãi đầu', blocks: ['nav', 'hero', 'text', 'cta', 'footer'], fields: { campaignName: 'Welcome #1', subject: 'Chào mừng bạn — bắt đầu từ đây', preheader: 'Ưu đãi 10% cho đơn đầu tiên' } },
  { kind: 'cart', name: 'Cart reminder', desc: 'Nhắc giỏ hàng, 2 món', blocks: ['nav', 'text', 'products-2', 'cta', 'footer'], fields: { campaignName: 'Nhắc giỏ hàng', subject: 'Bạn để quên vài món trong giỏ', preheader: 'Giữ giỏ hàng thêm 24 giờ' } },
  { kind: 'mobile-pair', name: 'Trống', desc: 'Artboard 600px trắng', blocks: [], fields: { campaignName: 'Email mới', subject: '', preheader: '' } },
];

export function makeTemplate(kind: TemplateKind, brand: Brand): { doc: Doc; fields: EmailFields; name: string } {
  const def = TEMPLATES.find((t) => t.kind === kind) ?? TEMPLATES[0];
  const nodes: Node[] = [];
  let y = 0;
  for (const b of def.blocks) { const g = makeBlock(b, brand, y); nodes.push(g); y += g.h; }
  return { doc: { width: W, height: Math.max(y, 400), bg: { token: 'bg' }, nodes }, fields: { ...def.fields }, name: def.name };
}
