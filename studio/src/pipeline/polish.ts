// "AI tự chỉnh" beauty pass. Deterministic: it applies the design system (themeFor + the block vocabulary the
// templates use) to whatever is on the canvas, so an assembled or hand-edited email reads as designed:
// buttons in the brand's shape, display headlines, eyebrow pills, glows behind the hero, one dark band to anchor the
// story, alternating soft tints, rounded photos/cards, and contrast fixed on every band. Never moves content except
// to make room when a headline grows. Idempotent: a second run changes nothing.
import type { Brand, Color, Doc, GroupNode, ImageNode, Node, RectNode, TextNode } from '../model/types';
import { isDarkColor, resolveColor } from '../model/types';
import * as ops from '../model/ops';
import { contrastToken, measureWidth, rect as mkRect, themeFor } from '../model/templates';
import { textHeight } from '../render/textLayout';

export interface Polish { doc: Doc; changes: string[] }

const tok = (c: Color | null | undefined): string | null => (c && typeof c === 'object' ? c.token : null);
const HERO_RE = /hero|dark-band|statement|overlap|spotlight|glass/;
const STRUCT_RE = /^(nav|footer|ticker|divider|spacer)$/;

export function polishDesign(d0: Doc, brand: Brand): Polish {
  let d = JSON.parse(JSON.stringify(d0)) as Doc;
  const T = themeFor(brand.vibe, brand.shape);
  const changes: string[] = [];
  const W = d.width;
  const blocks = d.nodes.filter((n): n is GroupNode => n.type === 'group' && n.src !== 'html'); // free-form AI designs are composed: never restyled
  const kindOf = (g: GroupNode) => g.block || g.name.toLowerCase();
  const bandOf = (g: GroupNode): RectNode | null => g.children.find((k): k is RectNode => k.type === 'rect' && k.w >= W * 0.95 && k.h >= g.h * 0.85 && k.x <= 2) || null;
  const bandColor = (b: RectNode | null): Color | null => (b ? (b.gradient && !b.gradient.radial ? b.gradient.from : b.fill) : null);
  const darkBand = (g: GroupNode) => { const c = bandColor(bandOf(g)); return !!c && isDarkColor(resolveColor(c, brand) ?? brand.bg); };
  const walk = (list: Node[], fn: (n: Node, parent: GroupNode | null) => void, parent: GroupNode | null = null) => { for (const n of list) { fn(n, parent); if (n.type === 'group') walk(n.children, fn, n); } };
  const isButton = (n: Node): n is GroupNode => n.type === 'group' && /^Button ·/.test(n.name);
  const texts = (g: GroupNode): TextNode[] => { const out: TextNode[] = []; walk(g.children, (n, par) => { if (n.type === 'text' && !(par && isButton(par))) out.push(n); }); return out; };
  const retext = new Set<string>(); // texts whose metrics changed → re-measure and flow

  // 1. buttons: the brand's shape, weight and lift everywhere
  let btns = 0;
  walk(d.nodes, (n) => {
    if (!isButton(n)) return;
    const bg = n.children.find((k): k is RectNode => k.type === 'rect'); const label = n.children.find((k): k is TextNode => k.type === 'text');
    if (!bg || !label) return;
    const outline = !bg.fill && !!bg.stroke, inverse = tok(bg.fill) === 'bg';
    const wantR = T.btnRadius >= 999 ? 999 : T.btnRadius;
    const wantShadow = outline ? null : inverse ? (T.shadow ? { blur: 16, y: 6, color: '#000000', opacity: 0.18 } : null) : T.glow ? { blur: 24, y: 8, color: brand.primary, opacity: 0.38 } : T.shadow ? { blur: 14, y: 6, color: '#000000', opacity: 0.16 } : null;
    let changed = false;
    if (bg.radius !== wantR) { bg.radius = wantR; changed = true; }
    if (JSON.stringify(bg.shadow ?? null) !== JSON.stringify(wantShadow)) { bg.shadow = wantShadow; changed = true; }
    if (label.fontWeight < 700) { label.fontWeight = 700; changed = true; }
    // the label must read on its own button (coral on white fails 4.5:1): pick the brand token that reads best
    const bgHex = resolveColor(bg.fill, brand), lb = resolveColor(label.color, brand);
    if (bgHex && lb && ratio(lb, bgHex) < 4.5) { const pick = ratio(brand.ink, bgHex) >= ratio(brand.bg, bgHex) ? 'ink' : 'bg'; if (ratio(pick === 'ink' ? brand.ink : brand.bg, bgHex) > ratio(lb, bgHex)) { label.color = { token: pick }; changed = true; } }
    if (changed) btns++;
  });
  if (btns) changes.push(`${btns} nút theo đúng kiểu brand (${T.btnRadius >= 999 ? 'pill' : `bo ${T.btnRadius}px`}${T.glow ? ', phát sáng' : T.shadow ? ', bóng mềm' : ''})`);

  // 2. typography: one display headline per block, tight tracking, eyebrows set like labels, copy that breathes
  const heroIdx = blocks.findIndex((g) => HERO_RE.test(kindOf(g)));
  const hero = blocks[heroIdx >= 0 ? heroIdx : Math.min(1, blocks.length - 1)] as GroupNode | undefined;
  const headWeight = brand.shape?.headingWeight ?? (brand.vibe === 'luxury' || brand.vibe === 'editorial' ? 600 : 800);
  let heads = 0, eyebrows = 0, bodies = 0, pills = 0, heroUp = false;
  for (const g of blocks) {
    if (STRUCT_RE.test(kindOf(g))) continue;
    const ts = texts(g);
    const head = ts.filter((t) => t.fontSize >= 20 && t.text.trim().length > 2 && /[\p{L}]/u.test(t.text)).sort((a, b) => b.fontSize - a.fontSize)[0];
    if (head) {
      let ch = false;
      if (head.fontFamily !== 'heading') { head.fontFamily = 'heading'; ch = true; }
      if (head.fontWeight < headWeight) { head.fontWeight = headWeight; ch = true; }
      if (head.lineHeight > 1.15) { head.lineHeight = 1.08; ch = true; }
      if (Math.abs(head.letterSpacing) < 0.05 && Math.abs(T.track) >= 0.3 && head.fontSize >= 30) { head.letterSpacing = T.track; ch = true; } // only untouched tracking; never rewrite the copy's case
      if (g === hero && head.text.length <= 48 && g.h >= 300) { const want = Math.round(Math.min(64, 46 * T.heroScale)); if (head.fontSize < want) { head.fontSize = want; ch = true; heroUp = true; } }
      if (ch) { heads++; retext.add(head.id); }
    }
    for (const t of ts) {
      if (t === head) continue;
      const short = t.text.trim().length <= 40;
      const eyebrow = /eyebrow|kicker|label/i.test(t.name) || (t.fontSize <= 13 && short && t.fontWeight >= 600 && t.text === t.text.toUpperCase());
      if (eyebrow) {
        let ch = false;
        if (t.fontWeight < 800) { t.fontWeight = 800; ch = true; }
        if (t.letterSpacing < 1.6) { t.letterSpacing = 1.8; ch = true; }
        if (t.text !== t.text.toUpperCase()) { t.text = t.text.toUpperCase(); ch = true; }
        if (t.fontSize > 13) { t.fontSize = 12; ch = true; }
        if (ch) { eyebrows++; retext.add(t.id); }
        // playful / bold brands wear their eyebrow as a pill (the centred eyebrow above the headline, like the templates)
        if (T.eyebrowPill && g === hero && /eyebrow|kicker/i.test(t.name) && t.align === 'center' && head && t.y < head.y && !g.children.some((k) => k.name === 'Eyebrow pill') && g.children.includes(t)) {
          const pw = Math.ceil(measureWidth(brand, t)) + 28, ph = 28;
          const dark = darkBand(g), onPrimary = tok(bandColor(bandOf(g))) === 'primary';
          const pill = mkRect({ x: Math.round((W - pw) / 2), y: Math.round(t.y + t.h / 2 - ph / 2), w: pw, h: ph, radius: 999, name: 'Eyebrow pill', fill: onPrimary ? { token: 'bg' } : dark ? { token: 'primary' } : { token: 'primary', alpha: 0.12 } });
          t.color = onPrimary ? { token: 'primary' } : dark ? { token: 'onPrimary' } : { token: 'primary' };
          g.children.splice(g.children.indexOf(t), 0, pill); pills++;
        }
      } else if (t.text.trim().length > 60 && t.fontSize >= 13 && t.fontSize <= 18) {
        let ch = false;
        if (t.fontSize < 15) { t.fontSize = 15; ch = true; }
        if (t.lineHeight < 1.5) { t.lineHeight = 1.55; ch = true; }
        if (ch) { bodies++; retext.add(t.id); }
      }
    }
  }
  if (heads) changes.push(`${heads} tiêu đề thành chữ display (font heading, đậm ${headWeight}, tracking ${T.track})${heroUp ? ', tiêu đề hero phóng lớn' : ''}`);
  if (eyebrows) changes.push(`${eyebrows} eyebrow đặt như nhãn (in hoa, giãn chữ)`);
  if (pills) changes.push(`${pills} eyebrow thành pill`);
  if (bodies) changes.push(`${bodies} đoạn copy dễ đọc hơn (15px, dãn dòng 1.55)`);

  // 3. the hero: glow pools, floating product, scrim under text on photos, gradient band for bold brands
  if (hero) {
    const band = bandOf(hero);
    const photoHero = hero.children.some((k) => k.type === 'image' && k.assetId && k.fit === 'cover' && k.w >= W * 0.8);
    if (band && T.blobs && band.h >= 180 && !photoHero && !hero.children.some((k) => k.name === 'Glow')) {
      const sz = Math.min(380, band.h - 16), light = true;
      const glows = [
        mkRect({ x: W - Math.round(sz * 0.8), y: band.y + 8, w: sz, h: sz, fill: null, gradient: { from: { token: 'accent', alpha: light ? 0.5 : 0.28 }, to: { token: 'accent', alpha: 0 }, angle: 0, radial: true }, name: 'Glow' }),
        mkRect({ x: 0, y: band.y + band.h - sz - 8, w: Math.round(sz * 0.8), h: Math.round(sz * 0.8), fill: null, gradient: { from: '#FFFFFF3a', to: '#FFFFFF00', angle: 0, radial: true }, name: 'Glow' }),
      ];
      hero.children.splice(hero.children.indexOf(band) + 1, 0, ...glows);
      changes.push('Vầng sáng mềm sau hero');
    }
    if (band && tok(band.fill) === 'primary' && !band.gradient && (brand.vibe === 'bold' || brand.vibe === 'playful' || brand.gradient)) {
      band.gradient = { from: { token: 'primary' }, to: { token: 'accent' }, angle: brand.gradient?.angle ?? 135 }; band.fill = null;
      changes.push('Dải hero chuyển gradient primary → accent');
    }
    let floated = 0, scrims = 0;
    const heroTexts = texts(hero);
    walk(hero.children, (n) => {
      if (n.type !== 'image' || !n.assetId) return;
      if (n.fit === 'contain' && n.w >= 160 && !n.floatShadow && (T.shadow || T.glow)) { n.floatShadow = true; floated++; }
      if (n.fit === 'cover' && n.w >= W * 0.8 && !n.overlay) {
        const over = heroTexts.some((t) => t.x < n.x + n.w && n.x < t.x + t.w && t.y < n.y + n.h && n.y < t.y + t.h && t.fontSize >= 16);
        if (over) { n.overlay = { color: '#000000', opacity: 0.38, gradient: true }; scrims++; }
      }
    });
    if (floated) changes.push('Sản phẩm nổi với bóng mềm');
    if (scrims) changes.push('Phủ tối dần dưới chữ trên ảnh hero');
  }

  // 4. one dark band anchors the story (luxury stays airy)
  if (brand.vibe !== 'luxury' && !blocks.some(darkBand)) {
    const cta = blocks.find((g) => /^cta/.test(kindOf(g)) && bandOf(g));
    if (cta) {
      const band = bandOf(cta)!; band.fill = { token: 'ink' }; band.gradient = null;
      const fg: Color = { token: contrastToken(brand, { token: 'ink' }) };
      for (const t of texts(cta)) t.color = fg;
      walk(cta.children, (n) => { if (!isButton(n)) return; const bg = n.children.find((k): k is RectNode => k.type === 'rect'); const label = n.children.find((k): k is TextNode => k.type === 'text'); if (bg && label && bg.fill) { bg.fill = { token: 'bg' }; bg.stroke = null; bg.shadow = T.shadow ? { blur: 16, y: 6, color: '#000000', opacity: 0.18 } : null; label.color = { token: 'primary' }; } });
      changes.push('Dải CTA tối để kết thúc mạnh');
    }
  }

  // 5. rhythm: light content blocks alternate white / soft so a long email never reads as one flat sheet
  let tints = 0, expectSoft = false;
  for (const g of blocks) {
    const kind = kindOf(g); const band = bandOf(g);
    if (STRUCT_RE.test(kind) || HERO_RE.test(kind) || !band) continue;
    if (darkBand(g) || tok(bandColor(band)) === 'primary' || band.gradient) { expectSoft = false; continue; }
    const t = tok(band.fill) ?? 'bg';
    if (t !== 'bg' && t !== 'soft') continue;
    const want = expectSoft ? 'soft' : 'bg';
    if (t !== want) { band.fill = { token: want }; tints++; }
    expectSoft = !expectSoft;
  }
  if (tints) changes.push(`${tints} dải nền xen kẽ trắng / mềm`);

  // 6. photos and cards wear the brand's radius and lift
  let imgs = 0, cards = 0;
  walk(d.nodes, (n, par) => {
    if (n.type === 'image' && n.assetId && n.fit === 'cover' && n.w < W * 0.95 && n.radius === 0 && !n.tilt && !n.rotate && !(par === hero) && T.radius >= 4) { n.radius = Math.min(20, T.radius); imgs++; }
    if (n.type === 'rect' && /card|tile/i.test(n.name) && n.w < W * 0.9) {
      let ch = false;
      if (n.radius !== Math.min(24, T.radius)) { n.radius = Math.min(24, T.radius); ch = true; }
      const wantShadow = T.shadow ? { blur: 24, y: 10, color: '#000000', opacity: 0.1 } : null;
      if (JSON.stringify(n.shadow ?? null) !== JSON.stringify(wantShadow)) { n.shadow = wantShadow; ch = true; }
      if (T.stroke && !n.stroke) { n.stroke = { color: { token: 'line' }, width: 1 }; ch = true; }
      if (ch) cards++;
    }
  });
  if (imgs) changes.push(`${imgs} ảnh bo góc ${Math.min(20, T.radius)}px`);
  if (cards) changes.push(`${cards} card theo kiểu brand`);

  // 7. contrast: every text reads against the surface right behind it (innermost covering rect: band, card, pill),
  //    same bar as the checker (WCAG 4.5:1, 3:1 for ≥ 24px); text on photos is left to its scrim
  let contrast = 0;
  for (const g of blocks) {
    const surfaces: (RectNode | ImageNode)[] = [];
    walk(g.children, (k) => { if (k.type === 'image' || (k.type === 'rect' && (k.fill || k.gradient))) surfaces.push(k); });
    for (const t of texts(g)) {
      const hex = resolveColor(t.color, brand); if (!hex) continue;
      // surfaces under most of the text box (a ticker line runs past the band edge), innermost first
      const area = t.w * t.h; const ov = (k: { x: number; y: number; w: number; h: number }) => Math.max(0, Math.min(k.x + k.w, t.x + t.w) - Math.max(k.x, t.x)) * Math.max(0, Math.min(k.y + k.h, t.y + t.h) - Math.max(k.y, t.y));
      const covering = surfaces.filter((k) => ov(k) >= area * 0.6).sort((a, b) => a.w * a.h - b.w * b.h);
      const under = covering[0]; if (!under || under.type === 'image') continue;
      const uc: Color | null = under.gradient && !under.gradient.radial ? under.gradient.from : under.fill; if (!uc) continue;
      const underHex = resolveColor(uc, brand); if (!underHex) continue;
      const need = t.fontSize >= 24 ? 3 : 4.5;
      if (ratio(hex, underHex) >= need) continue;
      const pick = ratio(brand.ink, underHex) >= ratio(brand.bg, underHex) ? 'ink' : 'bg';
      if (ratio(pick === 'ink' ? brand.ink : brand.bg, underHex) <= ratio(hex, underHex)) continue; // nothing better available
      t.color = { token: pick }; if (t.opacity < 1) t.opacity = 1; contrast++;
    }
  }
  if (contrast) changes.push(`Sửa tương phản ${contrast} đoạn chữ`);

  // 8. flow: texts whose metrics changed get re-measured, siblings and later blocks move to make room
  const order = [...retext].map((id) => ops.findNode(d, id)).filter((n): n is TextNode => !!n && n.type === 'text').sort((a, b) => a.y - b.y);
  for (const t of order) {
    if (!t.autoHeight) continue;
    const h = textHeight(t, brand);
    if (Math.abs(h - t.h) >= 1) d = ops.setHeightFlow(d, t.id, h);
  }
  d = ops.mapNodes(d, (n) => (n.type === 'group' ? ops.syncGroup(n) : n));
  const gs = d.nodes.filter((n) => n.type === 'group');
  const overlapping = gs.some((a, i) => gs.slice(i + 1).some((b) => Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2));
  if (overlapping) d = ops.reflowBlocks(d); // a flow glitch must never leave two bands on top of each other
  if (d.autoHeight !== false) d = { ...d, height: Math.max(100, ops.contentHeight(d)) };
  return { doc: d, changes };
}

const ratio = (a: string, b: string) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
function lum(hex: string): number {
  const m = /^#?([0-9a-f]{6})/i.exec(hex); if (!m) return 0.5;
  const n = parseInt(m[1], 16); const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
