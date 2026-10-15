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
import { brandBookOf } from './kit';
import { CHANNELS, audienceLine, type BrandBook, type Channel, type Client, type Format, type Plan, type PlanRow, type Status } from './types';

export type LinkKind = 'sheet' | 'drive' | 'web';
export function linkKind(url: string): LinkKind | null {
  const s = url.trim(); if (!/^https?:\/\//i.test(s) && !/\./.test(s)) return null;
  if (/docs\.google\.com\/spreadsheets/.test(s)) return 'sheet';
  if (/drive\.google\.com/.test(s)) return 'drive';
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
export async function importDrive(client: Client, link: string, onStage: (m: string) => void, max = 60): Promise<number> {
  onStage('Đang mở thư mục Google Drive…');
  const { files } = await relayPost<{ files: { id: string; name: string; thumb: string }[] }>('/drive', { url: link });
  if (!files.length) throw new Error('Thư mục không có ảnh (hoặc chưa chia sẻ "Bất kỳ ai có đường liên kết").');
  let n = 0;
  for (let i = 0; i < Math.min(files.length, max); i++) {
    onStage(`Đang tải ảnh từ Drive ${i + 1}/${Math.min(files.length, max)}…`);
    if (await proxyImage(files[i].thumb, files[i].name, client.id)) n++;
  }
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
