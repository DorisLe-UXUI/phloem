// "AI tự chỉnh", the real one: a creative director LOOKS at the current email (rendered), reads its blocks, the checker's
// complaints and the brand, then re-plans the whole email with the design system: keeps what the designer composed by
// hand, rebuilds the rest as proper blocks (real copy, images, links preserved), trims to a sane length, one CTA.
// The result is rebuilt with makeBlock, so every block is on-system; deterministic fixes run after it in autoFix.
import type { Brand, Doc, EmailFields, GroupNode, ImageNode, Node, TextNode } from '../model/types';
import { VIBES, type Vibe } from '../model/types';
import * as ops from '../model/ops';
import { BLOCKS, DARK, TINTABLE, makeBlock, type BlockContent, type BlockSpec } from '../model/templates';
import type { BlockKind, Suggestion } from '../../../src/shared/types';
import { assets } from '../storage/assets';
import { renderToCanvas } from '../render/renderer';
import { askClaude, extractJson, type AiImage } from './client';
import { BLOCK_DOC, DESIGN_DOC, thumbOf } from './generate';

export interface DocBlock { index: number; kind: string; content: BlockContent; keep: boolean; reason?: string; h: number }
export interface Redesign { doc: Doc; fields: Partial<EmailFields>; vibe?: Vibe; note: string; problems: string[]; kept: number; rebuilt: number }

const flatTexts = (list: Node[]): TextNode[] => { const out: TextNode[] = []; const walk = (ns: Node[]) => { for (const n of ns) { if (n.type === 'text') out.push(n); if (n.type === 'group') walk(n.children); } }; walk(list); return out; };
const flatImages = (list: Node[]): ImageNode[] => { const out: ImageNode[] = []; const walk = (ns: Node[]) => { for (const n of ns) { if (n.type === 'image') out.push(n); if (n.type === 'group') walk(n.children); } }; walk(list); return out; };
const PRICE_RE = /^[^\n]{0,12}?(\d[\d.,]{1,12}\s?(₫|đ|vnd|\$|€|£|usd|k)|[$€£]\s?\d[\d.,]*)[^\n]{0,8}$/i;

/** What a block says, read back from its layers (template naming) or from the spec it was built from. */
export function blockContent(g: GroupNode): BlockContent {
  if (g.content && typeof g.content === 'object') return JSON.parse(JSON.stringify(g.content)) as BlockContent;
  const c: BlockContent = {};
  const links: { label: string; url: string }[] = [];
  const stats: { value: string; label: string }[] = [];
  for (const k of g.children) {
    if (k.type === 'text') {
      const n = k.name, t = k.text.trim(); if (!t) continue;
      if (/^eyebrow/i.test(n)) c.eyebrow = t;
      else if (/^headline/i.test(n)) c.headline = t;
      else if (/^heading/i.test(n)) c.heading = t;
      else if (/^sub/i.test(n)) c.subhead = t;
      else if (/^body|^paragraph|^text$/i.test(n)) c.body = t;
      else if (/^quote$/i.test(n)) c.quote = t;
      else if (/^author/i.test(n)) c.author = t;
      else if (/^address/i.test(n)) c.address = t;
      else if (/^ticker/i.test(n)) c.items = t.split(/\s*✦\s*/).map((x) => x.trim()).filter(Boolean).slice(0, 5).map((name) => ({ name }));
      else if (/^stat (\d)/i.test(n)) { const i = +RegExp.$1 - 1; (stats[i] ||= { value: '', label: '' }).value = t; }
      else if (/^label (\d)/i.test(n)) { const i = +RegExp.$1 - 1; (stats[i] ||= { value: '', label: '' }).label = t; }
      else if (k.link && t.length <= 40) links.push({ label: t, url: k.link });
      else if (k.fontSize >= 20 && !c.headline && !c.heading) c.headline = t;
      else if (t.length > 30 && !c.body) c.body = t;
    } else if (k.type === 'group') {
      if (/^Button ·/.test(k.name)) { const lbl = k.children.find((x): x is TextNode => x.type === 'text'); if (lbl) c.button = { label: lbl.text, url: k.link || '' }; }
      else if (/^Social · /.test(k.name)) (c.social ||= []).push({ label: k.name.replace('Social · ', ''), url: k.link || '' });
      else {
        const ts = flatTexts(k.children).filter((x) => x.text.trim()).sort((a, b) => b.fontSize - a.fontSize);
        const badge = ts.find((x) => /badge/i.test(x.name)); const price = ts.find((x) => x !== badge && PRICE_RE.test(x.text.trim()));
        const name = ts.find((x) => x !== badge && x !== price && !/^\d+$/.test(x.text.trim()) && !/^(stars|★)/i.test(x.name));
        const body = ts.find((x) => x !== badge && x !== price && x !== name && x.text.trim().length > 12);
        const img = flatImages(k.children).find((x) => x.assetId);
        if (name) (c.items ||= []).push({ name: name.text.trim(), price: price?.text.trim(), badge: badge?.text.trim(), body: body?.text.trim(), url: k.link || undefined, image: img?.assetId ?? null });
      }
    } else if (k.type === 'image' && k.assetId && !/logo|prop/i.test(k.name)) { if (!c.image) { c.image = k.assetId; c.imageAlt = k.alt || undefined; } }
  }
  if (stats.length) c.stats = stats.filter((s) => s.value);
  if (g.block === 'nav' || g.block === 'footer') { if (links.length) c.links = links; }
  else if (links.length === 1 && !c.button) c.link = links[0];
  return c;
}

/** The email as the AI sees it: one entry per top-level block; hand-composed blocks are flagged to be kept verbatim. */
export function docBlocks(d: Doc): DocBlock[] {
  return d.nodes.map((n, index) => {
    if (n.type !== 'group') return { index, kind: n.type, content: {}, keep: true, reason: 'layer tự do', h: Math.round(n.h) };
    const imgs = flatImages(n.children);
    const props = imgs.filter((i) => /prop/i.test(i.name) || i.rotate || (i.tilt && (i.tilt.rx || i.tilt.ry)));
    const loose = imgs.filter((i) => i.assetId && n.children.includes(i) && !/logo/i.test(i.name)).length;
    const keep = !n.block || props.length > 0 || loose > 3;
    const reason = !n.block ? 'ghép tay' : props.length ? `${props.length} ảnh phụ kiện/xoay ghép tay` : loose > 3 ? 'nhiều ảnh xếp tay' : undefined;
    return { index, kind: n.block || n.name, content: blockContent(n), keep, reason, h: Math.round(n.h) };
  });
}

const HEIGHTS = 'nav 72 · hero / hero-band / hero-product 560–780 · hero-card 700 · hero-center 520 · hero-overlay 560 · glass-hero 560 · products-3 400 · products-2 420 · zigzag (2 hàng) 560 · feature-row 300 · split 320 · text 220–300 · stats 150 · stat-tiles 200 · quote 220 · reviews 330 · steps 300 · cta / cta-wide 180–280 · offer 300 · countdown 140 · code 150 · ticker 46 · badges 90 · icon-row 170 · gallery 380 · articles 330 · menu (3 hàng) 420 · spotlight 520 · overlap 500 · statement 300 · footer 160–200';

function langOf(d: Doc): 'vi' | 'en' { const t = flatTexts(d.nodes).map((x) => x.text).join(' '); return /[ăâđêôơưàảãáạằẳẵắặầẩẫấậèẻẽéẹềểễếệìỉĩíịòỏõóọồổỗốộờởỡớợùủũúụừửữứựỳỷỹýỵ]/i.test(t) ? 'vi' : 'en'; }

function render(d: Doc, b: Brand): AiImage | null {
  try {
    const c = renderToCanvas(d, b, assets, 0.5);
    const url = c.toDataURL('image/jpeg', 0.7);
    return { name: 'email hiện tại', mime: 'image/jpeg', base64: url.split(',')[1] };
  } catch { return null; }
}

type Entry = { keep: number } | { kind: BlockKind; content: BlockContent };

/** Ask the creative director for a new plan and build it. Throws when the AI is unreachable or returns nothing usable. */
export async function redesignDoc(d: Doc, brand: Brand, fields: EmailFields, score: number, suggestions: Suggestion[], onStage?: (s: string) => void): Promise<Redesign> {
  if (d.width !== 600) throw new Error('AI chỉ làm lại bản desktop 600px.');
  const blocks = docBlocks(d);
  const lang = langOf(d);
  const used = new Set<string>(); for (const im of flatImages(d.nodes)) if (im.assetId) used.add(im.assetId);
  const pid = assets.context.project;
  const pool = assets.all().filter((a) => used.has(a.id) || a.project === pid || a.src?.kind === 'web').filter((a) => a.id !== brand.logoAssetId && a.id !== brand.logoLightAssetId).slice(0, 40);
  const images: AiImage[] = []; const imageLines: string[] = [];
  onStage?.('Đang chụp email hiện tại…');
  const shot = render(d, brand);
  for (const a of pool) {
    const where = a.src?.kind === 'web' ? ` · từ ${a.src.host}${a.src.page || ''}` : a.src?.kind === 'ai' ? ' · ảnh tách nền' : '';
    if (used.has(a.id) && images.length < 12) { const t = await thumbOf(a.id); if (t) { images.push(t); imageLines.push(`- imageId "${a.id}": ${a.name}, ${a.w}×${a.h}${where} (đang dùng; ảnh kèm theo thứ tự)`); continue; } }
    imageLines.push(`- imageId "${a.id}": ${a.name}, ${a.w}×${a.h}${where}${used.has(a.id) ? ' (đang dùng)' : ''}`);
  }
  const L = brand.links || {};
  const linkLines = [L.website ? `Trang chủ: ${L.website}` : '', L.nav?.length ? `Menu: ${L.nav.map((x) => `${x.label} → ${x.url}`).join(' · ')}` : '', L.socials?.length ? `Social: ${L.socials.map((x) => `${x.label} → ${x.url}`).join(' · ')}` : '', L.products?.length ? `Sản phẩm thật: ${L.products.slice(0, 12).map((x) => `${x.name} → ${x.url}`).join(' · ')}` : ''].filter(Boolean).join('\n');
  const blockLines = blocks.map((b) => `#${b.index} ${b.kind} (cao ${b.h}px)${b.keep ? ` — GIỮ NGUYÊN (${b.reason})` : ''}: ${JSON.stringify(b.content).slice(0, 700)}`).join('\n');
  const problems = suggestions.filter((s) => s.level !== 'good').map((s) => `- ${s.title}: ${s.detail}`).join('\n');
  const system = `Bạn là creative director của một agency email hàng đầu. Người dùng tự dựng một email trong Phloem (ảnh kèm theo là bản hiện tại; máy chấm ${score}/100) và bấm "AI tự chỉnh": họ muốn bạn LÀM LẠI cho thành bản 100 điểm, đẹp "wow" ngay cái nhìn đầu, đúng thương hiệu, chứ không phải sửa vặt.
Bạn nhận: ảnh bản hiện tại, danh sách block (#index, kind, nội dung, chiều cao), vấn đề máy chấm thấy, thương hiệu, link thật, ảnh có sẵn (imageId).
CÁCH LÀM:
- Giữ mọi nội dung thật: tên sản phẩm, giá, link, imageId, lời khách. Viết lại copy nhạt cho sắc, ngắn, cụ thể; headline hero ≤ 6 từ nếu dùng hero-product/dark-band.
- Chọn MỘT công thức WOW hợp ngành (xem hệ thống thiết kế) và dựng lại theo đó. Bỏ block lặp ý, block ảnh chụp màn hình web, lưới quá dày. KHÔNG bao giờ lưới 4 cột hay chữ nhỏ: dùng products-3 / products-2 / zigzag / menu / spotlight.
- ≤ 8 block, tổng chiều cao ≤ 2300px (tham khảo: ${HEIGHTS}). nav đầu, footer cuối. Đúng MỘT CTA chính (các nút khác cùng đích hoặc bỏ); mọi URL phải là link thật trong danh sách (hoặc trang chủ), không bịa.
- Block đánh dấu GIỮ NGUYÊN là người dùng ghép tay (thường là hero): PHẢI xuất hiện dưới dạng {"keep": index}, không dựng lại. Block khác đã ổn cũng có thể giữ bằng {"keep": index}.
- Ngôn ngữ copy: ${lang === 'en' ? 'English' : 'tiếng Việt'}. Bảng màu/logo/font do thương hiệu quyết định, bạn chỉ chọn vibe nếu cần.
Trả về CHỈ JSON: {"problems":["3–6 vấn đề thật bạn thấy"],"blocks":[{"keep":1} | {"kind":"products-3","content":{…}}],"fields":{"subject":"≤ 55 ký tự","preheader":"40–90 ký tự"},"vibe":"${VIBES.map((v) => v.v).join('|')}","note":"1 câu: bạn đã đổi gì và vì sao"}

${DESIGN_DOC}

${BLOCK_DOC}`;
  const user = [
    `Thương hiệu: ${brand.name} · primary ${brand.primary} · accent ${brand.accent} · vibe ${brand.vibe || 'clean'} · font ${brand.headingFamily} / ${brand.fontFamily}${brand.shape ? ` · design DNA ${JSON.stringify(brand.shape)}` : ''}`,
    linkLines ? `Link thật:\n${linkLines}` : 'Link thật: (không có — dùng link đang có trong block)',
    `Subject hiện tại: ${fields.subject || '(trống)'} · Preheader: ${fields.preheader || '(trống)'}`,
    `Block hiện tại (${blocks.length}, tổng cao ${Math.round(d.height)}px):\n${blockLines}`,
    problems ? `Máy chấm thấy:\n${problems}` : 'Máy chấm: không có cảnh báo.',
    imageLines.length ? `Ảnh có sẵn (${imageLines.length}):\n${imageLines.join('\n')}` : 'Ảnh: không có — image: null.',
    'Ảnh cuối cùng kèm theo là bản email hiện tại (thu nhỏ 50%).',
  ].join('\n\n');
  onStage?.('Creative director AI đang xem lại và dựng lại…');
  const text = await askClaude({ system, turns: [{ role: 'user', text: user, images: [...images, ...(shot ? [shot] : [])] }], maxTokens: 16000, effort: 'high' });
  const j = extractJson<{ problems?: string[]; blocks?: unknown[]; fields?: Partial<EmailFields>; vibe?: string; note?: string }>(text);
  if (!j || !Array.isArray(j.blocks) || !j.blocks.length) throw new Error('AI không trả về bố cục mới.');

  // ---- validate the plan ----
  const validIds = new Set(pool.map((a) => a.id));
  const home = L.website || L.nav?.[0]?.url || '';
  const fixUrl = (u?: string) => (u && !/example\.com/i.test(u) ? u : home || u || '');
  const kinds = new Set(BLOCKS.map((b) => b.kind));
  const entries: Entry[] = [];
  for (const raw of j.blocks) {
    const e = raw as { keep?: unknown; kind?: unknown; content?: unknown };
    if (typeof e.keep === 'number' && blocks[e.keep]) { if (!entries.some((x) => 'keep' in x && x.keep === e.keep)) entries.push({ keep: e.keep }); continue; }
    if (typeof e.kind !== 'string' || !kinds.has(e.kind as BlockKind)) continue;
    const c = (e.content && typeof e.content === 'object' ? e.content : {}) as BlockContent;
    if (c.image && !validIds.has(String(c.image))) c.image = null;
    if (c.items) for (const it of c.items) { if (it.image && !validIds.has(String(it.image))) it.image = null; if (it.url) it.url = fixUrl(it.url); }
    if (c.style && !['light', 'band', 'gradient', 'ink', 'dark', 'card', 'right', 'soft', 'menu', 'center', 'plain'].includes(String(c.style))) delete c.style;
    if (c.effect && !['extrude', 'neon', 'outline', 'shadow'].includes(String(c.effect))) delete c.effect;
    if (c.tilt !== undefined) { const t = Number(c.tilt); if (!Number.isFinite(t) || !t) delete c.tilt; else c.tilt = Math.max(-30, Math.min(30, t)); }
    if (c.button) c.button = { label: String(c.button.label || 'Shop'), url: fixUrl(c.button.url) };
    if (c.link) c.link = { label: String(c.link.label || '→'), url: fixUrl(c.link.url) };
    if (c.links) c.links = c.links.map((l) => ({ label: String(l.label || ''), url: fixUrl(l.url) })).filter((l) => l.label);
    if (c.social) c.social = c.social.filter((x) => x && x.url && !/example\.com/i.test(x.url));
    if (c.unsubscribeUrl && /example\.com/i.test(c.unsubscribeUrl)) delete c.unsubscribeUrl;
    if (c.preferencesUrl && /example\.com/i.test(c.preferencesUrl)) delete c.preferencesUrl;
    entries.push({ kind: e.kind as BlockKind, content: c });
  }
  // hand-composed blocks must survive: drop them in where the first anchor landed, or right after the nav
  for (const b of blocks) {
    if (!b.keep || entries.some((x) => 'keep' in x && x.keep === b.index)) continue;
    const at = entries.findIndex((x) => 'kind' in x && /hero|statement|dark-band|overlap|spotlight|glass/.test(x.kind));
    if (at >= 0 && /hero|statement|dark-band|overlap|spotlight|glass/.test(b.kind)) entries.splice(at, 1, { keep: b.index });
    else entries.splice(Math.min(1, entries.length), 0, { keep: b.index });
  }
  const kindAt = (e: Entry) => ('keep' in e ? blocks[e.keep].kind : e.kind);
  if (kindAt(entries[0]) !== 'nav') entries.unshift({ kind: 'nav', content: { brand: brand.name, links: (L.nav || []).slice(0, 4) } });
  if (kindAt(entries[entries.length - 1]) !== 'footer') entries.push({ kind: 'footer', content: { brand: brand.name, social: L.socials, unsubscribeUrl: '*|UNSUB|*', preferencesUrl: '*|UPDATE_PROFILE|*' } });

  // ---- build ----
  const vibe = VIBES.some((v) => v.v === j.vibe) ? (j.vibe as Vibe) : undefined;
  const b2: Brand = { ...brand, ...(vibe ? { vibe } : {}) };
  const nodes: Node[] = []; let y = 0, tintNext = false, kept = 0, rebuilt = 0;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if ('keep' in e) {
      const src = d.nodes[e.keep]; const tmp = ops.moveBy({ ...d, nodes: [JSON.parse(JSON.stringify(src))] }, [src.id], 0, y - ops.bounds(src).y);
      const g = tmp.nodes[0]; nodes.push(g); y += ops.bounds(g).h; kept++;
      const dark = src.type === 'group' && (DARK.has((src.block || '') as BlockKind));
      if (dark) tintNext = false; else if (src.type === 'group' && TINTABLE.has((src.block || '') as BlockKind)) tintNext = !tintNext;
      continue;
    }
    const c = { ...e.content };
    const st = c.style;
    if (e.kind === 'nav' && !st) { // the nav takes the colour of the band under it, like buildDoc
      const nx = entries[i + 1]; const nk = nx ? kindAt(nx) : ''; const ns = nx && 'kind' in nx ? nx.content.style : undefined;
      let navStyle: BlockContent['style'] | undefined;
      if (nk === 'hero-product') navStyle = ns === 'band' || ns === 'gradient' ? 'band' : ns === 'soft' || ns === 'light' ? 'soft' : 'dark';
      else if (nk === 'dark-band' || nk === 'hero-overlay' || nk === 'glass-hero') navStyle = 'dark';
      else if (nk === 'hero-band') navStyle = 'band';
      else if (nk === 'hero-card') navStyle = ns === 'soft' || ns === 'light' ? 'soft' : ns === 'dark' || ns === 'ink' ? 'dark' : 'band';
      else if (nk === 'hero-center' && (ns === 'band' || ns === 'gradient' || ns === 'ink')) navStyle = 'band';
      else if (nk === 'stats' && ns === 'dark') navStyle = 'dark';
      if (navStyle) c.style = navStyle;
    }
    if (DARK.has(e.kind) || st === 'dark' || st === 'ink' || st === 'band' || st === 'gradient') tintNext = false;
    else if (TINTABLE.has(e.kind)) { c.tint = tintNext; tintNext = !tintNext; }
    const g = makeBlock(e.kind, b2, y, c);
    nodes.push(g); y += g.h; rebuilt++;
  }
  const doc: Doc = { ...d, width: 600, height: Math.max(400, y), nodes, autoHeight: true };
  const f: Partial<EmailFields> = {};
  if (j.fields?.subject && !fields.subject.trim()) f.subject = String(j.fields.subject).slice(0, 80);
  if (j.fields?.preheader && !fields.preheader.trim()) f.preheader = String(j.fields.preheader).slice(0, 140);
  return { doc, fields: f, vibe, note: String(j.note || '').slice(0, 240), problems: (j.problems || []).map(String).slice(0, 6), kept, rebuilt };
}
