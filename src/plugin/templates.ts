// Figma-side design helpers: email templates, blocks, frame optimisation, mobile variant.
// Everything is built with auto layout so blocks stack and the mobile variant can reflow.
import type { BlockKind, TemplateKind } from '../shared/types';
import { writeField } from './normalize';
import { setFields } from './storage';

const FONT_R: FontName = { family: 'Inter', style: 'Regular' };
const FONT_SB: FontName = { family: 'Inter', style: 'Semi Bold' };
const FONT_B: FontName = { family: 'Inter', style: 'Bold' };

export const EMAIL_W = 600;
const P = {
  bg: '#FFFFFF', ink: '#121512', muted: '#6E756F', accent: '#0F3D2E', accentInk: '#FFFFFF',
  soft: '#F3F5F3', line: '#E3E7E4', placeholder: '#DDE3DF', placeholderInk: '#5E6B62',
};

let fontsLoaded = false;
async function fonts() {
  if (fontsLoaded) return;
  await Promise.all([FONT_R, FONT_SB, FONT_B].map((f) => figma.loadFontAsync(f)));
  fontsLoaded = true;
}

function rgb(hex: string): RGB {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function solid(hex: string): Paint[] { return [{ type: 'SOLID', color: rgb(hex) }]; }

interface StackOpts { w?: number; pad?: number | [number, number]; gap?: number; fill?: string | null; align?: 'MIN' | 'CENTER' | 'MAX'; radius?: number; hug?: boolean }

function stack(name: string, dir: 'VERTICAL' | 'HORIZONTAL', o: StackOpts = {}): FrameNode {
  const f = figma.createFrame();
  f.name = name;
  f.layoutMode = dir;
  const [pv, ph] = Array.isArray(o.pad) ? o.pad : [o.pad ?? 0, o.pad ?? 0];
  f.paddingTop = pv; f.paddingBottom = pv; f.paddingLeft = ph; f.paddingRight = ph;
  f.itemSpacing = o.gap ?? 0;
  f.fills = o.fill === null ? [] : solid(o.fill ?? P.bg);
  f.clipsContent = false;
  f.cornerRadius = o.radius ?? 0;
  if (o.hug) {
    f.primaryAxisSizingMode = 'AUTO'; f.counterAxisSizingMode = 'AUTO';
  } else if (dir === 'VERTICAL') {
    f.counterAxisSizingMode = 'FIXED'; f.primaryAxisSizingMode = 'AUTO'; f.resize(o.w ?? EMAIL_W, 10);
  } else {
    f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'AUTO'; f.resize(o.w ?? EMAIL_W, 10);
  }
  f.counterAxisAlignItems = o.align ?? 'MIN';
  return f;
}

function fill(node: SceneNode & LayoutMixin) { try { node.layoutSizingHorizontal = 'FILL'; } catch { /* parent not auto layout */ } }

async function text(chars: string, o: { size: number; font?: FontName; color?: string; w?: number; align?: 'LEFT' | 'CENTER' | 'RIGHT'; lh?: number; link?: string; name?: string }): Promise<TextNode> {
  await fonts();
  const t = figma.createText();
  t.fontName = o.font ?? FONT_R;
  t.characters = chars;
  t.fontSize = o.size;
  t.lineHeight = { value: o.lh ?? Math.round(o.size * 1.4), unit: 'PIXELS' };
  t.fills = solid(o.color ?? P.ink);
  t.textAlignHorizontal = o.align ?? 'LEFT';
  t.name = o.name ?? chars.slice(0, 32);
  if (o.w) { t.textAutoResize = 'HEIGHT'; t.resize(o.w, t.height); } else t.textAutoResize = 'WIDTH_AND_HEIGHT';
  if (o.link) { t.hyperlink = { type: 'URL', value: o.link }; writeField(t, 'link', o.link); }
  return t;
}

/** Image placeholder: a soft rect with a label. Replace the fill with a real image; the alt lives in Phloem's field. */
async function placeholder(name: string, w: number, h: number, alt: string, link?: string): Promise<FrameNode> {
  const f = stack(name, 'VERTICAL', { w, fill: P.placeholder, align: 'CENTER' });
  f.primaryAxisSizingMode = 'FIXED'; f.counterAxisSizingMode = 'FIXED';
  f.resize(w, h);
  f.primaryAxisAlignItems = 'CENTER';
  f.clipsContent = true;
  const label = await text(`Ảnh ${w}×${h}\nkéo ảnh vào đây`, { size: 12, color: P.placeholderInk, align: 'CENTER', name: 'placeholder label' });
  f.appendChild(label);
  writeField(f, 'alt', alt);
  if (link) writeField(f, 'link', link);
  return f;
}

async function button(label: string, url: string, o: { full?: boolean; w?: number } = {}): Promise<FrameNode> {
  const b = stack(`Button #link=${url}`, 'HORIZONTAL', { pad: [14, 28], gap: 0, fill: P.accent, align: 'CENTER', radius: 6, hug: true });
  b.primaryAxisAlignItems = 'CENTER';
  const t = await text(label, { size: 15, font: FONT_SB, color: P.accentInk, name: label });
  b.appendChild(t);
  writeField(b, 'link', url);
  writeField(b, 'alt', label);
  if (o.w) { b.primaryAxisSizingMode = 'FIXED'; b.resize(o.w, b.height); }
  return b;
}

// ---------- blocks ----------
export async function makeBlock(kind: BlockKind): Promise<FrameNode> {
  await fonts();
  switch (kind) {
    case 'nav': {
      const f = stack('Nav', 'HORIZONTAL', { pad: [18, 24], gap: 20, align: 'CENTER' });
      f.primaryAxisAlignItems = 'SPACE_BETWEEN';
      f.appendChild(await text('BRAND', { size: 18, font: FONT_B, link: 'https://example.com', name: 'Logo' }));
      const links = stack('Links', 'HORIZONTAL', { gap: 18, hug: true, fill: null, align: 'CENTER' });
      for (const [l, u] of [['Sản phẩm', 'https://example.com/shop'], ['Bộ sưu tập', 'https://example.com/collections'], ['Về chúng tôi', 'https://example.com/about']]) {
        links.appendChild(await text(l, { size: 13, color: P.muted, link: u }));
      }
      f.appendChild(links);
      return f;
    }
    case 'hero': {
      const f = stack('Hero', 'VERTICAL');
      f.appendChild(await placeholder('Hero image', EMAIL_W, 340, 'Ảnh chủ đề của email', 'https://example.com/shop'));
      const body = stack('Hero copy', 'VERTICAL', { pad: [32, 24], gap: 12 });
      body.appendChild(await text('Tiêu đề lớn, nói thẳng lợi ích', { size: 28, font: FONT_B, w: 552, lh: 36, name: 'Headline' }));
      body.appendChild(await text('Một câu phụ giải thích vì sao người đọc nên quan tâm hôm nay. Ngắn, cụ thể, có hạn.', { size: 16, color: P.muted, w: 552, lh: 24, name: 'Subhead' }));
      const wrap = stack('CTA wrap', 'HORIZONTAL', { gap: 0, hug: true, fill: null });
      wrap.appendChild(await button('Khám phá ngay', 'https://example.com/shop'));
      body.appendChild(wrap);
      f.appendChild(body);
      return f;
    }
    case 'text': {
      const f = stack('Text', 'VERTICAL', { pad: [24, 24], gap: 10 });
      f.appendChild(await text('Tiêu đề phần', { size: 20, font: FONT_SB, w: 552, lh: 28, name: 'Heading' }));
      f.appendChild(await text('Đoạn nội dung. Giữ 2–4 dòng, mỗi dòng một ý. Email là ảnh nên cỡ chữ ≥ 14px để đọc được trên điện thoại.', { size: 15, color: P.ink, w: 552, lh: 24, name: 'Paragraph' }));
      return f;
    }
    case 'cta': {
      const f = stack('CTA', 'VERTICAL', { pad: [8, 24], gap: 0, align: 'CENTER' });
      f.appendChild(await button('Mua ngay', 'https://example.com/shop'));
      return f;
    }
    case 'products-2':
    case 'products-3': {
      const n = kind === 'products-3' ? 3 : 2;
      const gap = 24, inner = EMAIL_W - 48;
      const cw = Math.floor((inner - gap * (n - 1)) / n);
      const row = stack(`Products ×${n}`, 'HORIZONTAL', { pad: [16, 24], gap });
      row.layoutWrap = 'WRAP';
      row.counterAxisSpacing = gap;
      for (let i = 1; i <= n; i++) {
        const url = `https://example.com/products/item-${i}`;
        const card = stack(`Product ${i} #link=${url}`, 'VERTICAL', { w: cw, gap: 8, fill: null });
        card.appendChild(await placeholder('Product image', cw, cw, `Sản phẩm ${i}`));
        card.appendChild(await text(`Tên sản phẩm ${i}`, { size: 15, font: FONT_SB, w: cw, name: 'Name' }));
        card.appendChild(await text('450.000₫', { size: 14, color: P.muted, w: cw, name: 'Price' }));
        writeField(card, 'link', url);
        writeField(card, 'alt', `Sản phẩm ${i} — 450.000₫`);
        row.appendChild(card);
      }
      return row;
    }
    case 'feature-row': {
      const f = stack('Feature', 'HORIZONTAL', { pad: [16, 24], gap: 24, align: 'CENTER' });
      f.appendChild(await placeholder('Feature image', 264, 200, 'Minh hoạ tính năng'));
      const col = stack('Feature copy', 'VERTICAL', { w: 264, gap: 8, fill: null });
      col.appendChild(await text('Điểm nổi bật', { size: 18, font: FONT_SB, w: 264, lh: 26, name: 'Heading' }));
      col.appendChild(await text('Hai dòng mô tả. Nói kết quả người dùng nhận được, không nói tính năng.', { size: 14, color: P.muted, w: 264, lh: 22, name: 'Body' }));
      col.appendChild(await text('Xem thêm →', { size: 14, font: FONT_SB, color: P.accent, link: 'https://example.com/feature', name: 'Link' }));
      f.appendChild(col);
      return f;
    }
    case 'divider': {
      const f = stack('Divider', 'VERTICAL', { pad: [16, 24] });
      const r = figma.createRectangle(); r.name = 'Line'; r.resize(552, 1); r.fills = solid(P.line);
      f.appendChild(r);
      return f;
    }
    case 'spacer': {
      const f = stack('Spacer', 'VERTICAL', { pad: [12, 0] });
      f.primaryAxisSizingMode = 'FIXED'; f.resize(EMAIL_W, 24);
      return f;
    }
    case 'hero-band':
    case 'stats':
    case 'quote': {
      // Studio-only richer blocks; in Figma fall back to a text block the designer can restyle.
      const f = await makeBlock('text');
      f.name = kind;
      return f;
    }
    case 'footer': {
      const f = stack('Footer', 'VERTICAL', { pad: [28, 24], gap: 8, fill: P.soft, align: 'CENTER' });
      f.appendChild(await text('BRAND', { size: 13, font: FONT_SB, color: P.ink, name: 'Brand' }));
      f.appendChild(await text('123 Đường Lê Lợi, Quận 1, TP.HCM · hello@example.com', { size: 12, color: P.muted, w: 552, align: 'CENTER', name: 'Address' }));
      const links = stack('Footer links', 'HORIZONTAL', { gap: 16, hug: true, fill: null });
      links.appendChild(await text('Huỷ đăng ký', { size: 12, color: P.muted, link: 'https://example.com/unsubscribe', name: 'Unsubscribe' }));
      links.appendChild(await text('Cập nhật thông tin', { size: 12, color: P.muted, link: 'https://example.com/preferences', name: 'Preferences' }));
      f.appendChild(links);
      return f;
    }
  }
}

// ---------- email frame ----------
function nextFreeSpot(): { x: number; y: number } {
  let maxRight = 0, top = Infinity;
  for (const c of figma.currentPage.children) {
    maxRight = Math.max(maxRight, c.x + c.width);
    top = Math.min(top, c.y);
  }
  return { x: figma.currentPage.children.length ? maxRight + 120 : 0, y: isFinite(top) ? top : 0 };
}

export async function makeEmailFrame(name: string): Promise<FrameNode> {
  const f = stack(name, 'VERTICAL', { w: EMAIL_W, fill: P.bg });
  f.clipsContent = true;
  const spot = nextFreeSpot();
  f.x = spot.x; f.y = spot.y;
  return f;
}

const TEMPLATES: Partial<Record<TemplateKind, { name: string; subject: string; preheader: string; blocks: BlockKind[] }>> = {
  newsletter: { name: 'Newsletter', subject: 'Tháng này có gì mới', preheader: '3 điều đáng xem trong 2 phút', blocks: ['nav', 'hero', 'text', 'feature-row', 'divider', 'feature-row', 'cta', 'footer'] },
  'product-grid': { name: 'Product grid', subject: 'Hàng mới về — chọn trước khi hết', preheader: '6 sản phẩm vừa lên kệ', blocks: ['nav', 'hero', 'products-3', 'products-3', 'cta', 'footer'] },
  promo: { name: 'Promo', subject: 'Giảm 30% đến hết Chủ nhật', preheader: 'Mã PHLOEM30 · Freeship toàn quốc', blocks: ['nav', 'hero', 'products-2', 'cta', 'footer'] },
  welcome: { name: 'Welcome', subject: 'Chào mừng bạn — bắt đầu từ đây', preheader: 'Ưu đãi 10% cho đơn đầu tiên', blocks: ['nav', 'hero', 'text', 'cta', 'footer'] },
  cart: { name: 'Cart reminder', subject: 'Bạn để quên vài món trong giỏ', preheader: 'Giữ giỏ hàng thêm 24 giờ', blocks: ['nav', 'text', 'products-2', 'cta', 'footer'] },
};

export async function insertTemplate(kind: TemplateKind): Promise<FrameNode> {
  await fonts();
  const t = TEMPLATES[kind] ?? TEMPLATES.newsletter!;
  const frame = await makeEmailFrame(`${t.name} — email`);
  for (const b of t.blocks) {
    const block = await makeBlock(b);
    frame.appendChild(block);
    fill(block);
  }
  setFields(frame, { campaignName: t.name, subject: t.subject, preheader: t.preheader });
  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  if (kind === 'mobile-pair') await createMobileFrame(frame);
  return frame;
}

export async function insertBlock(target: FrameNode | null, kind: BlockKind): Promise<FrameNode> {
  const block = await makeBlock(kind);
  const frame = target ?? (await makeEmailFrame('Email'));
  if (frame.layoutMode !== 'NONE') {
    frame.appendChild(block);
    fill(block);
  } else {
    block.y = frame.height;
    block.x = 0;
    frame.appendChild(block);
    frame.resize(frame.width, frame.height + block.height);
  }
  figma.currentPage.selection = [frame];
  return frame;
}

// ---------- optimise ----------
export function roundPixels(frame: FrameNode): number {
  let n = 0;
  const round = (node: SceneNode) => {
    const rx = Math.round(node.x), ry = Math.round(node.y);
    if (rx !== node.x || ry !== node.y) { node.x = rx; node.y = ry; n++; }
    if (node.type !== 'TEXT' && 'resize' in node) {
      const rw = Math.max(1, Math.round(node.width)), rh = Math.max(1, Math.round(node.height));
      if (rw !== node.width || rh !== node.height) { (node as LayoutMixin).resize(rw, rh); n++; }
    }
    if ('children' in node) for (const c of node.children) round(c);
  };
  for (const c of frame.children) round(c);
  return n;
}

export function snapWidth(frame: FrameNode, width = EMAIL_W): boolean {
  if (Math.round(frame.width) === width) return false;
  frame.resize(width, frame.height);
  return true;
}

export function optimizeFrame(frame: FrameNode): string[] {
  const changes: string[] = [];
  if (frame.width >= 560 && frame.width <= 700 && snapWidth(frame)) changes.push(`Đưa chiều rộng ${Math.round(frame.width)} → 600px`);
  const rounded = roundPixels(frame);
  if (rounded) changes.push(`Làm tròn ${rounded} toạ độ/kích thước lẻ pixel`);
  if (!frame.clipsContent) { frame.clipsContent = true; changes.push('Bật clip content để lát ảnh không bị tràn'); }
  if (frame.rotation !== 0) { frame.rotation = 0; changes.push('Xoá rotation của frame'); }
  return changes;
}

/** Duplicate as a 375px mobile variant. Auto-layout frames reflow; others are scaled uniformly. */
export async function createMobileFrame(frame: FrameNode): Promise<FrameNode> {
  const clone = frame.clone();
  clone.name = `${frame.name.replace(/\s*\/\s*mobile$/i, '')} / mobile`;
  clone.x = frame.x + frame.width + 80;
  clone.y = frame.y;
  const target = 375;
  if (clone.layoutMode !== 'NONE') {
    clone.resize(target, clone.height);
    const reflow = (node: SceneNode, parentAuto: boolean) => {
      if (parentAuto && 'layoutSizingHorizontal' in node) {
        const lm = node as SceneNode & LayoutMixin;
        if (lm.width > target - 48 || node.type === 'TEXT') { try { lm.layoutSizingHorizontal = 'FILL'; } catch { /* ignore */ } }
      }
      if ('children' in node) {
        const auto = 'layoutMode' in node && (node as FrameNode).layoutMode !== 'NONE';
        if (auto && (node as FrameNode).layoutMode === 'HORIZONTAL' && node.children.length > 1) {
          const f = node as FrameNode;
          const kids = f.children.reduce((a, c) => a + c.width, 0);
          if (kids > target - 48) { try { f.layoutWrap = 'WRAP'; f.counterAxisSpacing = f.itemSpacing; } catch { /* ignore */ } }
        }
        for (const c of node.children) reflow(c, auto);
      }
    };
    for (const c of clone.children) reflow(c, true);
  } else {
    clone.rescale(target / frame.width);
    clone.x = frame.x + frame.width + 80;
  }
  setFields(frame, { mobileFrameId: clone.id });
  return clone;
}
