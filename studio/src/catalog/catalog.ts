// Kho hàng: a product catalog imported from Google Sheets / CSV / Shopify, summarised for the AI, which then says
// what to push in the next email and why. Items feed straight into the AI composer as real products.
import { askClaude, extractJson } from '../ai/client';
import type { SiteProduct } from '../ai/site';
import { get } from '../store';
import { getSession } from '../auth/core';

export interface CatalogItem {
  id: string; name: string; price: string; oldPrice: string; cost: string; stock: number | null; sold: number | null;
  category: string; tags: string; image: string; url: string; desc: string; source: 'sheet' | 'csv' | 'shopify' | 'manual';
}
export interface Suggestion { title: string; why: string; campaign: string; subject: string; preheader: string; itemIds: string[]; urgency: 'high' | 'medium' | 'low' }
export interface SuggestResult { insights: string[]; suggestions: Suggestion[] }

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const SYN: Record<keyof Omit<CatalogItem, 'id' | 'source' | 'stock' | 'sold'> | 'stock' | 'sold', string[]> = {
  name: ['name', 'product', 'product name', 'ten', 'ten san pham', 'san pham', 'title', 'item', 'mat hang', 'hang'],
  price: ['price', 'gia', 'gia ban', 'unit price', 'sale price', 'selling price', 'don gia'],
  oldPrice: ['old price', 'compare at', 'compare_at_price', 'gia cu', 'gia goc', 'list price', 'msrp', 'gia niem yet', 'regular price'],
  cost: ['cost', 'gia von', 'cost price', 'cogs', 'gia nhap'],
  stock: ['stock', 'inventory', 'ton', 'ton kho', 'qty', 'quantity', 'so luong', 'con', 'con lai', 'available', 'on hand'],
  sold: ['sold', 'sales', 'da ban', 'orders', 'units sold', 'luot ban', 'ban ra', 'so ban'],
  category: ['category', 'danh muc', 'type', 'loai', 'collection', 'nhom', 'group', 'product type'],
  tags: ['tags', 'tag', 'nhan', 'label', 'labels'],
  image: ['image', 'img', 'anh', 'hinh', 'hinh anh', 'photo', 'picture', 'thumbnail', 'image url', 'image_src', 'image src'],
  url: ['url', 'link', 'lien ket', 'href', 'product url', 'landing'],
  desc: ['description', 'mo ta', 'desc', 'note', 'ghi chu', 'body', 'details'],
};

/** Parse CSV/TSV text (quotes, escaped quotes, auto delimiter). Returns rows of strings. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t', '|'].map((d) => ({ d, n: (first.match(new RegExp(d === '|' ? '\\|' : d, 'g')) || []).length })).sort((a, b) => b.n - a.n)[0]?.d || ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') { q = true; continue; }
    if (ch === delim) { row.push(cell); cell = ''; continue; }
    if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((c) => c.trim())) rows.push(row); row = []; continue; }
    cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Guess which column holds what from the header row. */
export function mapColumns(headers: string[]): Partial<Record<keyof typeof SYN, number>> {
  const out: Partial<Record<keyof typeof SYN, number>> = {};
  const hs = headers.map(strip);
  for (const key of Object.keys(SYN) as (keyof typeof SYN)[]) {
    let best = -1;
    for (const syn of SYN[key]) { const i = hs.findIndex((h) => h === syn); if (i >= 0) { best = i; break; } }
    if (best < 0) for (const syn of SYN[key]) { const i = hs.findIndex((h) => h.includes(syn) && !Object.values(out).includes(h.length)); if (i >= 0 && !Object.values(out).includes(i)) { best = i; break; } }
    if (best >= 0 && !Object.values(out).includes(best)) out[key] = best;
  }
  if (out.name === undefined) out.name = 0;
  return out;
}

const num = (s: string | undefined): number | null => { if (s == null) return null; const n = parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const uid = () => `c_${Math.random().toString(36).slice(2, 9)}`;

export function itemsFromRows(rows: string[][], source: CatalogItem['source']): CatalogItem[] {
  if (rows.length < 2) return [];
  const map = mapColumns(rows[0]);
  const g = (r: string[], k: keyof typeof SYN) => (map[k] === undefined ? '' : String(r[map[k]!] ?? '').trim());
  return rows.slice(1).filter((r) => g(r, 'name')).map((r) => ({
    id: uid(), name: g(r, 'name'), price: g(r, 'price'), oldPrice: g(r, 'oldPrice'), cost: g(r, 'cost'), stock: num(g(r, 'stock')), sold: num(g(r, 'sold')),
    category: g(r, 'category'), tags: g(r, 'tags'), image: g(r, 'image'), url: g(r, 'url'), desc: g(r, 'desc').slice(0, 300), source,
  }));
}

export function itemsFromShopify(products: SiteProduct[]): CatalogItem[] {
  return products.map((p) => ({ id: uid(), name: p.name, price: p.price, oldPrice: p.compareAt, cost: '', stock: null, sold: null, category: p.type, tags: '', image: p.image, url: p.url, desc: '', source: 'shopify' as const }));
}

/** Google Sheets share/publish link → CSV export URL (the sheet must be shared "anyone with the link" or published). */
export function sheetCsvUrl(link: string): string | null {
  const m = /docs\.google\.com\/spreadsheets\/d\/(e\/)?([a-zA-Z0-9-_]+)/.exec(link);
  if (!m) return null;
  if (m[1]) return /output=csv/.test(link) ? link : link.replace(/\/pub(html)?(\?.*)?$/, '/pub?output=csv');
  const gid = /[#&?]gid=(\d+)/.exec(link)?.[1];
  return `https://docs.google.com/spreadsheets/d/${m[2]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

function relay(): { url: string; headers: Record<string, string> } | null {
  const s = get().settings; const url = (s.relayUrl || '').replace(/\/$/, ''); if (!url) return null;
  const ses = getSession();
  return { url, headers: { ...(ses?.mode === 'relay' ? { Authorization: `Bearer ${ses.token}` } : {}), ...(s.relayToken ? { 'X-Phloem-Token': s.relayToken } : {}) } };
}

/** Fetch a CSV through the relay (Google Sheets blocks browser CORS). */
export async function fetchCsv(url: string): Promise<string> {
  const r = relay(); if (!r) throw new Error('Cần relay để tải Google Sheet (Cài đặt → Relay URL).');
  let res: Response;
  try { res = await fetch(`${r.url}/csv`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...r.headers }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Không gọi được relay.'); }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error('Đăng nhập tài khoản relay để tải Sheet.');
  if (!res.ok) throw new Error(j.error || `Relay trả ${res.status}`);
  return String(j.text || '');
}

export function toProducts(items: CatalogItem[]): SiteProduct[] {
  return items.map((i) => ({ name: i.name, price: i.price, compareAt: i.oldPrice, type: i.category, url: i.url, image: i.image }));
}

/** Compact table for the prompt (max 80 rows). */
export function summarize(items: CatalogItem[]): string {
  const rows = items.slice(0, 80).map((i) => [i.id, i.name, i.price && `giá ${i.price}`, i.oldPrice && `giá cũ ${i.oldPrice}`, i.cost && `vốn ${i.cost}`, i.stock != null && `tồn ${i.stock}`, i.sold != null && `đã bán ${i.sold}`, i.category, i.tags, i.desc && i.desc.slice(0, 80)].filter(Boolean).join(' · '));
  return `${items.length} sản phẩm${items.length > 80 ? ' (80 đầu)' : ''}:\n${rows.join('\n')}`;
}

const SUGGEST_SYSTEM = `Bạn là trưởng phòng e-commerce/marketing giàu kinh nghiệm. Nhận bảng kho hàng (tên, giá, giá cũ, vốn, tồn kho, đã bán, danh mục) và mục tiêu, hãy phân tích như một người làm thật:
- Tồn nhiều + bán chậm → cần đẩy (giảm giá, bundle, "last call"); bán chạy + còn hàng → bán chéo/"bestseller"; sắp hết → "sắp cháy hàng" tạo gấp; biên lợi nhuận cao (giá − vốn) → ưu tiên; danh mục mùa vụ (theo ngày hôm nay) → đúng thời điểm; hàng mới/chưa bán → ra mắt.
- Đưa 3–5 gợi ý chiến dịch, mỗi gợi ý chọn 2–6 sản phẩm cụ thể, nói rõ VÌ SAO (có số: tồn, đã bán, biên), loại email (promo / launch / cart / reengagement / newsletter / digest), subject (≤ 55 ký tự) và preheader. Xếp theo mức độ cần làm ngay (urgency high/medium/low).
- Thêm 3–5 insight ngắn về kho (ví dụ: "40% tồn kho nằm ở 3 SKU", "danh mục X bán chạy nhất").
Trả lời CHỈ JSON: {"insights":["…"],"suggestions":[{"title":"…","why":"…","campaign":"promo","subject":"…","preheader":"…","itemIds":["c_…"],"urgency":"high"}]}`;

export async function suggestCampaigns(items: CatalogItem[], goal = ''): Promise<SuggestResult> {
  if (!items.length) throw new Error('Kho trống. Nhập sản phẩm trước.');
  const text = await askClaude({ system: SUGGEST_SYSTEM, turns: [{ role: 'user', text: `Hôm nay: ${new Date().toLocaleDateString('vi-VN')}\nMục tiêu: ${goal || 'tăng doanh thu tháng này'}\n\n${summarize(items)}` }], maxTokens: 6000, effort: 'medium' });
  const j = extractJson<Partial<SuggestResult>>(text);
  const ids = new Set(items.map((i) => i.id));
  const byName = new Map(items.map((i) => [strip(i.name), i.id]));
  const suggestions = (j.suggestions || []).map((s) => ({
    title: String(s.title || 'Gợi ý'), why: String(s.why || ''), campaign: String(s.campaign || 'promo'), subject: String(s.subject || ''), preheader: String(s.preheader || ''),
    urgency: (['high', 'medium', 'low'].includes(String(s.urgency)) ? s.urgency : 'medium') as Suggestion['urgency'],
    itemIds: (s.itemIds || []).map((x) => (ids.has(String(x)) ? String(x) : byName.get(strip(String(x))) || '')).filter(Boolean),
  })).filter((s) => s.itemIds.length);
  return { insights: (j.insights || []).map(String).slice(0, 6), suggestions };
}
