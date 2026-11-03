// Báo cáo: one client's results for a period, from the data Phloem really has.
//  - Content: the plan's posts in the period (planned, approved, published) per channel.
//  - Email: Phloem Email campaigns (sent, opens, clicks, orders, revenue) and list growth, from the relay.
//  - Social / ads / web: numbers imported from the CSV exports of Meta Business Suite, TikTok Studio, Google Ads and GA4
//    (direct connections need each platform's app review; the CSV works today and keeps the same report shape).
// A snapshot (KPIs, series, AI commentary) is saved as a 'report' item, so it can be shared with the client by link.
import { askClaude } from '../ai/client';
import { reports as audienceReports } from '../pipeline/audience';
import { cachedItems, putItem } from './data';
import { audienceLine, channelOf, type Client, type Item, type Plan } from './types';

export type Source = 'meta' | 'tiktok' | 'google_ads' | 'ga4' | 'other';
export const SOURCES: { id: Source; label: string; hint: string }[] = [
  { id: 'meta', label: 'Facebook / Instagram', hint: 'Meta Business Suite → Thông tin chi tiết → Xuất dữ liệu (CSV)' },
  { id: 'tiktok', label: 'TikTok', hint: 'TikTok Studio → Phân tích → Tải xuống dữ liệu (CSV)' },
  { id: 'google_ads', label: 'Google Ads', hint: 'Google Ads → Báo cáo → Tải xuống CSV (theo ngày)' },
  { id: 'ga4', label: 'Website (GA4)', hint: 'GA4 → Báo cáo → Chia sẻ → Tải tệp CSV (theo ngày)' },
  { id: 'other', label: 'Khác', hint: 'Bất kỳ CSV nào có cột ngày và các cột số' },
];
/** The metrics a report knows, matched from column names in any language the exports use. */
export const METRICS: { id: string; label: string; re: RegExp; sum: boolean; money?: boolean }[] = [
  { id: 'reach', label: 'Tiếp cận', re: /reach|tiếp cận|unique/i, sum: true },
  { id: 'impressions', label: 'Lượt hiển thị', re: /impression|hiển thị|views?$|video views|lượt xem/i, sum: true },
  { id: 'engagement', label: 'Tương tác', re: /engagement|tương tác|reactions?|likes?|comments?|shares?/i, sum: true },
  { id: 'followers', label: 'Người theo dõi mới', re: /follow|người theo dõi|page likes/i, sum: true },
  { id: 'clicks', label: 'Lượt bấm', re: /clicks?|lượt nhấp|link clicks/i, sum: true },
  { id: 'spend', label: 'Chi tiêu quảng cáo', re: /spend|cost|chi tiêu|chi phí|amount spent/i, sum: true, money: true },
  { id: 'conversions', label: 'Chuyển đổi', re: /conversion|chuyển đổi|purchases?|leads?|key events/i, sum: true },
  { id: 'revenue', label: 'Doanh thu', re: /revenue|doanh thu|purchase value|conv\. value|giá trị/i, sum: true, money: true },
  { id: 'sessions', label: 'Phiên truy cập', re: /sessions?|phiên/i, sum: true },
  { id: 'users', label: 'Người dùng web', re: /^users$|active users|total users|người dùng/i, sum: true },
];

export interface Dataset { id: string; source: Source; name: string; uploadedAt: string; days: Record<string, Record<string, number>> } // day (YYYY-MM-DD) → metric → value
export interface MetricsStore { datasets: Dataset[] }

// ---------- CSV import ----------
function splitCsv(text: string): string[][] {
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : text.includes('\t') && !text.split('\n')[0].includes(',') ? '\t' : ',';
  const rows: string[][] = []; let row: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true; else if (c === sep) { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const num = (s: string) => { const t = String(s || '').replace(/[^\d,.\-]/g, ''); if (!t) return NaN; const n = /,\d{1,2}$/.test(t) && t.includes('.') ? t.replace(/\./g, '').replace(',', '.') : /^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.'); return Number(n); };
function day(s: string): string | null {
  const t = String(s || '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(t); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(t); if (m) { const a = Number(m[1]), b = Number(m[2]); const [d, mo] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b]; return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; } // dd/mm/yyyy unless clearly mm/dd
  m = /^(\d{8})$/.exec(t); if (m) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`; // GA4 20261031
  const d = Date.parse(t); return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null;
}
/** A platform's CSV export → daily metrics. Header rows above the table (GA4, Google Ads) are skipped. */
export function parseMetricsCsv(text: string, source: Source, name: string): Dataset {
  const rows = splitCsv(text.replace(/^﻿/, '')).filter((r) => !/^#/.test(r[0] || ''));
  let h = rows.findIndex((r) => r.some((c) => /date|ngày|day|ngay/i.test(c)) && r.filter((c) => METRICS.some((m) => m.re.test(c))).length >= 1);
  if (h < 0) throw new Error('Không thấy cột ngày và cột số liệu trong file. Hãy xuất báo cáo theo ngày (có cột Date/Ngày).');
  const head = rows[h].map((c) => c.trim()); const dateCol = head.findIndex((c) => /date|ngày|day|ngay/i.test(c));
  const cols = head.map((c, i) => ({ i, m: i === dateCol ? null : METRICS.find((m) => m.re.test(c)) || null })).filter((x) => x.m);
  const days: Dataset['days'] = {};
  for (const r of rows.slice(h + 1)) {
    const d = day(r[dateCol]); if (!d) continue;
    const o = (days[d] ||= {});
    for (const { i, m } of cols) { const v = num(r[i]); if (Number.isFinite(v)) o[m!.id] = (o[m!.id] || 0) + v; }
  }
  if (!Object.keys(days).length) throw new Error('File không có dòng số liệu theo ngày nào đọc được.');
  return { id: `ds_${Math.random().toString(36).slice(2, 9)}`, source, name, uploadedAt: new Date().toISOString(), days };
}
export const metricsOf = (clientId: string): MetricsStore => ((cachedItems(clientId) || []).find((i) => i.kind === 'report' && i.id === 'metrics') as Item<MetricsStore> | undefined)?.data || { datasets: [] };
export async function addDataset(clientId: string, ds: Dataset) {
  const cur = metricsOf(clientId);
  // the same source and name replaces its older upload (a fresh export of the same report)
  await putItem(clientId, 'report', 'metrics', { datasets: [...cur.datasets.filter((d) => !(d.source === ds.source && d.name === ds.name)), ds] });
}
export async function removeDataset(clientId: string, id: string) { const cur = metricsOf(clientId); await putItem(clientId, 'report', 'metrics', { datasets: cur.datasets.filter((d) => d.id !== id) }); }

// ---------- the report ----------
export interface Period { from: string; to: string; label: string }
export function periodOf(kind: '7' | '30' | '90' | 'month' | 'lastmonth', now = new Date()): Period {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (kind === 'month' || kind === 'lastmonth') {
    const y = now.getFullYear(), m = now.getMonth() - (kind === 'lastmonth' ? 1 : 0);
    const a = new Date(y, m, 1), b = kind === 'month' ? now : new Date(y, m + 1, 0);
    return { from: iso(new Date(a.getTime() - a.getTimezoneOffset() * 6e4)), to: iso(new Date(b.getTime() - b.getTimezoneOffset() * 6e4)), label: `Tháng ${a.getMonth() + 1}/${a.getFullYear()}` };
  }
  const n = Number(kind); return { from: iso(new Date(now.getTime() - (n - 1) * 86400e3)), to: iso(now), label: `${n} ngày qua` };
}
export interface Kpi { id: string; label: string; value: number; prev: number | null; unit?: '%' | 'đ' | ''; money?: boolean }
export interface Snapshot {
  title: string; period: Period; createdAt: string; language: string;
  kpis: Kpi[];
  content: { planned: number; approved: number; live: number; byChannel: { channel: string; label: string; planned: number; live: number }[] };
  email: { campaigns: { subject: string; at: string; sent: number; opens: number; clicks: number; orders: number; revenue: number }[]; sent: number; opens: number; clicks: number; orders: number; revenue: number; growth: number } | null;
  series: { id: string; label: string; points: { day: string; value: number }[] }[];
  sources: string[];
  commentary: string; // AI: highlights, what did not work, next steps
}
const inP = (d: string, p: Period) => d >= p.from && d <= p.to;
function prevPeriod(p: Period): Period { const a = Date.parse(p.from), b = Date.parse(p.to); const len = b - a + 86400e3; return { from: new Date(a - len).toISOString().slice(0, 10), to: new Date(a - 86400e3).toISOString().slice(0, 10), label: 'kỳ trước' }; }

export async function buildReport(client: Client, p: Period): Promise<Snapshot> {
  const items = cachedItems(client.id) || [];
  const rows = (items.filter((i) => i.kind === 'plan') as Item<Plan>[]).flatMap((x) => x.data.rows || []);
  const inRows = rows.filter((r) => inP(r.date, p));
  const ch = new Map<string, { planned: number; live: number }>();
  for (const r of inRows) { const c = ch.get(r.channel) || { planned: 0, live: 0 }; c.planned++; if (r.status === 'live') c.live++; ch.set(r.channel, c); }
  const content = { planned: inRows.length, approved: inRows.filter((r) => ['approved', 'scheduled', 'live'].includes(r.status)).length, live: inRows.filter((r) => r.status === 'live').length, byChannel: [...ch].map(([channel, v]) => ({ channel, label: channelOf(channel).label, ...v })).sort((a, b) => b.planned - a.planned) };

  // email, from the relay (this period and the one before it, for the change)
  let email: Snapshot['email'] = null; let emailPrev: { sent: number; opens: number; clicks: number; revenue: number } | null = null;
  try {
    const days = Math.min(365, Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86400e3) * 2 + 2);
    const r = await audienceReports(client.id, days);
    const pp = prevPeriod(p);
    const cs = r.campaigns.filter((c) => inP(c.at.slice(0, 10), p));
    const prevCs = r.campaigns.filter((c) => inP(c.at.slice(0, 10), pp));
    const sum = (a: typeof cs, k: 'sent' | 'opens' | 'clicks' | 'orders' | 'revenue') => a.reduce((s, c) => s + (Number(c[k]) || 0), 0);
    if (cs.length || prevCs.length) {
      email = { campaigns: cs.map((c) => ({ subject: c.subject, at: c.at, sent: c.sent, opens: c.opens, clicks: c.clicks, orders: c.orders, revenue: c.revenue })), sent: sum(cs, 'sent'), opens: sum(cs, 'opens'), clicks: sum(cs, 'clicks'), orders: sum(cs, 'orders'), revenue: sum(cs, 'revenue'), growth: r.growth.filter((g) => inP(g.day, p)).reduce((s, g) => s + g.subscribed - g.unsubscribed, 0) };
      emailPrev = { sent: sum(prevCs, 'sent'), opens: sum(prevCs, 'opens'), clicks: sum(prevCs, 'clicks'), revenue: sum(prevCs, 'revenue') };
    }
  } catch { /* no relay account or no email data: the email part is left out */ }

  // imported platform numbers
  const ds = metricsOf(client.id).datasets;
  const total = (id: string, per: Period) => { let v = 0, any = false; for (const d of ds) for (const [k, m] of Object.entries(d.days)) if (inP(k, per) && m[id] != null) { v += m[id]; any = true; } return any ? v : null; };
  const pp = prevPeriod(p);
  const kpis: Kpi[] = [
    { id: 'live', label: 'Bài đã đăng', value: content.live, prev: rows.filter((r) => inP(r.date, pp) && r.status === 'live').length },
    { id: 'approval', label: 'Tỉ lệ duyệt', value: content.planned ? Math.round((content.approved / content.planned) * 100) : 0, prev: null, unit: '%' },
  ];
  for (const m of METRICS) { const v = total(m.id, p); if (v != null) kpis.push({ id: m.id, label: m.label, value: Math.round(v), prev: total(m.id, pp), money: m.money }); }
  if (email) {
    kpis.push({ id: 'email_open', label: 'Tỉ lệ mở email', value: email.sent ? Math.round((email.opens / email.sent) * 1000) / 10 : 0, prev: emailPrev?.sent ? Math.round((emailPrev.opens / emailPrev.sent) * 1000) / 10 : null, unit: '%' });
    kpis.push({ id: 'email_click', label: 'Tỉ lệ bấm email', value: email.sent ? Math.round((email.clicks / email.sent) * 1000) / 10 : 0, prev: emailPrev?.sent ? Math.round((emailPrev.clicks / emailPrev.sent) * 1000) / 10 : null, unit: '%' });
    if (email.revenue) kpis.push({ id: 'email_revenue', label: 'Doanh thu từ email', value: Math.round(email.revenue), prev: emailPrev ? Math.round(emailPrev.revenue) : null, money: true });
  }
  const spend = total('spend', p), rev = total('revenue', p);
  if (spend && rev) kpis.push({ id: 'roas', label: 'ROAS quảng cáo', value: Math.round((rev / spend) * 100) / 100, prev: null });

  // daily series for the charts
  const daysList: string[] = []; for (let t = Date.parse(p.from); t <= Date.parse(p.to); t += 86400e3) daysList.push(new Date(t).toISOString().slice(0, 10));
  const series: Snapshot['series'] = [];
  for (const m of METRICS) {
    const pts = daysList.map((d) => ({ day: d, value: ds.reduce((s, x) => s + (x.days[d]?.[m.id] || 0), 0) }));
    if (pts.some((x) => x.value)) series.push({ id: m.id, label: m.label, points: pts });
  }
  series.unshift({ id: 'posts', label: 'Bài đã đăng', points: daysList.map((d) => ({ day: d, value: inRows.filter((r) => r.date === d && r.status === 'live').length })) });

  const snap: Snapshot = { title: `Báo cáo ${client.name} · ${p.label}`, period: p, createdAt: new Date().toISOString(), language: client.language || 'vi', kpis, content, email, series, sources: [...new Set(ds.map((d) => SOURCES.find((s) => s.id === d.source)?.label || d.source))], commentary: '' };
  return snap;
}

const ANALYST = `You are the account lead of a marketing agency writing the results report for a client. Plain, confident, specific; no fluff, no invented numbers: use only the data given. Write in the client's language (given). Markdown, at most 220 words:
**Điểm nổi bật** (2–4 bullets with numbers and the change vs the previous period),
**Chưa tốt** (1–3 bullets, honest, with the likely reason),
**Kế hoạch tiếp theo** (3 concrete actions for the next period: content, channel, email, budget).
Translate the three headings when the language is not Vietnamese. If a source is missing (e.g. no ads data), say what to connect or import, in one short line at the end.`;
export async function aiCommentary(client: Client, s: Snapshot): Promise<string> {
  const data = { period: s.period, kpis: s.kpis.map((k) => ({ label: k.label, value: k.value, prev: k.prev, unit: k.unit || (k.money ? 'money' : '') })), content: s.content, email: s.email && { ...s.email, campaigns: s.email.campaigns.slice(0, 10) }, sources: s.sources };
  return (await askClaude({ system: ANALYST, turns: [{ role: 'user', text: `Client: ${client.name}${client.industry ? ` (${client.industry})` : ''}. ${audienceLine(client)}\nData (JSON): ${JSON.stringify(data)}` }], maxTokens: 1500, effort: 'medium' })).trim();
}
export const reportsOf = (clientId: string) => ((cachedItems(clientId) || []).filter((i) => i.kind === 'report' && i.id !== 'metrics') as Item<Snapshot>[]).sort((a, b) => b.data.createdAt.localeCompare(a.data.createdAt));
export async function saveReport(clientId: string, s: Snapshot): Promise<Item<Snapshot>> { return putItem(clientId, 'report', `r_${s.period.from}_${s.period.to}`, s); }
