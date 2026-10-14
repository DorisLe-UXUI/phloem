// "Thiết kế tự do": Claude art-directs and codes each email like a studio designer (free HTML/CSS: real type scale,
// gradients, overlapping layers, SVG art, icons, motion), Phloem converts the layout into editable layers, and a
// creative-director pass looks at the RENDER (what subscribers will get) and sends back a better version.
// Three directions are planned together (so they really differ), then drawn in parallel, streaming live.
import type { Brand, Doc, EmailFields, Project, Vibe } from '../model/types';
import { BRAND_PRESETS, FONTS, VIBES } from '../model/types';
import { renderToCanvas } from '../render/renderer';
import { assets } from '../storage/assets';
import { ensureFonts } from '../render/fonts';
import { askClaude, extractJson, streamClaude, type AiImage } from './client';
import { GOAL_DESC, thumbOf, type GenInput } from './generate';
import { siteSummary } from './site';
import { extractHtml, htmlToDoc, tokenize } from './htmlToDoc';

export interface Palette { bg: string; surface: string; ink: string; muted: string; primary: string; accent: string; onPrimary: string; line: string }
export interface Direction {
  name: string; why: string; concept: string; aesthetic: string;
  palette: Palette; headingFont: string; bodyFont: string; vibe: Vibe;
  layout: string[]; motifs: string; images: { id: string; use: string }[]; fields: EmailFields;
}
export type DesignStage = 'queued' | 'drawing' | 'converting' | 'reviewing' | 'ready' | 'error';
export interface DesignVariant { dir: Direction; html: string; stage: DesignStage; doc?: Doc; mobile?: Doc | null; brand?: Brand; thumb?: string; error?: string; warnings?: string[]; reviewed?: boolean }

// ---------------------------------------------------------------------------------------------------------------
// The design brief Claude works from: craft (what good looks like) + the technical contract (what converts).

export const DESIGN_CRAFT = `You are a world-class art director and front-end designer. You design marketing emails that look like they came from a top studio (the craft of Apple, Aesop, Nike, Glossier, Stripe, the best Awwwards work) — never like a template.

DESIGN THINKING (decide before you code)
- Purpose & audience: what the reader must feel and do in the first 3 seconds.
- Execute the given art direction with precision. Intentionality beats intensity: refined minimalism and maximal energy both work when every detail serves one concept.
- One unforgettable idea per email: an oversized number, a cut-out product breaking out of its frame, a typographic poster hero, a sticker collage, a bold colour field, an editorial crop with an overlapping caption card, a ticket-shaped offer…

TYPOGRAPHY
- Distinctive display face + refined body face (only from the allowed list). Never more than two families.
- Dramatic scale contrast: display 52–96px, leading 0.9–1.05, slight negative tracking (-0.01 to -0.03em); body 15–18px / 1.5–1.65; eyebrows/labels 11–13px uppercase, tracking 0.14–0.28em.
- Mix weights on purpose; one highlighted word may change colour, weight or style. Hierarchy readable at a glance.

COLOUR
- A dominant colour with sharp accents beats timid, evenly spread palettes. Build from the direction's palette; derive tints and shades.
- Text contrast AA (4.5:1 body, 3:1 large). Use dark sections for drama and light ones to breathe — deliberately.

COMPOSITION
- Unexpected but controlled: asymmetry, overlap, grid-breaking elements, diagonal energy, cards layered over photos, full-bleed imagery, generous negative space OR deliberate density.
- Vary section rhythm (full-bleed → contained card → split → typographic statement → grid). One idea per section. Clear grid: 40px side margins at 600px, 8px spacing scale, 56–88px vertical padding on major sections.

DETAILS & DEPTH
- Gradient meshes (layered radial-gradients), soft glows (blurred circles), subtle textures (dot grids), decorative SVG shapes (blobs, arcs, stars, squiggles, waves) used sparingly and on-concept, rotated stickers/badges, layered soft shadows, hairline rules, numbered markers, icon bullets, ticket/coupon shapes, framed photos.
- Photos are heroes: crop boldly with object-fit/object-position; never shrink them into timid thumbnails.
- Polish components: buttons with real presence (min 48px tall, generous padding, considered radius/shadow), badges, cards, a designed footer.

AVOID (generic AI look)
- Purple-on-white gradients by default; everything centred in identical rounded cards; emoji bullet lists; grey boxes; 24px headlines; Inter/Roboto everywhere; cookie-cutter SaaS sections; decoration unrelated to the brand; "Welcome to our newsletter" copy.

COPY
- Specific, benefit-first, short. Headline ≤ 8 words. One primary CTA (1–3 words), repeated near the end. Use real data from the brief (prices, codes, dates, products, links); never invent numbers or testimonials that were not given (use policy facts instead).`;

export const DESIGN_TECH = `TECHNICAL CONTRACT (Phloem converts the browser layout into editable layers — follow exactly)
OUTPUT: one complete HTML document inside a single \`\`\`html fenced block, nothing else. Put all CSS in one <style> in <head>.
CANVAS: <body> holds exactly one <div id="email" data-email> with width:600px and the email background colour; inside it, 6–10 <section data-name="Short name"> stacked vertically. Sections own their padding. Absolutely positioned decoration must sit inside a position:relative section (use overflow:hidden on that section when decoration bleeds).
CONVERTS (use freely):
- Layout: flex, grid, absolute positioning, negative margins, overlap, z-index.
- Boxes: background-color; background-image with linear-gradient()/radial-gradient() (several layers OK: mesh glows); borders (all or single sides); border-radius (per corner OK); outer box-shadow; opacity; transform rotate()/translate()/scale(); filter: blur() for glows.
- Text: font-family (ONLY allowed fonts), font-size, font-weight, font-style, line-height, letter-spacing, text-transform, text-align, color, text-decoration, text-shadow (glow or hard long shadow), -webkit-text-stroke with transparent fill (outline display type). <br> for intentional breaks. <span> may change colour/weight/font inside a heading.
- Photos: ONLY <img data-img="IMAGE_ID" alt="…"> with ids from the image list; size with CSS width/height; object-fit:cover|contain; object-position to choose the focus.
- Icons & stickers: <img data-icon="set:name" alt="" style="width:28px;height:28px;color:#hex"> (always width+height; colour via CSS color for monochrome sets). Sets: ph (Phosphor — e.g. ph:arrow-right-bold, ph:star-fill, ph:truck-duotone, ph:lightning-fill, ph:check-circle-fill, ph:gift-duotone, ph:clock-countdown-fill), lucide, tabler, mdi, simple-icons (brand logos: simple-icons:instagram, simple-icons:facebook, simple-icons:tiktok, simple-icons:youtube, simple-icons:x, simple-icons:linkedin), fluent-emoji (colourful 3D-style stickers: fluent-emoji:fire, fluent-emoji:sparkles, fluent-emoji:party-popper, fluent-emoji:wrapped-gift, fluent-emoji:rocket, fluent-emoji:red-heart, fluent-emoji:star, fluent-emoji:high-voltage, fluent-emoji:shopping-bags, fluent-emoji:crown, fluent-emoji:gem-stone, fluent-emoji:hundred-points, fluent-emoji:alarm-clock, fluent-emoji:delivery-truck, fluent-emoji:hot-beverage, fluent-emoji:cherry-blossom). Only real icon names.
- Illustration & decoration: inline <svg viewBox="…" width="…" height="…"> with paths/shapes (blobs, waves, arcs, stars, squiggles, dot grids, arrows, abstract illustrations), colours as fill/stroke attributes or CSS. No <text> inside SVG.
- Links: every clickable element inside <a href="real URL">. Wrap each product/offer card in ONE <a> so the whole card is clickable; at most 6 distinct destinations per email. Unsubscribe <a href="*|UNSUB|*">, preferences <a href="*|UPDATE_PROFILE|*">.
- Footer: brand line, website or address, social icons (simple-icons inside links), and the exact words "Huỷ đăng ký" (Vietnamese copy) or "Unsubscribe" (English) linked to *|UNSUB|*.
- Motion (exported as GIF): data-anim on 3–6 elements. Entrances "fade|up|down|left|right|pop|wipe|type" with data-delay="0.15" (seconds), only in the first section or two. Loops "pulse|float|spin|shake|blink" on at most 2 small stickers/badges (every animated area becomes a GIF, keep them few and small).
NEVER (lost in conversion): ::before/::after content, CSS background url(), background-clip:text or gradient-filled text, mask, clip-path, mix-blend-mode, backdrop-filter, CSS animations/transitions, <video>, <canvas>, <script>, iframes, list bullets (use icon/shape markers), fonts not in the list, <link> tags, external image URLs, text baked into SVG.
MOBILE: add @media (max-width:480px) rules: #email{width:100%!important}; stack columns; display type ≈0.6×; side padding 20–24px; images full width. Phloem renders the same HTML at 375px for the mobile version, so nothing may overflow 375px there.
SIZE: total height 1600–2600px at 600px wide. Body text ≥ 15px, labels ≥ 12px, footer ≥ 12px, buttons ≥ 48px tall. Text on photos needs a scrim or a solid card behind it.`;

const CRITIC = `You are the creative director reviewing a designer's email before it ships. You receive the art direction, the HTML, and screenshots of how it RENDERS in Phloem (exactly what subscribers will see). Return a better version:
1. Fix everything wrong in the render: overlapping or clipped text, elements outside the 600px canvas, misalignment, cramped or uneven spacing, weak contrast, awkward empty areas, badly cropped photos, decoration covering content, anything that did not convert (follow the technical contract), sections that feel unfinished.
2. Push the craft toward award-winning: stronger hierarchy and scale contrast, a more striking hero, tighter typographic details, better rhythm between sections, richer but purposeful depth, polished components (buttons, badges, cards, footer). Keep the concept, palette, fonts, copy facts, links and image ids.
Return the COMPLETE revised HTML document in one \`\`\`html block. No commentary.`;

// ---------------------------------------------------------------------------------------------------------------

interface Ctx { lang: 'vi' | 'en'; brief: string; imageLines: string[]; thumbs: Map<string, AiImage>; validIds: Set<string>; fonts: string; presets: string }

function langOf(inp: GenInput): 'vi' | 'en' { return inp.language && inp.language !== 'auto' ? inp.language : (inp.site?.lang || '').toLowerCase().startsWith('en') ? 'en' : 'vi'; }

async function buildCtx(inp: GenInput): Promise<{ ctx: Ctx; images: AiImage[] }> {
  const lang = langOf(inp);
  const ids = [...new Set([...(inp.logoAssetId ? [inp.logoAssetId] : []), ...(inp.logoLightAssetId ? [inp.logoLightAssetId] : []), ...inp.imageIds])].filter((id) => assets.get(id));
  const thumbs = new Map<string, AiImage>(); const images: AiImage[] = []; const imageLines: string[] = [];
  for (const id of ids) {
    const m = assets.get(id)!;
    const role = id === inp.logoAssetId ? ' · LOGO (dùng ở header/footer trên nền sáng)' : id === inp.logoLightAssetId ? ' · LOGO SÁNG (dùng trên nền tối)' : m.src?.kind === 'web' ? ` · từ trang ${m.src.page || '/'}` : '';
    if (images.length < 24) { const t = await thumbOf(id); if (t) { thumbs.set(id, t); images.push(t); imageLines.push(`- "${id}": ${m.name} · ${m.w}×${m.h}px${role} (ảnh #${images.length} đính kèm)`); continue; } }
    imageLines.push(`- "${id}": ${m.name} · ${m.w}×${m.h}px${role}`);
  }
  const fonts = FONTS.filter((f) => f.google && (lang !== 'vi' || f.vi)).map((f) => `${f.family} (${f.cat})`).join(', ');
  const presets = BRAND_PRESETS.map((p) => `${p.name} ${p.brand.primary}/${p.brand.accent} on ${p.brand.bg}`).join('; ');
  const brief = [
    inp.site ? `WEBSITE PROFILE (read by Phloem):\n${siteSummary(inp.site, inp.webBrand || {})}` : '',
    inp.webBrand ? `Brand colours from the website: primary ${inp.webBrand.primary}, accent ${inp.webBrand.accent}, ink ${inp.webBrand.ink}, background ${inp.webBrand.bg}.` : '',
    inp.products && inp.products.length ? `PRODUCTS (use exactly these names/prices/links/images):\n${inp.products.map((p) => `- ${p.name}${p.price ? ` · ${p.price}` : ''}${p.compareAt ? ` (was ${p.compareAt})` : ''} · ${p.url || ''}${p.assetId ? ` · image "${p.assetId}"` : ''}`).join('\n')}` : '',
    `Email type: ${GOAL_DESC[inp.goal] || inp.goal}`,
    `Brand: ${inp.brandName || inp.webBrand?.name || 'BRAND'}`,
    `Tone: ${inp.tone}`,
    inp.palette !== 'auto' && inp.palette !== 'Web' ? `The user picked the palette "${inp.palette}" (${JSON.stringify(BRAND_PRESETS.find((p) => p.name === inp.palette)?.brand || {})}): all three directions use it.` : inp.palette === 'Web' ? 'The user wants the website colours: all three directions build on them.' : '',
    `Brief: ${inp.brief || '(none)'}`,
    `Raw content (headlines, products, prices, links, dates, codes):\n${inp.content || '(none — write sensible copy for this email type, no invented numbers)'}`,
    `COPY LANGUAGE: ${lang === 'en' ? 'English (natural, concise marketing English)' : 'Vietnamese (tiếng Việt tự nhiên, đúng chính tả, có dấu)'}`,
  ].filter(Boolean).join('\n\n');
  return { ctx: { lang, brief, imageLines, thumbs, validIds: new Set(ids), fonts, presets }, images };
}

const PLAN = `You are the creative director of a top design studio. Plan THREE email designs for the brief: three genuinely different art directions (different concept, composition, mood and type — not colour swaps), each one right for this brand and goal. If a website profile is given, all three must feel like that brand's own team made them (its colours, its voice); still vary concept and composition.
Aesthetic territories to draw from (pick what fits, combine, or invent): editorial magazine, Swiss grid, neo-brutalist poster, luxury minimal, soft pastel / organic, playful toy-like stickers, retro-futuristic chrome, Y2K, art deco geometric, Japanese minimal, bold sports campaign, product-on-stage studio lighting, collage / scrapbook, monochrome high-contrast, warm craft / handmade.
Return ONLY JSON:
{"directions":[{"name":"short name in the copy language","why":"one sentence: why this direction for this goal","aesthetic":"2–5 words","concept":"3–5 sentences of art direction: the unforgettable idea, hero composition, mood, type treatment, decorative motifs, how photos are used","palette":{"bg":"#hex email background","surface":"#hex cards/sections","ink":"#hex main text","muted":"#hex secondary text","primary":"#hex brand/CTA colour","accent":"#hex second colour","onPrimary":"#hex text on primary","line":"#hex hairlines"},"headingFont":"from list","bodyFont":"from list","vibe":"clean|playful|bold|luxury|editorial","layout":["Section 1 — what it is and how it looks", "… 6–9 entries"],"motifs":"decoration + icons/stickers + motion plan","images":[{"id":"image id","use":"where/how"}],"fields":{"campaignName":"short","subject":"30–55 chars, concrete benefit","preheader":"40–90 chars, continues the subject"}}]}`;

/** Three distinct directions, planned together (so they differ for real). */
export async function planDirections(inp: GenInput, c: Ctx, images: AiImage[], signal?: AbortSignal): Promise<Direction[]> {
  const text = await askClaude({
    system: `${PLAN}\n\nAllowed fonts: ${c.fonts}.\nPalette presets you may adapt: ${c.presets}.`,
    turns: [{ role: 'user', text: `${c.brief}\n\nIMAGES (ids; attached in order):\n${c.imageLines.join('\n') || '(none — design with type, colour, shapes and icons)'}`, images }],
    maxTokens: 9000, effort: 'medium',
  });
  if (signal?.aborted) throw new Error('Đã huỷ.');
  const j = extractJson<{ directions?: Direction[] }>(text);
  const dirs = (j.directions || []).filter((d) => d && d.name && d.palette).slice(0, 3);
  if (!dirs.length) throw new Error('AI không lên được hướng thiết kế nào. Thử mô tả rõ hơn.');
  const hex = (v: unknown, d: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toUpperCase() : d);
  const okFont = (f: unknown, d: string) => { const hit = FONTS.find((x) => x.family.toLowerCase() === String(f || '').toLowerCase() && (c.lang !== 'vi' || x.vi)); return hit ? hit.family : d; };
  return dirs.map((d) => ({
    ...d,
    palette: { bg: hex(d.palette?.bg, '#FFFFFF'), surface: hex(d.palette?.surface, '#F4F4F2'), ink: hex(d.palette?.ink, '#111111'), muted: hex(d.palette?.muted, '#666666'), primary: hex(d.palette?.primary, '#111111'), accent: hex(d.palette?.accent, '#FF5C39'), onPrimary: hex(d.palette?.onPrimary, '#FFFFFF'), line: hex(d.palette?.line, '#E5E5E5') },
    headingFont: okFont(d.headingFont, 'Be Vietnam Pro'), bodyFont: okFont(d.bodyFont, 'Be Vietnam Pro'),
    vibe: VIBES.some((v) => v.v === d.vibe) ? d.vibe : 'clean',
    layout: Array.isArray(d.layout) ? d.layout.map(String) : [],
    images: Array.isArray(d.images) ? d.images.filter((x) => x && c.validIds.has(String(x.id))).map((x) => ({ id: String(x.id), use: String(x.use || '') })) : [],
    fields: { campaignName: String(d.fields?.campaignName || d.name), subject: String(d.fields?.subject || ''), preheader: String(d.fields?.preheader || '') },
  }));
}

function dirText(d: Direction): string {
  return `ART DIRECTION "${d.name}" — ${d.aesthetic}\n${d.concept}\nPalette: ${JSON.stringify(d.palette)}\nFonts: heading "${d.headingFont}", body "${d.bodyFont}"\nLayout plan:\n${d.layout.map((l, i) => `${i + 1}. ${l}`).join('\n')}\nMotifs & motion: ${d.motifs}\nImages: ${d.images.map((x) => `"${x.id}" → ${x.use}`).join('; ') || 'as you see fit'}\nSubject: ${d.fields.subject} · Preheader: ${d.fields.preheader}`;
}

function picks(c: Ctx, d: Direction, max = 8): AiImage[] {
  const ids = [...new Set([...d.images.map((x) => x.id), ...[...c.thumbs.keys()]])].slice(0, max);
  return ids.map((id) => c.thumbs.get(id)).filter((x): x is AiImage => !!x);
}

/** The designer writes the HTML, streaming (onHtml gets the partial document for a live preview). */
export async function drawDirection(c: Ctx, d: Direction, onHtml: (html: string) => void, signal?: AbortSignal): Promise<string> {
  const imgs = picks(c, d);
  const text = await streamClaude({
    system: `${DESIGN_CRAFT}\n\n${DESIGN_TECH}\n\nAllowed fonts (font-family values, exact spelling): ${c.fonts}.`,
    turns: [{ role: 'user', text: `${c.brief}\n\n${dirText(d)}\n\nIMAGE LIST (data-img ids; the attached images are the first ${imgs.length} of the direction's picks, in order):\n${c.imageLines.join('\n') || '(no images: build the visuals with type, colour, SVG shapes, icons and stickers)'}\n\nDesign and code this email now.`, images: imgs }],
    maxTokens: 28000, effort: 'medium',
  }, (t) => onHtml(extractHtml(t)), signal);
  const html = extractHtml(text);
  if (!/<(div|section|table)[\s>]/i.test(html)) throw new Error('AI không trả về HTML.');
  return html;
}

/** Screenshots of the converted render, cut into tall-but-legible pieces. */
function shots(doc: Doc, brand: Brand): AiImage[] {
  const c = renderToCanvas(doc, brand, assets, 1);
  const out: AiImage[] = []; const step = 1100;
  for (let y = 0; y < c.height && out.length < 4; y += step) {
    const h = Math.min(step, c.height - y);
    const p = document.createElement('canvas'); p.width = c.width; p.height = h;
    p.getContext('2d')!.drawImage(c, 0, -y);
    out.push({ name: `render-${out.length + 1}.jpg`, mime: 'image/jpeg', base64: p.toDataURL('image/jpeg', 0.84).split(',')[1] });
  }
  return out;
}

/** The creative director looks at the render and returns an improved HTML. */
export async function reviewDirection(c: Ctx, d: Direction, html: string, doc: Doc, brand: Brand, notes: string[], onHtml: (html: string) => void, signal?: AbortSignal): Promise<string> {
  const imgs = shots(doc, brand);
  const text = await streamClaude({
    system: `${CRITIC}\n\n${DESIGN_CRAFT}\n\n${DESIGN_TECH}\n\nAllowed fonts: ${c.fonts}.`,
    turns: [{ role: 'user', text: `${c.brief}\n\n${dirText(d)}\n\nIMAGE LIST:\n${c.imageLines.join('\n') || '(none)'}\n\n${notes.length ? `CONVERTER NOTES:\n- ${notes.join('\n- ')}\n\n` : ''}The attached ${imgs.length} screenshot(s) are the Phloem render, top to bottom (600px wide).\n\nCURRENT HTML:\n\`\`\`html\n${html}\n\`\`\``, images: imgs }],
    maxTokens: 28000, effort: 'medium',
  }, (t) => onHtml(extractHtml(t)), signal);
  const out = extractHtml(text);
  return /<(div|section|table)[\s>]/i.test(out) ? out : html;
}

/** Brand record for a direction (so the rest of Phloem — Thương hiệu, auto-fix, new blocks — speaks the same language). */
export function designBrand(d: Direction, base: Brand): Brand {
  const p = d.palette;
  return { ...base, primary: p.primary, accent: p.accent, onPrimary: p.onPrimary, ink: p.ink, muted: p.muted, bg: p.bg, soft: p.surface, line: p.line, fontFamily: d.bodyFont, headingFamily: d.headingFont, vibe: d.vibe, gradient: null };
}

/** HTML → desktop doc (+ mobile at 375 when the CSS is responsive), colours tied to brand tokens. */
export async function convertDesign(html: string, d: Direction, base: Brand, validIds: Set<string>, onStage?: (m: string) => void): Promise<{ doc: Doc; mobile: Doc | null; brand: Brand; warnings: string[] }> {
  ensureFonts([d.headingFont, d.bodyFont]);
  const r = await htmlToDoc(html, { width: 600, validIds, onStage });
  const pal = { primary: d.palette.primary, accent: d.palette.accent, ink: d.palette.ink, muted: d.palette.muted, bg: d.palette.bg, soft: d.palette.surface, line: d.palette.line, onPrimary: d.palette.onPrimary };
  const doc = tokenize(r.doc, pal);
  let mobile: Doc | null = null;
  try {
    const m = await htmlToDoc(html, { width: 375, validIds });
    if (m.overflow <= 6) mobile = tokenize(m.doc, pal);
  } catch { /* desktop only */ }
  const warnings = [...r.warnings];
  if (r.overflow > 6) warnings.push(`Có phần tràn ra ngoài 600px (${r.overflow}px).`);
  return { doc, mobile, brand: designBrand(d, base), warnings };
}

export function thumbOfDoc(doc: Doc, brand: Brand, width = 480, ratio = 2.2): string {
  const s = width / doc.width;
  const c = renderToCanvas({ ...doc, height: Math.min(doc.height, doc.width * ratio) }, brand, assets, s);
  return c.toDataURL('image/jpeg', 0.86);
}

/** Whole flow: plan 3 → draw each (live) → convert → creative-director review → convert. Updates arrive per variant. */
export async function designEmail(inp: GenInput, base: Brand, cb: { onPlan: (v: DesignVariant[]) => void; onUpdate: (i: number, patch: Partial<DesignVariant>) => void; onStage: (m: string) => void }, opts: { review: boolean; signal?: AbortSignal }): Promise<void> {
  cb.onStage('Đang xem ảnh và nội dung…');
  const { ctx, images } = await buildCtx(inp);
  cb.onStage('Creative director đang lên 3 hướng thiết kế…');
  const dirs = await planDirections(inp, ctx, images, opts.signal);
  ensureFonts(dirs.flatMap((d) => [d.headingFont, d.bodyFont]));
  cb.onPlan(dirs.map((dir) => ({ dir, html: '', stage: 'queued' })));
  cb.onStage('Đang vẽ 3 phương án cùng lúc…');
  await Promise.all(dirs.map(async (dir, i) => {
    try {
      cb.onUpdate(i, { stage: 'drawing' });
      let last = 0;
      let html = await drawDirection(ctx, dir, (h) => { const now = Date.now(); if (now - last > 900) { last = now; cb.onUpdate(i, { html: h }); } }, opts.signal);
      cb.onUpdate(i, { html, stage: 'converting' });
      let conv = await convertDesign(html, dir, base, ctx.validIds);
      cb.onUpdate(i, { doc: conv.doc, mobile: conv.mobile, brand: conv.brand, warnings: conv.warnings, thumb: thumbOfDoc(conv.doc, conv.brand), stage: opts.review ? 'reviewing' : 'ready' });
      if (!opts.review) return;
      try {
        const better = await reviewDirection(ctx, dir, html, conv.doc, conv.brand, conv.warnings, (h) => { const now = Date.now(); if (now - last > 900) { last = now; cb.onUpdate(i, { html: h }); } }, opts.signal);
        if (better !== html) {
          const c2 = await convertDesign(better, dir, base, ctx.validIds);
          html = better; conv = c2;
        }
      } catch (e) { if (opts.signal?.aborted) throw e; /* keep the first version */ }
      cb.onUpdate(i, { html, doc: conv.doc, mobile: conv.mobile, brand: conv.brand, warnings: conv.warnings, thumb: thumbOfDoc(conv.doc, conv.brand), stage: 'ready', reviewed: true });
    } catch (e) {
      cb.onUpdate(i, { stage: 'error', error: (e as Error).message });
    }
  }));
}

/** "AI tự chỉnh" on an untouched free-form design: the creative director reviews the current render and redraws it. */
export async function reviseDesign(p: Project, onStage: (m: string) => void): Promise<{ html: string; doc: Doc; mobile: Doc | null; brand: Brand; warnings: string[] } | null> {
  const dz = p.design; if (!dz || !dz.dir) return null;
  const d = dz.dir as Direction;
  const ids = [...new Set([...dz.html.matchAll(/data-img="([^"]+)"/g)].map((m) => m[1]).filter((id) => assets.get(id)))];
  const inp: GenInput = { goal: 'other', brandName: p.brand.name, brief: `Subject: ${p.fields.subject}\nPreheader: ${p.fields.preheader}`, content: '', tone: '', imageIds: ids, palette: 'auto', language: /[ăâđêôơư]/i.test(`${p.fields.subject} ${p.fields.preheader}`) ? 'vi' : 'en' };
  onStage('Creative director đang xem bản render…');
  const { ctx } = await buildCtx(inp);
  const html = await reviewDirection(ctx, d, dz.html, p.desktop, p.brand, [], () => onStage('Creative director đang vẽ lại…'));
  if (html === dz.html) return null;
  onStage('Đang tách layer…');
  const conv = await convertDesign(html, d, p.brand, ctx.validIds);
  const used = [...new Set([...flatNodes(conv.doc.nodes), ...(conv.mobile ? flatNodes(conv.mobile.nodes) : [])].filter((n) => n.type === 'image' && n.assetId).map((n) => (n as { assetId: string }).assetId))];
  await assets.persist(used, p.id);
  return { html, ...conv };
}
const flatNodes = (list: Doc['nodes']): Doc['nodes'] => list.flatMap((n) => (n.type === 'group' ? [n, ...flatNodes(n.children)] : [n]));

/** Stable fingerprint of a doc's layers (did the user edit the converted design?). */
export function docHash(doc: Doc): string {
  const s = JSON.stringify(doc.nodes); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${s.length}:${h.toString(36)}`;
}

export { buildCtx };
