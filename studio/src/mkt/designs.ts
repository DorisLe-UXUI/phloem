// Phloem Design: social / ads designs at fixed channel sizes, edited with the same layer editor as Phloem Email.
// A design is a Project with kind 'design' and a fixed-size desktop doc (no mobile, no email export).
// Layouts come from HTML → layers (htmlToDoc): a deterministic starter, or Claude art-directing the post.
import type { Brand, Doc, Node, Project } from '../model/types';
import { DEFAULT_BRAND, FONTS, uid } from '../model/types';
import { htmlToDoc, extractHtml, tokenize } from '../ai/htmlToDoc';
import { DESIGN_TECH, readyDoc } from '../ai/design';
import { askClaude, streamClaude, relayAuth, wakeRelay, type AiImage } from '../ai/client';
import { renderToCanvas } from '../render/renderer';
import { ensureFonts } from '../render/fonts';
import { assets } from '../storage/assets';
import { get, set, toast } from '../store';
import { history } from '../store';
import * as A from '../pipeline/actions';
import { brandBookOf, clientEmailBrand, styleNotesOf } from './kit';
import { audienceLine, channelOf, type Client, type PlanRow } from './types';

export interface DesignSize { id: string; label: string; w: number; h: number; group: string }
export const SIZES: DesignSize[] = [
  { id: 'square', label: 'Vuông 1:1', w: 1080, h: 1080, group: 'Facebook · Instagram' },
  { id: 'portrait', label: 'Dọc 4:5', w: 1080, h: 1350, group: 'Facebook · Instagram' },
  { id: 'story', label: 'Story / Reel 9:16', w: 1080, h: 1920, group: 'Instagram · TikTok · Facebook' },
  { id: 'land43', label: 'Ngang 4:3', w: 1440, h: 1080, group: 'Facebook · Instagram' },
  { id: 'land169', label: 'Ngang 16:9', w: 1920, h: 1080, group: 'Facebook · YouTube' },
  { id: 'fb-link', label: 'Ảnh link / quảng cáo 1.91:1', w: 1200, h: 628, group: 'Facebook · LinkedIn' },
  { id: 'yt-thumb', label: 'Thumbnail YouTube 16:9', w: 1280, h: 720, group: 'YouTube' },
  { id: 'li-cover', label: 'Ảnh bìa LinkedIn', w: 1584, h: 396, group: 'LinkedIn' },
  { id: 'fb-cover', label: 'Ảnh bìa Facebook', w: 1640, h: 624, group: 'Facebook' },
  { id: 'gbp', label: 'Google Business 4:3', w: 1200, h: 900, group: 'Google' },
  { id: 'display', label: 'Banner Display 300×250', w: 300, h: 250, group: 'Google Display' },
];
export const sizeById = (id: string) => SIZES.find((s) => s.id === id) || SIZES[0];

/** A frame with the picture's own proportions (short side 1080, long side at most 1920), named after the closest standard size. */
export function sizeForImage(w: number, h: number): DesignSize {
  const r = w / h;
  const near = SIZES.find((z) => Math.abs(z.w / z.h - r) / r < 0.02);
  if (near) return near;
  const W = r >= 1 ? Math.min(1920, Math.round(1080 * r)) : 1080, H = r >= 1 ? Math.round(W / r) : Math.min(1920, Math.round(1080 / r));
  return { id: 'image', label: `Theo ảnh ${W}×${H}`, w: W, h: H, group: 'Theo ảnh' };
}

/** The frame size the agency picked for a client on the Thiết kế page ('auto' = by channel and format). */
export const preferredSizeKey = (clientId: string) => `phloem.mkt.size.${clientId}`;
export function preferredSize(clientId: string, row: Pick<PlanRow, 'channel' | 'format'> | null): DesignSize {
  let id = 'auto'; try { id = localStorage.getItem(preferredSizeKey(clientId)) || 'auto'; } catch { /* private mode */ }
  return id !== 'auto' && SIZES.some((z) => z.id === id) ? sizeById(id) : row ? sizeForRow(row) : sizeById('portrait');
}

/** The natural size for a plan row: reels/stories vertical, LinkedIn and YouTube landscape, feed posts 4:5. */
export function sizeForRow(r: Pick<PlanRow, 'channel' | 'format'>): DesignSize {
  if (r.format === 'reel' || r.format === 'story' || r.channel === 'tiktok') return sizeById('story');
  if (r.channel === 'youtube') return sizeById('yt-thumb');
  if (r.channel === 'linkedin' || r.channel === 'google_display' || r.format === 'article') return sizeById('fb-link');
  if (r.channel === 'google_business') return sizeById('gbp');
  return sizeById('portrait');
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** The client's brand for designs: brand kit colours/fonts on top of Phloem defaults. */
export function designBrand(client: Client): Brand {
  const b = { ...DEFAULT_BRAND, name: client.name, ...clientEmailBrand(client.id) } as Brand;
  const book = brandBookOf(client.id);
  if (book) { b.headingFamily = FONTS.some((f) => f.family === book.fonts.heading) ? book.fonts.heading : b.headingFamily; b.fontFamily = FONTS.some((f) => f.family === book.fonts.body) ? book.fonts.body : b.fontFamily; }
  return b;
}

/** Images in this client's library, newest first. */
export function clientImages(clientId: string) { return assets.all().filter((a) => a.client === clientId && a.src?.kind !== 'graphic'); }

/** A clean starter layout as HTML (headline, sub, CTA, logo, photo when there is one): every part an editable layer. */
function starterHtml(size: DesignSize, brand: Brand, row: Partial<PlanRow> | null, photoId: string | null, logoId: string | null): string {
  const W = size.w, H = size.h, k = Math.min(W, H) / 1080, wide = W / H > 1.4;
  const head = esc(row?.hook || row?.topic || 'Tiêu đề bài đăng');
  const sub = esc(row?.topic && row?.hook ? row.topic : 'Một dòng mô tả ngắn, cụ thể, nói điều người xem nhận được.');
  const cta = esc(row?.cta || 'Tìm hiểu thêm');
  const pad = Math.round(72 * k);
  const photo = photoId ? `<img data-img="${photoId}" alt="" style="position:absolute;${wide ? `right:0;top:0;width:${Math.round(W * 0.48)}px;height:${H}px` : `left:0;top:0;width:${W}px;height:${Math.round(H * 0.58)}px`};object-fit:cover">` : `<div style="position:absolute;right:${-Math.round(W * 0.18)}px;top:${-Math.round(H * 0.12)}px;width:${Math.round(Math.max(W, H) * 0.7)}px;height:${Math.round(Math.max(W, H) * 0.7)}px;border-radius:50%;background:radial-gradient(circle, ${brand.accent} 0%, transparent 65%);opacity:.55"></div>`;
  const textBox = wide ? `left:${pad}px;top:${pad}px;width:${Math.round(W * 0.44)}px;bottom:${pad}px` : photoId ? `left:${pad}px;right:${pad}px;bottom:${pad}px` : `left:${pad}px;right:${pad}px;top:${Math.round(H * 0.3)}px`;
  return `<!doctype html><html><head><style>
  body{margin:0} #email{position:relative;width:${W}px;height:${H}px;overflow:hidden;background:${brand.primary};font-family:'${brand.fontFamily}'}
  .t{position:absolute;${textBox};display:flex;flex-direction:column;gap:${Math.round(24 * k)}px;${wide ? 'justify-content:center' : ''}}
  h1{margin:0;font-family:'${brand.headingFamily}';font-weight:800;font-size:${Math.round((wide ? 64 : 84) * k)}px;line-height:1.05;color:${brand.onPrimary}}
  p{margin:0;font-size:${Math.round(32 * k)}px;line-height:1.35;color:${brand.onPrimary};opacity:.85}
  .cta{align-self:flex-start;padding:${Math.round(22 * k)}px ${Math.round(40 * k)}px;border-radius:999px;background:${brand.accent};color:${brand.ink};font-weight:700;font-size:${Math.round(30 * k)}px}
  </style></head><body><div id="email" data-email><section data-name="Bài đăng" style="position:relative;width:${W}px;height:${H}px">
  ${photo}
  ${photoId && !wide ? `<div style="position:absolute;left:0;top:${Math.round(H * 0.42)}px;width:${W}px;height:${Math.round(H * 0.16)}px;background:linear-gradient(180deg, transparent, ${brand.primary})"></div>` : ''}
  ${logoId ? `<img data-img="${logoId}" alt="Logo" style="position:absolute;left:${pad}px;top:${pad}px;height:${Math.round(64 * k)}px;width:${Math.round(180 * k)}px;object-fit:contain;object-position:left center">` : ''}
  <div class="t"><h1>${head}</h1><p>${sub}</p><span class="cta">${cta}</span></div>
  </section></div></body></html>`;
}

async function toDoc(html: string, size: DesignSize, brand: Brand, validIds: Set<string>, onStage?: (m: string) => void): Promise<Doc> {
  ensureFonts([brand.fontFamily, brand.headingFamily]);
  const r = await htmlToDoc(html, { width: size.w, validIds, onStage, temp: false });
  const doc = tokenize(r.doc, { primary: brand.primary, accent: brand.accent, ink: brand.ink, muted: brand.muted, bg: brand.bg, soft: brand.soft, line: brand.line, onPrimary: brand.onPrimary });
  // one section wrapping everything → its children become top-level layers (select and move each one directly)
  const flat = doc.nodes.length === 1 && doc.nodes[0].type === 'group' ? doc.nodes[0].children : doc.nodes;
  // emoji typed into text cannot be drawn by the web fonts (they render as boxes): drop them, stickers carry that job
  const noEmoji = (list: Node[]): Node[] => list.map((n) => (n.type === 'text' ? { ...n, text: n.text.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][\u{FE0F}\u{200D}\p{Extended_Pictographic}]*/gu, '').replace(/[ \t]+$/gm, '') } : n.type === 'group' ? { ...n, children: noEmoji(n.children) } : n));
  const nodes = noEmoji(flat);
  return { ...doc, nodes, width: size.w, height: size.h, autoHeight: false };
}

/** Create a design for a client (optionally from a plan row) and open it in the editor. */
export async function newDesign(client: Client, size: DesignSize, row?: (PlanRow & { planId: string }) | null, opts: { ai?: boolean; open?: boolean; onStage?: (m: string) => void; signal?: AbortSignal; askPhotos?: AskPhotos; attach?: boolean; slide?: SlideCtx } = {}) {
  const brand = designBrand(client);
  const imgs = clientImages(client.id);
  const logo = (brand.logoAssetId && assets.get(brand.logoAssetId)) ? brand.logoAssetId : null;
  const photo = imgs.find((a) => a.id !== logo && a.src?.kind !== 'logo')?.id || null;
  const valid = new Set(imgs.map((a) => a.id).concat(logo ? [logo] : []));
  let doc: Doc;
  if (opts.ai) doc = await aiDesign(client, brand, size, row || null, valid, opts.onStage, opts.signal, opts.askPhotos, opts.slide);
  else doc = await toDoc(starterHtml(size, brand, row || null, photo, logo), size, brand, valid, opts.onStage);
  await readyDoc(doc);
  const now = new Date().toISOString();
  const name = row ? `${row.date.slice(8, 10)}/${row.date.slice(5, 7)} · ${channelOf(row.channel).label} · ${row.topic}`.slice(0, 90) : `${size.label} · ${new Date().toLocaleDateString('vi-VN')}`;
  const p: Project = { id: uid('p'), name, createdAt: now, updatedAt: now, brand, fields: { campaignName: name, subject: '', preheader: '' }, desktop: doc, mobile: null, drafts: {}, clientId: client.id, kind: 'design', size: { id: size.id, label: size.label, w: size.w, h: size.h }, ...(row ? { rowRef: { planId: row.planId, rowId: row.id } } : {}) };
  if (opts.open === false) {
    // batch mode: save next to the others without leaving the page
    const { db } = await import('../storage/idb');
    const { cloud } = await import('../storage/sync');
    const { thumbnail } = await import('../render/renderer');
    await document.fonts.ready;
    let thumb: string | undefined; try { thumb = thumbnail(doc, brand, assets, 360, size.h / size.w); } catch { /* fonts not ready */ }
    const stored = { ...p, thumb, owner: get().user?.id || '' };
    await db.putProject(stored); cloud.pushProjectSoon(stored);
    await A.refreshProjects();
  } else {
    history.clear();
    assets.context.client = client.id;
    set({ route: { name: 'editor', projectId: p.id }, project: p, variant: 'desktop', selection: [], zoom: 1, pan: { x: 0, y: 0 }, modal: null, dirty: true, result: null, log: [], scraps: [], scrapSel: null, cropping: null, cutting: null, enteredGroup: null, editingText: null, leftTab: 'design', rightTab: 'design' });
    await A.saveProject();
  }
  if (row && opts.attach !== false) await attachDesign(client.id, row.planId, row.id, p.id);
  return p;
}

const CAROUSEL_PLAN = `You plan a social media carousel (swipeable slides) for a post. Decide the number of slides from the content: between 3 and 10; when the caption or visual idea lists items or says a count ("5 slides", "7 ảnh", "1. … 2. …"), follow it (cover + one slide per item + a closing CTA slide).
Slide 1 is the cover (the hook). The last slide is the CTA. Every slide's text is short and in the post's language.
Reply with JSON only: {"slides":[{"role":"cover|content|cta","headline":"…","body":"one or two short lines","visual":"what to show"}]}`;

/** A carousel post designed slide by slide: the AI plans the slides, the cover paints the key visual, the other slides reuse it
 *  so the set reads as one; all slides are pinned to the post in order. Returns the slide design ids. */
export async function newCarousel(client: Client, size: DesignSize, row: PlanRow & { planId: string }, opts: { onStage?: (m: string) => void; signal?: AbortSignal; askPhotos?: AskPhotos } = {}): Promise<string[]> {
  opts.onStage?.('AI đang lên dàn ý các slide carousel…');
  let slides: { role: string; headline: string; body: string; visual: string }[] = [];
  try {
    const out = await askClaude({ system: CAROUSEL_PLAN, turns: [{ role: 'user', text: `${audienceLine(client)}\nBrand: ${client.name}.\nTopic: ${row.topic}\nHook: ${row.hook}\nCaption: ${row.caption}\nCTA: ${row.cta}\nVisual idea: ${row.visual}` }], maxTokens: 3000, effort: 'low' });
    const j = JSON.parse((/\{[\s\S]*\}/.exec(out) || ['{}'])[0]);
    slides = (Array.isArray(j.slides) ? j.slides : []).slice(0, 10).map((x: any) => ({ role: String(x?.role || 'content'), headline: String(x?.headline || '').slice(0, 140), body: String(x?.body || '').slice(0, 280), visual: String(x?.visual || '').slice(0, 300) })).filter((x: { headline: string }) => x.headline);
  } catch (e) { if (opts.signal?.aborted) throw e; }
  if (slides.length < 2) slides = [{ role: 'cover', headline: row.hook || row.topic, body: '', visual: row.visual }, { role: 'content', headline: row.topic, body: (row.caption || '').slice(0, 120), visual: row.visual }, { role: 'cta', headline: row.cta || client.name, body: '', visual: '' }];
  const n = slides.length;
  let hero: string | null = null;
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    if (opts.signal?.aborted) throw new Error('Đã huỷ.');
    const s = slides[i];
    const slideRow = { ...row, topic: s.headline, hook: s.body, visual: [s.visual, row.visual].filter(Boolean).join(' · ') };
    const p = await newDesign(client, size, slideRow, {
      ai: true, open: false, attach: false, signal: opts.signal, askPhotos: i === 0 ? opts.askPhotos : undefined,
      onStage: (m) => opts.onStage?.(`Slide ${i + 1}/${n} · ${m}`),
      slide: { i: i + 1, n, role: i === 0 ? 'cover' : i === n - 1 ? 'cta' : s.role, hero: i === 0 ? null : hero, onHero: (id) => { hero = id; } },
    });
    ids.push(p.id);
  }
  await attachMany(client.id, row.planId, { [row.id]: ids }, `Carousel ${n} slide`);
  await A.refreshProjects();
  return ids;
}

/** The client's published posts in the library (imported from Drive / Figma / web), spread over time, for style references. */
export function pastPosts(clientId: string, n = 3): string[] {
  const list = clientImages(clientId).filter((a) => a.src?.kind === 'reference' && Math.min(a.w, a.h) >= 300).sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  if (list.length <= n) return list.map((a) => a.id);
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)].id);
}

const FULL_POST = `You art-direct a COMPLETE social media post that an image model (Gemini image) paints in one go, ALL TEXT INCLUDED. You get the brand, the post copy and the brand's real published posts (attached pictures).
Write ONE English prompt of 150–260 words:
1. Layout and style copied from the attached past posts: where the logo, headline, picture, support line and CTA pill sit; their illustration or photo style, palette, type treatment (weight, colour, outline, highlight), decorative motifs. The new post must look like the next post of that feed.
2. The scene for THIS post's topic, in that same style.
3. Every text element verbatim in double quotes with its role and rough size: brand wordmark, headline (at most 8 words), one support line (at most 14 words), CTA pill text, website or handle when known. Text in the post's language, spelled exactly as given.
End with: "Render every text crisp, spelled exactly as quoted, high contrast, inside the frame; no other text, no watermark."
Reply with JSON only: {"prompt":"…"}`;

/** Paint the whole post as one finished picture with all its text, in the style of the client's past posts, and pin it to the post.
 *  A carousel gets one painted picture per planned slide. Returns the design ids. */
export async function paintFullPost(client: Client, size: DesignSize, row: PlanRow & { planId: string }, opts: { onStage?: (m: string) => void; signal?: AbortSignal; open?: boolean } = {}): Promise<string[]> {
  if (!(await imageProvider())) throw new Error('Relay chưa có key tạo ảnh (GEMINI_API_KEY hoặc CF_AI_TOKEN).');
  const refs = pastPosts(client.id, 3);
  const logo = designBrand(client).logoAssetId;
  const refImgs = (await Promise.all(refs.map((id) => thumbB64(id, 768)))).filter(Boolean) as AiImage[];
  const book = brandBookOf(client.id);
  const site = (client.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  let slides: { headline: string; body: string; visual: string; role: string }[] = [{ headline: row.hook || row.topic, body: '', visual: row.visual, role: 'single' }];
  if (row.format === 'carousel') {
    opts.onStage?.('AI đang lên dàn ý các slide…');
    try {
      const out = await askClaude({ system: CAROUSEL_PLAN, turns: [{ role: 'user', text: `${audienceLine(client)}\nBrand: ${client.name}.\nTopic: ${row.topic}\nHook: ${row.hook}\nCaption: ${row.caption}\nCTA: ${row.cta}\nVisual idea: ${row.visual}` }], maxTokens: 3000, effort: 'low' });
      const j = JSON.parse((/\{[\s\S]*\}/.exec(out) || ['{}'])[0]);
      const sl = (Array.isArray(j.slides) ? j.slides : []).slice(0, 10).map((x: any) => ({ role: String(x?.role || 'content'), headline: String(x?.headline || ''), body: String(x?.body || ''), visual: String(x?.visual || '') })).filter((x: { headline: string }) => x.headline);
      if (sl.length >= 2) slides = sl;
    } catch (e) { if (opts.signal?.aborted) throw e; }
  }
  const aspect = aspectFor(size);
  const ids: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    if (opts.signal?.aborted) throw new Error('Đã huỷ.');
    const sl = slides[i]; const tag = slides.length > 1 ? `Slide ${i + 1}/${slides.length} · ` : '';
    opts.onStage?.(`${tag}Art director đang xem ${refImgs.length} bài cũ của khách và viết prompt…`);
    const brief = [
      `Brand: ${client.name}${client.industry ? ` (${client.industry})` : ''}. ${audienceLine(client)}`,
      book ? `Brand colours: ${book.palette.map((c) => `${c.name} ${c.hex}`).join(', ')}. Fonts: ${book.fonts.heading} / ${book.fonts.body}. Tagline: "${book.tagline}".` : '',
      styleNotesOf(client.id) ? `House style notes: ${styleNotesOf(client.id)}` : '',
      `Post: ${channelOf(row.channel).label} ${row.format}, aspect ${aspect}. Topic: ${row.topic}.`,
      slides.length > 1 ? `CAROUSEL slide ${i + 1} of ${slides.length} (${sl.role}); show a small "${i + 1}/${slides.length}" marker; keep one look across slides.` : '',
      `Headline: "${sl.headline}". Support line: "${sl.body || (row.caption || '').split(/\n/)[0].slice(0, 90)}". CTA: "${row.cta}". Website/handle: "${site}".`,
      `Visual idea: ${sl.visual || row.visual}`,
      refImgs.length ? `The ${refImgs.length} attached pictures are the brand's published posts (style references).` : 'No past posts yet: design a striking post in the brand colours.',
    ].filter(Boolean).join('\n');
    let prompt = '';
    try {
      const out = await askClaude({ system: FULL_POST, turns: [{ role: 'user', text: brief, images: refImgs }], maxTokens: 2000, effort: 'low' });
      prompt = String(JSON.parse((/\{[\s\S]*\}/.exec(out) || ['{}'])[0]).prompt || '').trim();
    } catch (e) { if (opts.signal?.aborted) throw e; }
    if (prompt.length < 80) prompt = `A finished ${channelOf(row.channel).label} post for ${client.name} in the exact style of the reference posts. Headline "${sl.headline}". CTA pill "${row.cta}". ${site ? `Website "${site}". ` : ''}Render every text crisp and spelled exactly; no other text.`;
    opts.onStage?.(`${tag}AI đang vẽ cả bài, có chữ (20–60 giây)…`);
    const asset = await generateImage(client.id, prompt, aspect, [...refs, ...(logo && assets.get(logo) ? [logo] : [])].slice(0, 4));
    const p = await designFromImage(client, row, asset, false, { attach: false, refresh: false, size: 'image' });
    ids.push(p.id);
  }
  await attachMany(client.id, row.planId, { [row.id]: ids }, slides.length > 1 ? `AI vẽ cả bài · carousel ${slides.length} slide` : 'AI vẽ cả bài');
  await A.refreshProjects();
  if (opts.open && ids[0]) await A.openProject(ids[0]);
  return ids;
}

/** Design one post: a carousel gets all its slides, anything else one design. */
export async function designPost(client: Client, size: DesignSize, row: (PlanRow & { planId: string }) | null, opts: { ai?: boolean; open?: boolean; onStage?: (m: string) => void; signal?: AbortSignal; askPhotos?: AskPhotos } = {}) {
  if (row && opts.ai && row.format === 'carousel') { const ids = await newCarousel(client, size, row, opts); if (opts.open !== false && ids[0]) await A.openProject(ids[0]); return ids; }
  const p = await newDesign(client, size, row, opts);
  return [p.id];
}

/** A post that uses the client's own picture: the photo fills the frame (cover), saved as a design and pinned to the post. */
export async function designFromImage(client: Client, row: (PlanRow & { planId: string }) | null, assetId: string, open = false, opts: { attach?: boolean; refresh?: boolean; size?: DesignSize | 'image' } = {}) {
  const a = assets.get(assetId); if (!a) throw new Error('Không tìm thấy ảnh.');
  // a finished post (imported, or painted whole) keeps its own proportions; a photo for a post fills the chosen frame
  const size = opts.size === 'image' || (!opts.size && a.src?.kind === 'reference') ? sizeForImage(a.w, a.h) : opts.size || (row ? preferredSize(client.id, row) : sizeForImage(a.w, a.h));
  const brand = designBrand(client);
  const doc: Doc = { width: size.w, height: size.h, bg: '#000000', autoHeight: false, nodes: [{ id: uid('n'), type: 'image', name: a.name, x: 0, y: 0, w: size.w, h: size.h, visible: true, locked: false, opacity: 1, link: null, alt: a.name, assetId, fit: 'cover', radius: 0, fill: null, overlay: null } as Node] };
  await readyDoc(doc);
  const now = new Date().toISOString();
  const name = row ? `${row.date.slice(8, 10)}/${row.date.slice(5, 7)} · ${channelOf(row.channel).label} · ${row.topic}`.slice(0, 90) : a.name;
  const p: Project = { id: uid('p'), name, createdAt: now, updatedAt: now, brand, fields: { campaignName: name, subject: '', preheader: '' }, desktop: doc, mobile: null, drafts: {}, clientId: client.id, kind: 'design', size: { id: size.id, label: size.label, w: size.w, h: size.h }, ...(row ? { rowRef: { planId: row.planId, rowId: row.id } } : {}) };
  const { db } = await import('../storage/idb');
  const { cloud } = await import('../storage/sync');
  const { thumbnail } = await import('../render/renderer');
  let thumb: string | undefined; try { thumb = thumbnail(doc, brand, assets, 360, size.h / size.w); } catch { /* not decoded yet */ }
  const stored = { ...p, thumb, owner: get().user?.id || '' };
  await db.putProject(stored); cloud.pushProjectSoon(stored);
  if (opts.refresh !== false) await A.refreshProjects();
  if (row && opts.attach !== false) await attachDesign(client.id, row.planId, row.id, p.id);
  if (open) await A.openProject(p.id);
  return p;
}

/** Designs made from one imported picture (a past post) whose frame does not match the picture: reframe them to the picture's
 *  own proportions so nothing is cropped. Returns how many were fixed. */
export async function refitImported(clientId: string): Promise<number> {
  const { db } = await import('../storage/idb');
  const { cloud } = await import('../storage/sync');
  const { thumbnail } = await import('../render/renderer');
  let n = 0;
  for (const m of get().projects.filter((p) => p.clientId === clientId && p.kind === 'design')) {
    const p = await db.getProject(m.id); if (!p) continue;
    const d = p.desktop; const img = d.nodes.length === 1 && d.nodes[0].type === 'image' ? d.nodes[0] : null;
    const a = img?.assetId ? assets.get(img.assetId) : null;
    if (!img || !a || a.src?.kind !== 'reference' || img.x !== 0 || img.y !== 0 || img.w !== d.width || img.h !== d.height) continue;
    if (Math.abs(a.w / a.h - d.width / d.height) / (a.w / a.h) < 0.02) continue;
    const z = sizeForImage(a.w, a.h);
    const doc: Doc = { ...d, width: z.w, height: z.h, nodes: [{ ...img, w: z.w, h: z.h, crop: null }] };
    await readyDoc(doc);
    let thumb: string | undefined; try { thumb = thumbnail(doc, p.brand, assets, 360, z.h / z.w); } catch { /* not decoded yet */ }
    const stored = { ...p, desktop: doc, size: { id: z.id, label: z.label, w: z.w, h: z.h }, updatedAt: new Date().toISOString(), ...(thumb ? { thumb } : {}) };
    await db.putProject(stored as typeof p); cloud.pushProjectSoon(stored as typeof p); n++;
  }
  if (n) await A.refreshProjects();
  return n;
}

/** Images from a paste or a drop, added to a client's library. Returns the new asset ids. */
export async function addClientImages(clientId: string, files: (File | Blob)[], kind: 'upload' | 'paste' | 'reference' = 'upload'): Promise<string[]> {
  const ids: string[] = [];
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    try { ids.push((await assets.add(f, (f as File).name || `${kind === 'paste' ? 'Ảnh dán' : 'Ảnh'} ${new Date().toLocaleString('vi-VN')}`, { src: { kind }, client: clientId, project: null })).id); } catch { /* unreadable image */ }
  }
  return ids;
}

/** Pin a design to its post in the plan (the post shows that picture everywhere: Thiết kế, Lịch đăng, the plan grid). */
export async function attachDesign(clientId: string, planId: string, rowId: string, designId: string) {
  await attachMany(clientId, planId, { [rowId]: [designId] }, 'Gắn thiết kế vào bài');
}
/** Pin designs to many posts in one plan write: rowId → design ids (several = carousel slides, in order). */
export async function attachMany(clientId: string, planId: string, map: Record<string, string[]>, note = 'Gắn thiết kế vào bài') {
  const { cachedItems, putItem } = await import('./data');
  const it = cachedItems(clientId)?.find((i) => i.kind === 'plan' && i.id === planId); if (!it) return;
  const plan = it.data as import('./types').Plan;
  const version = (plan.version || 1) + 1;
  const rows = plan.rows.map((r) => { const ids = map[r.id]; if (!ids?.length) return r; const { slides: _old, ...rest } = r; return ids.length > 1 ? { ...rest, designId: ids[0], slides: ids } : { ...rest, designId: ids[0] }; });
  await putItem(clientId, 'plan', planId, { ...plan, rows, version, versions: [...(plan.versions || []), { version, at: new Date().toISOString(), by: get().user?.name || 'Bạn', note }].slice(-40) });
}

// ---------- Đổi cỡ thần kỳ ----------
/** Re-lay a design onto another size: full-bleed layers stretch to the new frame, everything else keeps its proportions
 *  and its relative position (scaled by the smaller axis so text never overflows). Pure; groups move as one unit. */
export function resizeDoc(doc: Doc, W: number, H: number): Doc {
  const sx = W / doc.width, sy = H / doc.height;
  const scaleNode = (n: Node, f: (x: number, y: number) => { x: number; y: number }, k: number): Node => {
    const p = f(n.x, n.y);
    const base = { ...n, x: Math.round(p.x), y: Math.round(p.y), w: Math.max(1, Math.round(n.w * k)), h: Math.max(1, Math.round(n.h * k)) } as Node;
    if (base.type === 'text') return { ...base, fontSize: Math.max(6, Math.round(base.fontSize * k * 10) / 10), letterSpacing: base.letterSpacing * k };
    if (base.type === 'rect') return { ...base, radius: base.radius * k, ...(base.stroke ? { stroke: { ...base.stroke, width: base.stroke.width * k } } : {}), ...(base.blur ? { blur: base.blur * k } : {}) };
    if (base.type === 'image') return { ...base, radius: base.radius * k, ...(base.blur ? { blur: base.blur * k } : {}) };
    if (base.type === 'group') return { ...base, children: base.children.map((c) => scaleNode(c, f, k)) };
    return base;
  };
  // bands and photos that span the frame (edge to edge in either direction) stretch with it and stay on their edges
  const isFull = (n: Node) => n.type !== 'text' && (n.w >= doc.width * 0.9 || n.h >= doc.height * 0.9);
  const rest = doc.nodes.filter((n) => !isFull(n));
  // everything else (headline, copy, CTA, logo, stickers) moves as ONE cluster: same scale, alignment kept, as large as fits
  let k = Math.min(sx, sy), place = (x: number, y: number) => ({ x: x * sx, y: y * sy });
  if (rest.length) {
    const x0 = Math.min(...rest.map((n) => n.x)), y0 = Math.min(...rest.map((n) => n.y)), x1 = Math.max(...rest.map((n) => n.x + n.w)), y1 = Math.max(...rest.map((n) => n.y + n.h));
    const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    k = Math.max(0.2, Math.min(Math.max(sx, sy), (W * 0.88) / bw, (H * 0.88) / bh));
    const nw = bw * k, nh = bh * k;
    // keep the cluster's relative position (left/centre/right, top/middle/bottom), clamped inside the frame
    const ncx = Math.min(W - nw / 2 - W * 0.04, Math.max(nw / 2 + W * 0.04, cx * sx));
    const ncy = Math.min(H - nh / 2 - H * 0.04, Math.max(nh / 2 + H * 0.04, cy * sy));
    place = (x, y) => ({ x: ncx + (x - cx) * k, y: ncy + (y - cy) * k });
  }
  const nodes = doc.nodes.map((n) => (isFull(n) && n.type !== 'group'
    ? ({ ...n, x: Math.round(n.x * sx), y: Math.round(n.y * sy), w: Math.round(n.w * sx), h: Math.round(n.h * sy) } as Node)
    : scaleNode(n, place, k)));
  return { ...doc, width: W, height: H, autoHeight: false, nodes };
}

/** Copies of the open design at other sizes, saved next to it in the same client. */
export async function magicResize(ids: string[]) {
  const p = get().project; if (!p || p.kind !== 'design') return;
  if (get().dirty) await A.saveProject();
  const { db } = await import('../storage/idb');
  const { cloud } = await import('../storage/sync');
  let n = 0;
  for (const id of ids) {
    const sz = sizeById(id); if (sz.id === p.size?.id) continue;
    const now = new Date().toISOString();
    const copy = { ...p, id: uid('p'), name: `${p.name.replace(/ · [^·]+$/, '')} · ${sz.label}`.slice(0, 90), createdAt: now, updatedAt: now, desktop: resizeDoc(p.desktop, sz.w, sz.h), size: { id: sz.id, label: sz.label, w: sz.w, h: sz.h } };
    const { thumbnail } = await import('../render/renderer');
    await readyDoc(copy.desktop); await document.fonts.ready;
    let thumb: string | undefined; try { thumb = thumbnail(copy.desktop, copy.brand, assets, 360, sz.h / sz.w); } catch { /* fonts not ready */ }
    const stored = { ...copy, thumb, owner: get().user?.id || '' };
    await db.putProject(stored); cloud.pushProjectSoon(stored); n++;
  }
  await A.refreshProjects();
  toast(n ? `Đã tạo ${n} bản ở khổ khác, nằm trong tab Thiết kế của khách.` : 'Không có khổ mới nào.', 'ok');
}

// ---------- export ----------
export async function exportDesign(format: 'png' | 'jpg', scale = 1) {
  const p = get().project; if (!p) return;
  await readyDoc(p.desktop);
  await document.fonts.ready;
  const c = renderToCanvas(p.desktop, p.brand, assets, scale);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, format === 'png' ? 'image/png' : 'image/jpeg', 0.92));
  if (!blob) { toast('Không xuất được ảnh.', 'err'); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `${p.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase().slice(0, 60)}-${p.desktop.width}x${p.desktop.height}.${format}`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ---------- AI ----------
const TECH = DESIGN_TECH.slice(DESIGN_TECH.indexOf('CONVERTS (use freely):'), DESIGN_TECH.indexOf('- Links:')).trim();
const NEVER = DESIGN_TECH.slice(DESIGN_TECH.indexOf('NEVER'), DESIGN_TECH.indexOf('MOBILE:')).trim();
const SOCIAL = `You are the art director of a top Vietnamese creative studio. Design ONE social media / ads visual that stops the scroll: a finished poster, not a template. Bold hierarchy (one huge headline, at most one short supporting line, an optional CTA pill), deliberate composition with depth (overlapping planes, a photo or 3D object used boldly, a glow or pattern behind), generous margins, the brand's colours and fonts. Text must be legible on a phone at feed size: headline ≥ 7% of the frame height, nothing under 2.5%. Keep text short, in the client's public copy language (given in the brief), natural for that market. Never put text over a busy part of a photo without a scrim or a card. NO emoji characters inside text (fonts cannot draw them, they show as boxes): use data-sticker / data-icon images instead.`;

async function thumbB64(id: string, max = 384): Promise<AiImage | null> {
  try {
    const b = await assets.blob(id); if (!b) return null;
    const bmp = await createImageBitmap(b); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close();
    return { name: `${id}.jpg`, mime: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.8).split(',')[1] };
  } catch { return null; }
}

const CRITIC = `You are the creative director reviewing a social post before it ships. You get the brief, the HTML and a screenshot of how it RENDERS (exactly what people will see in their feed). Standard: the best agency work on Behance, not "good enough".
1. Silently score impact, hierarchy, typography, composition/depth, colour, polish 1-10. Anything under 8 is rebuilt, not nudged: a bigger, tighter headline; a clear focal image used boldly (crop in, overlap the frame, layer it); fewer, better elements; real depth (glow, shadow, overlap); generous margins; one CTA.
2. Fix everything wrong in the render: clipped or overlapping text, elements leaving the frame, weak contrast, cramped spacing, tiny text, awkward empty areas, clutter, boxes where emoji were, anything that did not convert.
3. Keep the copy facts, language, brand colours, fonts and image ids.
Return the COMPLETE revised HTML document in one \`\`\`html block. No commentary.`;

/** Which image provider the relay offers ('cloudflare' | 'google' | 'openai'), or null. Checked once per page load. */
let imageAiCache: string | null | undefined;
export async function imageProvider(): Promise<string | null> {
  if (imageAiCache !== undefined) return imageAiCache ?? null;
  try { const r = await fetch(`${(get().settings.relayUrl || '').replace(/\/$/, '')}/`, { signal: AbortSignal.timeout(60_000) }); const j = await r.json(); imageAiCache = j.imageAi || null; } catch { imageAiCache = null; }
  return imageAiCache ?? null;
}
const aspectFor = (z: DesignSize): '1:1' | '3:4' | '4:3' | '9:16' | '16:9' => { const r = z.w / z.h; return r > 1.5 ? '16:9' : r > 1.15 ? '4:3' : r > 0.9 ? '1:1' : r > 0.66 ? '3:4' : '9:16'; };

/** Photos worth giving the designer: the client's own pictures first (past posts, uploads, website, AI), never tiny or logos. */
function pickImages(clientId: string, logo: string | null, max = 9): string[] {
  const rank = (k?: string) => (k === 'reference' ? 0 : k === 'upload' || k === 'paste' ? 1 : k === 'ai' ? 2 : k === 'web' ? 3 : 4);
  const list = clientImages(clientId).filter((a) => a.id !== logo && a.src?.kind !== 'logo' && Math.min(a.w, a.h) >= 240);
  return list.sort((a, b) => rank(a.src?.kind) - rank(b.src?.kind) || (b.at || '').localeCompare(a.at || '')).slice(0, max).map((a) => a.id);
}

/** One slide of a carousel being designed: its place, its job, and the cover's painted picture to reuse. */
export interface SlideCtx { i: number; n: number; role: string; hero?: string | null; onHero?: (id: string) => void }

async function aiDesign(client: Client, brand: Brand, size: DesignSize, row: PlanRow | null, valid: Set<string>, onStage?: (m: string) => void, signal?: AbortSignal, askPhotos?: AskPhotos, slide?: SlideCtx): Promise<Doc> {
  const book = brandBookOf(client.id);
  const logo = brand.logoAssetId && assets.get(brand.logoAssetId) ? brand.logoAssetId : null;
  // 1. a key visual painted for THIS post (Gemini / OpenAI through the relay), when the relay can draw
  let hero: string | null = slide?.hero && assets.get(slide.hero) ? slide.hero : null;
  if (hero) valid.add(hero);
  else if (await imageProvider()) {
    const idea = row ? `${channelOf(row.channel).label} post. Topic: ${row.topic}. Hook: ${row.hook}. Caption: ${(row.caption || '').slice(0, 400)}. Visual idea from the plan: ${row.visual || '(none)'}` : 'A hero image for the brand and its product.';
    try { hero = await paintShot(client, idea, aspectFor(size), { headline: true, signal, askPhotos, onStage }); valid.add(hero); slide?.onHero?.(hero); }
    catch (e) { if (signal?.aborted || /Đã huỷ/.test((e as Error).message)) throw e; onStage?.(`Không vẽ được ảnh (${(e as Error).message.slice(0, 80)}), dùng ảnh trong kho…`); }
  }
  const ids = [...new Set([...(hero ? [hero] : []), ...(logo ? [logo] : []), ...pickImages(client.id, logo)])].filter((id) => assets.get(id));
  for (const id of ids) valid.add(id);
  const images: AiImage[] = []; const lines: string[] = [];
  for (const id of ids) {
    const a = assets.get(id)!; const t = images.length < 8 ? await thumbB64(id) : null; if (t) images.push(t);
    const role = id === hero ? ' · HERO: painted for this post, use it as the main visual, big' : id === logo ? ' · LOGO' : a.src?.kind === 'reference' ? ' · PAST POST published by this brand: copy its layout system and style' : '';
    lines.push(`- "${id}": ${a.name} · ${a.w}×${a.h}${role}${t ? ` (attached image #${images.length})` : ''}`);
  }
  const fonts = FONTS.filter((f) => f.google && f.vi).map((f) => f.family).join(', ');
  const brief = [
    `Client: ${client.name}${client.industry ? ` (${client.industry})` : ''}`,
    audienceLine(client),
    book ? `Brand: tagline "${book.tagline}"; voice ${book.voice.traits.join(', ')}; colours ${book.palette.map((c) => `${c.name} ${c.hex} (${c.role})`).join(', ')}; fonts ${book.fonts.heading} / ${book.fonts.body}; imagery: ${book.imagery.join('; ')}` : `Brand colours: primary ${brand.primary}, accent ${brand.accent}, ink ${brand.ink}, bg ${brand.bg}; fonts ${brand.headingFamily} / ${brand.fontFamily}`,
    styleNotesOf(client.id) ? `HOUSE STYLE from the client's past posts (match it): ${styleNotesOf(client.id)}` : '',
    ids.some((id) => assets.get(id)?.src?.kind === 'reference') ? "PAST POSTS: the attached pictures marked PAST POST are this brand's real published posts. Design the NEXT post of that same feed: same layout grid and margins, same headline treatment (weight, size ratio, colour, outline / shadow / highlight), same illustration or photo style, same palette, same logo spot and CTA pill style, same decorative motifs. Do not invent a new style; only the content changes." : '',
    row ? `Post: ${channelOf(row.channel).label} ${row.format}, ${row.date}. Topic: ${row.topic}. Hook: ${row.hook}. CTA: ${row.cta}. Visual idea from the plan: ${row.visual}` : 'Post: a general brand post.',
    slide ? `CAROUSEL: this is slide ${slide.i} of ${slide.n} (${slide.role}). All slides share ONE design system: same background treatment, type, colours, margins and logo spot, so they read as one swipeable set. Put a small "${slide.i}/${slide.n}" in a corner${slide.i < slide.n ? ' and a subtle swipe cue (arrow) on the right edge' : ''}. ${slide.role === 'cover' ? 'Cover: the hook, huge, plus the hero picture.' : slide.role === 'cta' ? 'Last slide: the call to action and the brand, calm and clear.' : 'Content slide: ONE point, a short headline and at most two short lines; reuse the hero picture smaller or cropped, or an icon / 3D object.'}` : '',
    'Graphics you may add: data-sticker 3D objects; data-icon colour sets (streamline-color:, streamline-plump-color:, icon-park:, twemoji:, noto:, fluent-emoji-flat:) and mono sets (ph:, game-icons:); data-gfx backgrounds. Use few, large, deliberate.',
  ].join('\n');
  const system = `${SOCIAL}\n\nTECHNICAL CONTRACT (Phloem converts the browser layout into editable layers)\nOUTPUT: one complete HTML document in a single \`\`\`html block. All CSS in one <style>.\nCANVAS: <body> holds exactly one <div id="email" data-email> of EXACTLY width:${size.w}px; height:${size.h}px; overflow:hidden; position:relative, containing ONE <section data-name="Post" style="position:relative;width:${size.w}px;height:${size.h}px">. Everything is positioned inside it; nothing may leave the frame.\n${TECH}\n${NEVER}\nAllowed fonts (exact): ${fonts}.`;
  // 2. first draft
  onStage?.('AI đang thiết kế…');
  const text = await streamClaude({ system, turns: [{ role: 'user', text: `${brief}\n\nFrame: ${size.w}×${size.h}px (${size.label}).\nIMAGE LIST (data-img ids):\n${lines.join('\n') || '(no photos: build the visual with type, colour, 3D objects, generated graphics, icons)'}\n\nDesign and code this post now.`, images }], maxTokens: 16000, effort: 'high' }, (t) => onStage?.(`AI đang thiết kế… ${Math.round(t.length / 100) / 10}k ký tự`), signal);
  let html = extractHtml(text);
  if (!/<(div|section)[\s>]/i.test(html)) throw new Error('AI không trả về thiết kế. Thử lại.');
  onStage?.('Đang chuyển thành layer…');
  let doc = await toDoc(html, size, brand, valid, onStage);
  // 3. the creative director looks at the real render and rebuilds what is weak
  try {
    await readyDoc(doc); await document.fonts.ready;
    const k = Math.min(1, 900 / Math.max(size.w, size.h));
    const shot = renderToCanvas(doc, brand, assets, k).toDataURL('image/jpeg', 0.85).split(',')[1];
    onStage?.('Giám đốc sáng tạo đang soát và chỉnh bản đầu…');
    const rev = await streamClaude({ system: `${CRITIC}\n\n${system}`, turns: [{ role: 'user', text: `${brief}\n\nFrame: ${size.w}×${size.h}px.\nIMAGE LIST:\n${lines.join('\n')}\n\nThe LAST attached image is the render of the current design.\n\nCURRENT HTML:\n\`\`\`html\n${html}\n\`\`\``, images: [...images.slice(0, 5), { name: 'render.jpg', mime: 'image/jpeg', base64: shot }] }], maxTokens: 16000, effort: 'high' }, (t) => onStage?.(`Giám đốc sáng tạo đang chỉnh… ${Math.round(t.length / 100) / 10}k ký tự`), signal);
    const h2 = extractHtml(rev);
    if (/<(div|section)[\s>]/i.test(h2)) { onStage?.('Đang chuyển bản đã chỉnh thành layer…'); doc = await toDoc(h2, size, brand, valid, onStage); html = h2; }
  } catch (e) { if (signal?.aborted) throw e; /* keep the first draft */ }
  return doc;
}

// ---------- AI image prompts: an art director turns a rough idea into a full shot description ----------
const ART_DIRECTOR = `You are the art director of a top advertising agency, briefing an image model (FLUX / Gemini image) for a premium campaign visual.
Write ONE image prompt in English, a single paragraph of 90–150 words, nothing else (no title, no quotes, no list).
Cover, in this order: the hero subject and what is happening (specific, tangible, appetising or aspirational, never generic stock); the setting and props that tell the story; composition for the given aspect ratio (where the focal point sits, the angle, how the frame breathes); camera (lens in mm, aperture, depth of field) for photography, or the exact render style when a 3D, illustration or flat-lay look suits the brand and topic better; lighting (direction, quality, time of day, rim or practical lights); colour grading that weaves the brand colours in through objects, light and surfaces (name the colours in words, never hex codes); materials and textures; the emotion the viewer should feel.
People, places, food and objects must look native to the target market (for Viet Nam: Vietnamese people, streets, homes, products) unless the brief says otherwise.
Aim for the scroll-stopping "wow" of an award-winning campaign: bold idea, striking light, rich detail, cinematic depth, clean and uncluttered.
End with: "No text, letters, numbers, logos or watermarks anywhere in the image."`;

const SHOT_PLAN = `${ART_DIRECTOR.replace(/\nEnd with:[^\n]*$/, '')}

You ALSO see the client's own photo library (numbered pictures, attached in order). Before writing the prompt:
1. REFS: pick up to 3 pictures that show the REAL subjects this image needs — their product, packaging, shop, characters, mascot, game art, people or signature style. They are sent to the image model as references so the result shows the real thing, not an invented one. Pick none when nothing fits; never pick logos or text-heavy graphics.
2. NEEDS: list what real photos are still missing and only the client can supply because accuracy matters (e.g. their exact product, their storefront, their staff, a specific character), max 3, written in Vietnamese, short. Leave it empty when a generic scene is fine or the refs already cover it.
3. PROMPT: as above. When refs are used, say how to use them ("the character from reference 1 …", "keep the 3D art style of the references").
End the prompt with: "No text, letters, numbers, logos or watermarks anywhere in the image."
Reply with JSON only: {"refs":[numbers],"needs":[{"what":"…","why":"…"}],"prompt":"…"}`;

export interface ShotNeed { what: string; why: string }
export interface ShotPlan { prompt: string; refs: string[]; needs: ShotNeed[] }
type Aspect = '1:1' | '3:4' | '4:3' | '9:16' | '16:9';

/** Read the brief and the client's library, then plan the shot: a full prompt, which library pictures to send as references,
 *  and which real photos are still missing. `use` forces pictures in (e.g. ones the user just added). Falls back to a template. */
export async function planShot(client: Client, idea: string, aspect: string, opts: { headline?: boolean; signal?: AbortSignal; use?: string[] } = {}): Promise<ShotPlan> {
  const book = brandBookOf(client.id);
  const brand = designBrand(client);
  const style = [book?.imagery?.join('; '), styleNotesOf(client.id)].filter(Boolean).join('. ');
  const colours = book ? book.palette.map((c) => `${c.name} ${c.hex} (${c.role})`).join(', ') : `${brand.primary}, ${brand.accent}`;
  const logo = brand.logoAssetId || null;
  const forced = (opts.use || []).filter((id) => assets.get(id));
  const lib = [...new Set([...forced, ...pickImages(client.id, logo, 16)])].slice(0, 16);
  const images: AiImage[] = []; const ids: string[] = [];
  for (const id of lib) { const t = await thumbB64(id, 256); if (t) { images.push(t); ids.push(id); } }
  const brief = [
    `Brand: ${client.name}${client.industry ? ` (${client.industry})` : ''}. ${audienceLine(client)}`,
    book ? `Tagline: "${book.tagline}". Personality: ${book.voice.traits.join(', ')}.` : '',
    `Brand colours: ${colours}.`,
    style ? `Brand image style (follow it): ${style}.` : '',
    `Aspect ratio: ${aspect}.${opts.headline ? ' Keep a calm, uncluttered area (sky, wall, soft gradient or shallow-focus background) in the top third for a headline added later.' : ''}`,
    `Brief: ${idea}`,
    ids.length ? `LIBRARY (${ids.length} pictures, attached in this order):\n${ids.map((id, i) => `${i + 1}. ${assets.get(id)?.name || id}${forced.includes(id) ? ' · JUST ADDED BY THE USER FOR THIS IMAGE: use it as a reference' : ''}`).join('\n')}` : 'LIBRARY: empty.',
  ].filter(Boolean).join('\n');
  try {
    if (opts.signal?.aborted) throw new Error('aborted');
    const out = await askClaude({ system: SHOT_PLAN, turns: [{ role: 'user', text: brief, images }], maxTokens: 2000, effort: 'low' });
    const j = JSON.parse((/\{[\s\S]*\}/.exec(out) || ['{}'])[0]);
    const prompt = String(j.prompt || '').trim();
    if (prompt.length > 60) {
      const refs = [...new Set([...forced, ...(Array.isArray(j.refs) ? j.refs : []).map((n: unknown) => ids[Number(n) - 1]).filter(Boolean)])].slice(0, 4) as string[];
      const needs = (Array.isArray(j.needs) ? j.needs : []).slice(0, 3).map((n: any) => ({ what: String(n?.what || '').slice(0, 160), why: String(n?.why || '').slice(0, 200) })).filter((n: ShotNeed) => n.what);
      return { prompt: prompt.slice(0, 1900), refs, needs: forced.length ? [] : needs };
    }
  } catch (e) { if (opts.signal?.aborted) throw e; }
  return {
    prompt: [
      `Premium advertising key visual for ${client.name}${client.industry ? ` (${client.industry})` : ''}. ${idea}.`,
      style ? `Style: ${style}.` : '',
      `Colour grading with the brand colours ${colours}. One clear hero subject, cinematic soft light, rich texture, shallow depth of field, aspect ${aspect}.`,
      opts.headline ? 'Calm empty area in the top third for a headline.' : '',
      'No text, letters, numbers, logos or watermarks anywhere in the image.',
    ].filter(Boolean).join(' '),
    refs: forced, needs: [],
  };
}

/** Called when the plan says real photos are missing: resolves with the pictures to use (the user may add some), or null to cancel. */
export type AskPhotos = (plan: ShotPlan) => Promise<{ refs: string[]; added: string[] } | null>;

/** Plan → (ask for missing photos) → paint. Returns the new library picture's id. */
export async function paintShot(client: Client, idea: string, aspect: Aspect, opts: { headline?: boolean; signal?: AbortSignal; askPhotos?: AskPhotos; onStage?: (m: string) => void } = {}): Promise<string> {
  opts.onStage?.('Art director đang đọc bài và xem kho ảnh…');
  let plan = await planShot(client, idea, aspect, opts);
  if (plan.needs.length && opts.askPhotos) {
    const got = await opts.askPhotos(plan);
    if (!got) throw new Error('Đã huỷ tạo ảnh.');
    if (got.added.length) { opts.onStage?.('Art director đang xem ảnh bạn vừa thêm…'); plan = await planShot(client, idea, aspect, { ...opts, use: [...got.added, ...got.refs] }); }
    else plan = { ...plan, refs: got.refs };
  }
  opts.onStage?.(plan.refs.length ? `AI đang vẽ theo ${plan.refs.length} ảnh thật của khách (10–40 giây)…` : 'AI đang vẽ ảnh (10–40 giây)…');
  return generateImage(client.id, plan.prompt, aspect, plan.refs);
}

// ---------- AI image (Google Imagen / OpenAI through the relay; the keys never reach the browser) ----------
export async function generateImage(clientId: string, prompt: string, aspect: Aspect = '1:1', refIds: string[] = []): Promise<string> {
  const base = (get().settings.relayUrl || '').replace(/\/$/, '');
  await wakeRelay(base, relayAuth());
  const refs = (await Promise.all(refIds.slice(0, 4).map((id) => thumbB64(id, 1024)))).filter(Boolean).map((t) => ({ b64: t!.base64, mime: t!.mime }));
  const r = await fetch(`${base}/ai/image`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...relayAuth() }, body: JSON.stringify({ prompt, aspect, refs }), signal: AbortSignal.timeout(120_000) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 403 && j.code === 'ai_locked') { set({ modal: 'aicode' }); throw new Error(j.error || 'AI cần mã truy cập.'); }
  if (!r.ok) throw new Error(j.error || `Tạo ảnh lỗi (HTTP ${r.status}).`);
  const bytes = Uint8Array.from(atob(j.b64), (ch) => ch.charCodeAt(0));
  const a = await assets.add(new Blob([bytes], { type: j.mime || 'image/png' }), `AI · ${prompt.slice(0, 40)}.${(j.mime || '').includes('jpeg') ? 'jpg' : 'png'}`, { src: { kind: 'ai' }, client: clientId, project: null });
  return a.id;
}
