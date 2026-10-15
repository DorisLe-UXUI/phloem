// Nhập dữ liệu có sẵn của khách từ link: Google Sheet → kế hoạch (bài theo ngày), Google Drive / trang web → kho ảnh
// "đã làm" (references), rồi AI đọc các ảnh đó để rút ra phong cách thương hiệu dùng cho mọi thiết kế sau.
import { getSession } from '../auth/core';
import { extractJson, streamClaude, relayAuth, wakeRelay, type AiImage } from '../ai/client';
import { analyzeSite, importSiteImages } from '../ai/site';
import { parseCsv, sheetCsvUrl } from '../catalog/catalog';
import { postsFromSheet, type SheetPost } from '../../../src/shared/mkt';
import { assets } from '../storage/assets';
import { get } from '../store';
import { newId, putItem } from './data';
import { attachMany, designFromImage } from './designs';
import { refreshProjects } from '../pipeline/actions';
import { brandBookOf } from './kit';
import { CHANNELS, audienceLine, type BrandBook, type Channel, type Client, type Format, type Plan, type PlanRow, type Status } from './types';

export type LinkKind = 'sheet' | 'drive' | 'figma' | 'canva' | 'web';
export function linkKind(url: string): LinkKind | null {
  const s = url.trim(); if (!/^https?:\/\//i.test(s) && !/\./.test(s)) return null;
  if (/docs\.google\.com\/spreadsheets/.test(s)) return 'sheet';
  if (/drive\.google\.com/.test(s)) return 'drive';
  if (/figma\.com\/(file|design|board|proto)\//.test(s)) return 'figma';
  if (/canva\.(com|link)\//.test(s)) return 'canva';
  return 'web';
}
const relayBase = () => (get().settings.relayUrl || '').replace(/\/$/, '');
async function relayPost<T>(path: string, body: unknown, timeout = 60_000): Promise<T> {
  await wakeRelay(relayBase(), relayAuth());
  const r = await fetch(`${relayBase()}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...relayAuth() }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error(getSession() ? 'Phiên đăng nhập hết hạn, đăng nhập lại.' : 'Cần đăng nhập tài khoản Phloem.');
  if (!r.ok) throw new Error(/^HTTP 40[134]\b/.test(String(j.error || '')) || [403, 404].includes(r.status) ? 'Không mở được link (không tồn tại hoặc chưa chia sẻ). Kiểm tra link và bật chia sẻ "Bất kỳ ai có đường liên kết".' : j.error || `Relay trả HTTP ${r.status}`);
  return j as T;
}

// ---------- Google Sheet → plan ----------
const MAP_SYSTEM = `You turn rows of a marketing content calendar (any layout, any language) into JSON posts. Keep the original wording; do not invent posts. Return ONLY {"posts":[{"date":"YYYY-MM-DD","time":"HH:MM","channel":"facebook|instagram|tiktok|youtube|linkedin|google_business|google_search","format":"image|carousel|reel|video|story|article|ad","topic":"…","hook":"…","caption":"…","cta":"…","hashtags":"…","visual":"…","status":"draft|pending|approved|scheduled|live","pillar":"…"}]}. Skip rows that are not posts (titles, totals, notes). Unknown year: use the year given.`;

export async function importSheet(client: Client, link: string, onStage: (m: string) => void): Promise<{ planId: string; posts: number; ai: boolean }> {
  onStage('Đang đọc Google Sheet…');
  const csv = sheetCsvUrl(link) || link;
  const { text } = await relayPost<{ text: string }>('/csv', { url: csv });
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  if (rows.length < 2) throw new Error('Sheet trống, hoặc chưa chia sẻ "Bất kỳ ai có đường liên kết".');
  const usDates = /hoa kỳ|mỹ|united states|usa|canada|philippines/i.test(client.market || '');
  let posts: SheetPost[] | null = postsFromSheet(rows, { usDates, fallbackStatus: 'approved' });
  let ai = false;
  if (!posts || !posts.length) {
    // a layout the column names do not explain: the AI maps it, in chunks
    ai = true; posts = [];
    const year = new Date().getFullYear();
    for (let i = 0; i < Math.min(rows.length, 600); i += 60) {
      onStage(`AI đang đọc bố cục Sheet (${Math.min(i + 60, rows.length)}/${rows.length} hàng)…`);
      const chunk = rows.slice(i, i + 60).map((r) => r.map((c) => c.replace(/\s+/g, ' ').slice(0, 400)).join(' | ')).join('\n');
      const out = await streamClaude({ system: MAP_SYSTEM, turns: [{ role: 'user', text: `Year: ${year}. Market: ${client.market || 'Việt Nam'}.\nHeader: ${rows[0].join(' | ')}\nRows:\n${chunk}` }], maxTokens: 16000, effort: 'low' }, () => {});
      try { const j = extractJson<{ posts?: SheetPost[] }>(out); posts.push(...(j.posts || []).filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(String(p.date)) && (p.topic || p.caption))); } catch { /* skip a bad chunk */ }
    }
    if (!posts.length) throw new Error('Không tìm thấy bài đăng nào trong Sheet (cần ít nhất cột ngày và chủ đề/nội dung).');
  }
  posts.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const chans = [...new Set(posts.map((p) => p.channel))].filter((c) => CHANNELS.some((x) => x.id === c)) as Channel[];
  const start = posts[0].date, last = posts[posts.length - 1].date;
  const months = Math.max(1, Math.min(12, (Number(last.slice(0, 4)) - Number(start.slice(0, 4))) * 12 + Number(last.slice(5, 7)) - Number(start.slice(5, 7)) + 1));
  const now = new Date().toISOString();
  const rowsOut: PlanRow[] = posts.map((p) => ({ id: newId('r'), date: p.date, time: p.time || '19:30', channel: (CHANNELS.some((x) => x.id === p.channel) ? p.channel : 'facebook') as Channel, format: (p.format || 'image') as Format, pillar: p.pillar || '', topic: String(p.topic || p.caption.split('\n')[0]).slice(0, 160), hook: p.hook || '', caption: p.caption || '', cta: p.cta || '', hashtags: p.hashtags || '', visual: p.visual || '', owner: '', status: (p.status || 'approved') as Status }));
  const plan: Plan = {
    title: `Kế hoạch nhập từ Google Sheet (${start.split('-').reverse().join('/')} – ${last.split('-').reverse().join('/')})`, status: 'approved',
    setup: { months, start, channels: chans.length ? chans : ['facebook'], goals: [], budget: 0, currency: client.currency || 'VND', events: '', postsPerWeek: 3, brief: `Nhập từ ${link}` },
    strategy: '', pillars: [...new Set(rowsOut.map((r) => r.pillar).filter(Boolean))].slice(0, 6).map((n) => ({ name: n, share: 0, desc: '' })), months: [], rows: rowsOut, kpiNames: [],
    version: 1, versions: [{ version: 1, at: now, by: get().user?.name || 'Bạn', note: `Nhập ${rowsOut.length} bài từ Google Sheet` }], createdAt: now,
  };
  const planId = newId('plan');
  await putItem(client.id, 'plan', planId, plan);
  return { planId, posts: rowsOut.length, ai };
}

// ---------- Drive / web → library (the client's past work) ----------
async function proxyImage(url: string, name: string, clientId: string): Promise<string | null> {
  try {
    const r = await fetch(`${relayBase()}/image?url=${encodeURIComponent(url)}`, { headers: relayAuth(), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return null;
    const blob = await r.blob(); if (!blob.type.startsWith('image/') || blob.size < 2000) return null;
    return (await assets.add(blob, name || 'Ảnh đã làm', { src: { kind: 'reference', url }, client: clientId, project: null })).id;
  } catch { return null; }
}
const MATCH_SYSTEM = `You match an agency's finished post images (files from a Google Drive folder) to the posts of a content calendar.
Folder and file names say when each picture was posted: month folders ("APRIL 2026", "Q3/JULY 2026", "Oct 2026"), week-of-month folders ("W1"…"W5", weeks start on Monday, W1 is the week holding the 1st), weekdays ("Mon", "MONDAY", "Thu"), times ("9AM", "12PM", "6PM"), day numbers ("D1.2" = day 1 of that week, picture 2), and numbers for several pictures on one day.
Rules:
- Use only what the names say plus the calendar's dates, times and topics; never guess wildly. Skip a file you cannot place.
- Several numbered pictures with the same day and time, or for a calendar post whose format is carousel, are the slides of ONE post, in number order.
- Otherwise, when a day has several posts, the Nth picture of that day goes to the Nth post of that day by time.
- One picture belongs to one post at most.
Reply with JSON only: {"m":[["r12",[3,4,5]],["r13",[6]]]} (calendar row key, file numbers in slide order).`;

/** Finished post pictures from a Drive folder (any depth). With a plan, the AI reads the folder names (month / week / day /
 *  time) and pins each picture to its post (several = carousel slides); pictures it cannot place go to the library as
 *  references, up to `spare`. Without a plan, up to `spare` pictures go to the library. */
export async function importDrive(client: Client, link: string, onStage: (m: string) => void, spare = 40): Promise<ImportResult> {
  onStage('Đang mở thư mục Google Drive (đọc cả các thư mục con)…');
  const { files } = await relayPost<{ files: { id: string; name: string; path?: string; thumb: string }[] }>('/drive', { url: link }, 240_000);
  if (!files.length) throw new Error('Thư mục không có ảnh (hoặc chưa chia sẻ "Bất kỳ ai có đường liên kết").');
  return matchAndPin(client, files.map((f) => ({ name: f.name, path: f.path || '', url: f.thumb })), 'Google Drive', onStage, spare);
}

export interface ImportResult { images: number; posts: number; slides: number }
export interface PostPicture { name: string; path: string; url: string }
/** Shared by Drive and Figma: the AI pins pictures to the plan's posts by their names, then they are downloaded and attached. */
async function matchAndPin(client: Client, files: PostPicture[], source: string, onStage: (m: string) => void, spare: number): Promise<ImportResult> {
  const { cachedItems, listItems } = await import('./data');
  const items = cachedItems(client.id) || await listItems(client.id);
  const plans = items.filter((i) => i.kind === 'plan') as { id: string; data: Plan }[];
  const rows = plans.flatMap((p) => (p.data.rows || []).map((r) => ({ ...r, planId: p.id })));
  const pick = new Map<string, number[]>(); // row key → file indexes
  if (rows.length) {
    onStage(`AI đang ghép ${files.length} ảnh với ${rows.length} bài trong kế hoạch…`);
    const wd = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short' });
    const rowText = rows.map((r, i) => `r${i}|${r.date} ${wd(r.date)}|${r.time}|${r.channel}|${r.format}|${r.topic.slice(0, 60)}`).join('\n');
    const fileText = files.map((f, i) => `${i}|${f.path ? `${f.path}/` : ''}${f.name}`).join('\n');
    try {
      const out = await streamClaude({ system: MATCH_SYSTEM, turns: [{ role: 'user', text: `CALENDAR (key|date weekday|time|channel|format|topic):\n${rowText}\n\nFILES (number|path/name):\n${fileText}` }], maxTokens: 16000, effort: 'medium' }, (t) => onStage(`AI đang ghép ảnh với bài… ${Math.round(t.length / 100) / 10}k ký tự`));
      const j = extractJson<{ m?: [string, number[]][] }>(out);
      const used = new Set<number>();
      for (const [key, idx] of j?.m || []) {
        const ok = (idx || []).filter((n) => Number.isInteger(n) && files[n] && !used.has(n)).slice(0, 10);
        if (rows[Number(String(key).slice(1))] && ok.length) { ok.forEach((n) => used.add(n)); pick.set(key, ok); }
      }
    } catch (e) { onStage(`AI không ghép được (${(e as Error).message.slice(0, 60)}), chỉ nhập ảnh vào kho…`); }
  }
  // download: matched pictures first, then a few spares for the house style
  const matched = new Set([...pick.values()].flat());
  const spares = files.map((_, i) => i).filter((i) => !matched.has(i)).slice(0, spare);
  const want = [...matched, ...spares];
  const assetOf = new Map<number, string>();
  let done = 0;
  const worker = async () => {
    for (let k = want.shift(); k !== undefined; k = want.shift()) {
      const f = files[k];
      const id = await proxyImage(f.url, `${f.path ? `${f.path.replace(/\//g, ' · ')} · ` : ''}${f.name}`, client.id);
      if (id) assetOf.set(k, id);
      onStage(`Đang tải ảnh từ ${source} ${++done}/${matched.size + spares.length}…`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // pin each post's pictures (one design per picture; carousel = several, in order), one plan write per plan
  let posts = 0, slides = 0;
  const byPlan = new Map<string, Record<string, string[]>>();
  const list = [...pick.entries()];
  for (let i = 0; i < list.length; i++) {
    const [key, idx] = list[i];
    const r = rows[Number(key.slice(1))];
    onStage(`Đang gắn ảnh vào bài ${i + 1}/${list.length}: ${r.topic.slice(0, 40)}…`);
    const ids: string[] = [];
    for (const n of idx) { const a = assetOf.get(n); if (!a) continue; try { ids.push((await designFromImage(client, r, a, false, { attach: false, refresh: false })).id); } catch { /* unreadable picture */ } }
    if (!ids.length) continue;
    const m = byPlan.get(r.planId) || {}; m[r.id] = ids; byPlan.set(r.planId, m);
    posts++; slides += ids.length;
  }
  for (const [planId, map] of byPlan) await attachMany(client.id, planId, map, `Gắn ${Object.keys(map).length} bài đã làm từ ${source}`);
  await refreshProjects();
  return { images: assetOf.size, posts, slides };
}
/** Every frame of a Figma file (or of the page / section / frame the link points at) rendered to a picture, then pinned to posts
 *  like Drive pictures. Needs the user's Figma token (the same one Phloem Email's "Import từ Figma" uses). */
export async function importFigma(client: Client, link: string, onStage: (m: string) => void, spare = 40): Promise<ImportResult> {
  const { parseFigmaUrl } = await import('../io/figmaImport');
  const ref = parseFigmaUrl(link.replace(/figma\.com\/proto\//, 'figma.com/design/'));
  if (!ref) throw new Error('Link Figma không hợp lệ.');
  let token = ''; try { token = JSON.parse(localStorage.getItem('phloem.figma.token') || '""'); } catch { /* none */ }
  if (!token) throw new Error('Cần token Figma: dán token vào ô "Token Figma" bên dưới (Figma → Settings → Security → Personal access tokens, quyền File content: Read).');
  const api = async (path: string) => {
    const r = await fetch(`https://api.figma.com/v1${path}`, { headers: { 'X-Figma-Token': token } });
    if (r.status === 403) throw new Error('Figma từ chối (403): token sai, thiếu quyền File content: Read, hoặc tài khoản của token không xem được file này.');
    if (r.status === 404) throw new Error('Không tìm thấy file Figma (404).');
    if (r.status === 429) throw new Error('Figma giới hạn tốc độ (429). Đợi một phút rồi thử lại.');
    if (!r.ok) throw new Error(`Figma HTTP ${r.status}`);
    return r.json();
  };
  onStage('Đang đọc file Figma…');
  type FNode = { id: string; name: string; type: string; children?: FNode[] };
  const frames: { id: string; name: string; path: string }[] = [];
  const BOX = new Set(['FRAME', 'COMPONENT', 'INSTANCE', 'GROUP']);
  const collect = (n: FNode, path: string, depth: number) => {
    for (const c of n.children || []) {
      if (frames.length >= 400) return;
      if (c.type === 'SECTION' || c.type === 'CANVAS') collect(c, path ? `${path}/${c.name}` : c.name, depth + 1);
      else if (BOX.has(c.type)) frames.push({ id: c.id, name: c.name, path });
    }
  };
  if (ref.nodeId) {
    const j = await api(`/files/${ref.fileKey}/nodes?ids=${encodeURIComponent(ref.nodeId)}&depth=2`);
    const node = j.nodes?.[ref.nodeId]?.document as FNode | undefined; if (!node) throw new Error('Không tìm thấy frame trong link.');
    if (node.type === 'SECTION' || node.type === 'CANVAS') collect(node, node.name, 0); else frames.push({ id: node.id, name: node.name, path: '' });
  } else {
    const j = await api(`/files/${ref.fileKey}?depth=3`);
    collect(j.document as FNode, '', 0);
  }
  if (!frames.length) throw new Error('File Figma không có frame nào.');
  const files: PostPicture[] = [];
  for (let i = 0; i < frames.length; i += 50) {
    onStage(`Figma đang xuất ảnh frame ${i + 1}–${Math.min(i + 50, frames.length)}/${frames.length}…`);
    const part = frames.slice(i, i + 50);
    const j = await api(`/images/${ref.fileKey}?ids=${encodeURIComponent(part.map((f) => f.id).join(','))}&format=png&scale=1`);
    for (const f of part) if (j.images?.[f.id]) files.push({ name: f.name, path: f.path, url: j.images[f.id] });
  }
  return matchAndPin(client, files, 'Figma', onStage, spare);
}

/** Canva has no public API for shared links: read what the share page exposes (its preview pictures); when it shows nothing,
 *  say how to get the pages out (Canva → Share → Download, or Save to Google Drive, then import that). */
export async function importCanva(client: Client, link: string, onStage: (m: string) => void): Promise<number> {
  const hint = 'Canva không cho đọc thiết kế qua link. Trong Canva bấm Chia sẻ → Tải xuống (PNG, tất cả trang) rồi kéo thả ảnh vào kho, hoặc Chia sẻ → Lưu vào Google Drive rồi dán link thư mục Drive vào đây.';
  let n = 0;
  try { n = await importWeb(client, link, onStage); } catch { throw new Error(hint); }
  if (!n) throw new Error(hint);
  return n;
}
export async function importWeb(client: Client, link: string, onStage: (m: string) => void): Promise<number> {
  onStage('Đang đọc trang…');
  const site = await analyzeSite(link, onStage);
  const prev = assets.context.client; assets.context.client = client.id;
  try { onStage('Đang lấy ảnh trên trang vào kho…'); const r = await importSiteImages(site, 40); return r.imageIds.length + (r.logoId ? 1 : 0); }
  finally { assets.context.client = prev; }
}

// ---------- AI reads the house style ----------
async function thumb(id: string): Promise<AiImage | null> {
  try { const b = await assets.blob(id); if (!b) return null; const bmp = await createImageBitmap(b); const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height); bmp.close(); return { name: `${id}.jpg`, mime: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.82).split(',')[1] }; } catch { return null; }
}
/** Look at the client's past posts and pictures and write down the house style; saved on the brand book (or a note). */
export async function learnStyle(client: Client, onStage: (m: string) => void): Promise<string> {
  const refs = assets.all().filter((a) => a.client === client.id && ['reference', 'upload', 'paste', 'web'].includes(a.src?.kind || '') && Math.min(a.w, a.h) >= 200)
    .sort((a, b) => (a.src?.kind === 'reference' ? 0 : 1) - (b.src?.kind === 'reference' ? 0 : 1)).slice(0, 12);
  if (refs.length < 2) throw new Error('Cần ít nhất 2 ảnh đã làm của khách trong kho (nhập từ Drive, web, hoặc tải lên).');
  onStage(`AI đang xem ${refs.length} ảnh đã làm của khách…`);
  const images = (await Promise.all(refs.map((a) => thumb(a.id)))).filter(Boolean) as AiImage[];
  const out = await streamClaude({
    system: `You are an art director studying a brand's past social posts. Describe the HOUSE STYLE precisely so a designer can reproduce it: layout patterns, typography (weight, case, size contrast), colour use, photo treatment, graphic devices (badges, frames, stickers, 3D, textures), copy length on images, logo placement, mood. Write in the client's content language. Return ONLY JSON {"styleNotes":"5-8 sentences","imagery":["…"],"layout":["…"],"do":["…"],"dont":["…"]}.`,
    turns: [{ role: 'user', text: `${client.name}${client.industry ? ` (${client.industry})` : ''}. ${audienceLine(client)}\nThe ${images.length} attached images are the client's past posts / pictures.`, images }],
    maxTokens: 4000, effort: 'medium',
  }, (t) => onStage(`AI đang rút ra phong cách… ${Math.round(t.length / 100) / 10}k ký tự`));
  const j = extractJson<{ styleNotes?: string; imagery?: string[]; layout?: string[]; do?: string[]; dont?: string[] }>(out);
  const notes = String(j.styleNotes || '').slice(0, 1500);
  if (!notes) throw new Error('AI chưa rút ra được phong cách, thử lại.');
  const book = brandBookOf(client.id);
  if (book) {
    const merge = (a: string[], b?: string[]) => [...new Set([...(b || []).map(String), ...a])].slice(0, 10);
    const version = (book.version || 1) + 1;
    const next: BrandBook = { ...book, styleNotes: notes, imagery: merge(book.imagery, j.imagery), layout: merge(book.layout, j.layout), examples: { do: merge(book.examples.do, j.do), dont: merge(book.examples.dont, j.dont) }, version, versions: [...(book.versions || []), { version, at: new Date().toISOString(), by: get().user?.name || 'Bạn', note: `AI học phong cách từ ${images.length} ảnh đã làm` }].slice(-30) };
    await putItem(client.id, 'brand', 'main', next);
  } else {
    await putItem(client.id, 'note', 'style', { title: 'Phong cách từ ảnh đã làm', styleNotes: notes, imagery: j.imagery || [], layout: j.layout || [] });
  }
  return notes;
}
