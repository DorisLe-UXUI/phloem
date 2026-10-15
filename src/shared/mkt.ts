// Phloem MKT pure planning logic (no DOM, no network): calendar slots, Vietnamese marketing dates, budget split that
// adds up to the cent, CSV and XLSX export. Shared so node tests can check it.
import { makeZip } from './zip';
import { utf8Bytes } from './hash';

export const ORGANIC_CHANNELS = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'google_business'];
/** Good default posting times per channel (Vietnam audiences); real insights override these later. */
export const BEST_TIME: Record<string, string[]> = {
  facebook: ['19:30', '12:00', '20:30'], instagram: ['20:00', '11:30', '21:00'], tiktok: ['20:30', '12:00', '18:30'],
  youtube: ['18:00', '20:00'], linkedin: ['09:00', '12:00'], google_business: ['10:00', '16:00'],
};

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };

/** 'YYYY-MM' of `n` consecutive months from the month of `start`. */
export function monthsFrom(start: string, n: number): string[] {
  const d = parse(start); const out: string[] = [];
  for (let i = 0; i < Math.max(1, Math.min(12, n)); i++) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + i, 1)); out.push(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`); }
  return out;
}
/** Calendar months a plan touches (a plan starting mid-month spans one more), with the share of days in each. */
export function planMonths(start: string, months: number): { month: string; days: number }[] {
  const end = planEnd(start, months);
  const out: { month: string; days: number }[] = [];
  for (let d = parse(start); iso(d) <= end; d = new Date(d.getTime() + 86400e3)) {
    const m = iso(d).slice(0, 7);
    if (!out.length || out[out.length - 1].month !== m) out.push({ month: m, days: 0 });
    out[out.length - 1].days++;
  }
  return out;
}
/** Last day covered by a plan of `months` months starting at `start` (inclusive). */
export function planEnd(start: string, months: number): string {
  const d = parse(start); return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.max(1, Math.min(12, months)), d.getUTCDate() - 1)));
}

/**
 * Split `total` over `weights` so the parts are multiples of `step` and add up to exactly `total`
 * (largest remainders get the leftover steps). Zero/negative weights get nothing; all-zero weights split evenly.
 */
export function allocate(total: number, weights: number[], step = 1000): number[] {
  if (!weights.length) return [];
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const share = sum > 0 ? w.map((x) => x / sum) : w.map(() => 1 / w.length);
  const units = Math.round(Math.max(0, total) / step);
  const raw = share.map((s) => s * units);
  const base = raw.map(Math.floor);
  let left = units - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, f: r - Math.floor(r) })).sort((a, b) => b.f - a.f || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i]++;
  const out = base.map((u) => u * step);
  out[out.length - 1] += Math.max(0, total) - units * step; // a total that is not a multiple of step keeps its tail
  return out;
}

/** Budget per month per channel. Month weights default to flat, channel weights to equal. Grand total is exact. */
export function planBudget(total: number, months: string[], channels: string[], monthWeights?: number[], channelWeights?: number[], step = 1000): Record<string, Record<string, number>> {
  const perMonth = allocate(total, monthWeights && monthWeights.length === months.length ? monthWeights : months.map(() => 1), step);
  const out: Record<string, Record<string, number>> = {};
  months.forEach((m, i) => {
    const parts = allocate(perMonth[i], channelWeights && channelWeights.length === channels.length ? channelWeights : channels.map(() => 1), step);
    out[m] = Object.fromEntries(channels.map((c, j) => [c, parts[j]]));
  });
  return out;
}

export interface MarketingDate { date: string; name: string }
const TET: Record<number, string> = { 2025: '2025-01-29', 2026: '2026-02-17', 2027: '2027-02-06', 2028: '2028-01-26', 2029: '2029-02-13', 2030: '2030-02-03' };
const MID_AUTUMN: Record<number, string> = { 2025: '2025-10-06', 2026: '2026-09-25', 2027: '2027-09-15', 2028: '2028-10-03', 2029: '2029-09-22', 2030: '2030-09-12' };
/** Dates Vietnamese brands plan around, between `from` and `to` (inclusive). */
export function vnMarketingDates(from: string, to: string): MarketingDate[] {
  const out: MarketingDate[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    const fixed: [string, string][] = [['01-01', 'Tết Dương lịch'], ['02-14', 'Valentine'], ['03-08', 'Quốc tế Phụ nữ 8/3'], ['04-30', 'Lễ 30/4'], ['05-01', 'Quốc tế Lao động 1/5'], ['06-01', 'Quốc tế Thiếu nhi 1/6'], ['09-02', 'Quốc khánh 2/9'], ['10-20', 'Phụ nữ Việt Nam 20/10'], ['10-31', 'Halloween'], ['11-11', 'Siêu sale 11.11'], ['11-20', 'Nhà giáo Việt Nam 20/11'], ['12-12', 'Siêu sale 12.12'], ['12-24', 'Giáng sinh']];
    for (const [md, name] of fixed) out.push({ date: `${y}-${md}`, name });
    for (let m = 1; m <= 12; m++) if (m !== 11 && m !== 12) out.push({ date: `${y}-${pad(m)}-${pad(m)}`, name: `Sale đôi ${m}.${m}` });
    if (TET[y]) out.push({ date: TET[y], name: 'Tết Nguyên đán' });
    if (MID_AUTUMN[y]) out.push({ date: MID_AUTUMN[y], name: 'Trung thu' });
    const nov1 = new Date(Date.UTC(y, 10, 1)); const firstFri = 1 + ((5 - nov1.getUTCDay() + 7) % 7);
    out.push({ date: `${y}-11-${pad(firstFri + 21)}`, name: 'Black Friday' });
  }
  const seen = new Set<string>();
  return out.filter((e) => e.date >= from && e.date <= to && !seen.has(e.date + e.name) && seen.add(e.date + e.name)).sort((a, b) => a.date.localeCompare(b.date));
}

export interface Slot { date: string; time: string; channel: string; month: string }
/**
 * Posting slots: `postsPerWeek` per organic channel, spread over the week (Mon-first pattern), channel-specific best
 * times rotating so a channel does not post at the same hour every time. Paid-only channels (Search, Display) get none.
 */
export function scheduleSlots(o: { start: string; months: number; postsPerWeek: number; channels: string[] }): Slot[] {
  const chans = o.channels.filter((c) => ORGANIC_CHANNELS.includes(c));
  const n = Math.max(1, Math.min(14, Math.round(o.postsPerWeek)));
  const pattern = WEEK_PATTERN[Math.min(7, n)] || WEEK_PATTERN[7];
  const end = planEnd(o.start, o.months);
  const out: Slot[] = [];
  const startD = parse(o.start);
  const monday = new Date(startD.getTime() - ((startD.getUTCDay() + 6) % 7) * 86400e3);
  const count: Record<string, number> = {};
  for (let w = monday; iso(w) <= end; w = new Date(w.getTime() + 7 * 86400e3)) {
    chans.forEach((c, ci) => {
      for (let k = 0; k < n; k++) {
        const dayOffset = (pattern[k % pattern.length] + ci) % 7;
        const d = iso(new Date(w.getTime() + dayOffset * 86400e3));
        if (d < o.start || d > end) continue;
        const times = BEST_TIME[c] || ['10:00'];
        const i = (count[c] = (count[c] || 0) + 1);
        out.push({ date: d, time: times[(i - 1) % times.length], channel: c, month: d.slice(0, 7) });
      }
    });
  }
  return out.sort((a, b) => (a.date + a.time + a.channel).localeCompare(b.date + b.time + b.channel));
}
const WEEK_PATTERN: Record<number, number[]> = { 1: [2], 2: [1, 4], 3: [0, 2, 4], 4: [0, 2, 4, 6], 5: [0, 1, 3, 4, 6], 6: [0, 1, 2, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] };

// ---------- export ----------
export interface Column { key: string; label: string; width?: number }
const cell = (v: unknown) => (v == null ? '' : String(v));
/** RFC 4180 CSV with a UTF-8 BOM so Excel shows Vietnamese correctly. */
export function toCsv(rows: Record<string, unknown>[], cols: Column[]): string {
  const q = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return '﻿' + [cols.map((c) => q(c.label)).join(','), ...rows.map((r) => cols.map((c) => q(cell(r[c.key]))).join(','))].join('\r\n');
}

const xml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i: number) => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
export interface Sheet { name: string; cols: Column[]; rows: Record<string, unknown>[]; /** row index → fill colour (hex without #) for grouping/status bands */ fills?: Record<number, string> }
/** Minimal Office Open XML workbook: bold frozen header, column widths, numbers as numbers, optional row fills. */
export function toXlsx(sheets: Sheet[]): Uint8Array {
  const te = { encode: utf8Bytes }; // shared code also runs in the Figma sandbox (no TextEncoder typings there)
  const fills = [...new Set(sheets.flatMap((s) => Object.values(s.fills || {})))];
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FF04140A"/><name val="Calibri"/></font></fonts><fills count="${3 + fills.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF39FF14"/></patternFill></fill>${fills.map((f) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${f.toUpperCase()}"/></patternFill></fill>`).join('')}</fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="${3 + fills.length * 2}"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf numFmtId="164" applyNumberFormat="1"/>${fills.map((_, i) => `<xf fillId="${3 + i}" applyFill="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="164" fillId="${3 + i}" applyFill="1" applyNumberFormat="1"/>`).join('')}</cellXfs></styleSheet>`;
  const sheetXml = (s: Sheet) => {
    const rowsXml = [`<row r="1">${s.cols.map((c, i) => `<c r="${colName(i)}1" t="inlineStr" s="1"><is><t>${xml(c.label)}</t></is></c>`).join('')}</row>`];
    s.rows.forEach((r, ri) => {
      const fi = s.fills?.[ri] ? fills.indexOf(s.fills[ri]) : -1;
      rowsXml.push(`<row r="${ri + 2}">${s.cols.map((c, ci) => {
        const v = r[c.key], ref = `${colName(ci)}${ri + 2}`;
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${fi >= 0 ? 4 + fi * 2 : 2}"><v>${v}</v></c>`;
        return `<c r="${ref}" t="inlineStr"${fi >= 0 ? ` s="${3 + fi * 2}"` : ''}><is><t xml:space="preserve">${xml(cell(v))}</t></is></c>`;
      }).join('')}</row>`);
    });
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><cols>${s.cols.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || 14}" customWidth="1"/>`).join('')}</cols><sheetData>${rowsXml.join('')}</sheetData>${s.rows.length ? `<autoFilter ref="A1:${colName(s.cols.length - 1)}${s.rows.length + 1}"/>` : ''}</worksheet>`;
  };
  const safe = (n: string, i: number) => (n.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31) || `Sheet${i + 1}`);
  const files = [
    { name: '[Content_Types].xml', data: te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xml(safe(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: te.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: te.encode(styles) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: te.encode(sheetXml(s)) })),
  ];
  return makeZip(files);
}

// ---------- import an existing content plan from a sheet ----------
export interface SheetPost { date: string; time: string; channel: string; format: string; topic: string; hook: string; caption: string; cta: string; hashtags: string; visual: string; status: string; pillar: string }
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\u0111/g, 'd').replace(/[^a-z0-9]+/g, ' ').trim();
const HEADERS: Record<keyof SheetPost, string[]> = {
  date: ['ngay', 'ngay dang', 'date', 'publish date', 'post date', 'ngay dang bai', 'thoi gian dang', 'day'],
  time: ['gio', 'gio dang', 'time', 'post time', 'khung gio'],
  channel: ['kenh', 'nen tang', 'channel', 'platform', 'mang xa hoi', 'network'],
  format: ['dinh dang', 'loai', 'format', 'type', 'post type', 'loai bai'],
  topic: ['chu de', 'tieu de', 'topic', 'title', 'subject', 'ten bai', 'y tuong', 'content idea', 'idea', 'headline'],
  hook: ['hook', 'cau mo', 'mo bai', 'opening'],
  caption: ['caption', 'noi dung', 'content', 'copy', 'bai viet', 'post copy', 'text', 'description', 'mo ta'],
  cta: ['cta', 'call to action', 'keu goi'],
  hashtags: ['hashtag', 'hashtags', 'tag', 'tags'],
  visual: ['hinh anh', 'y tuong hinh anh', 'visual', 'image', 'creative', 'design', 'thiet ke', 'brief anh', 'image idea'],
  status: ['trang thai', 'status', 'tinh trang', 'duyet', 'approval'],
  pillar: ['tru cot', 'pillar', 'content pillar', 'nhom noi dung', 'category', 'danh muc'],
};
/** Which column holds what: header synonyms in Vietnamese and English, accents and case ignored. */
export function mapSheetColumns(header: string[]): Partial<Record<keyof SheetPost, number>> {
  const out: Partial<Record<keyof SheetPost, number>> = {};
  const h = header.map(fold);
  for (const [key, names] of Object.entries(HEADERS) as [keyof SheetPost, string[]][]) {
    let idx = h.findIndex((x, i) => names.includes(x) && !Object.values(out).includes(i));
    if (idx < 0) idx = h.findIndex((x, i) => names.some((n) => n.length > 3 && x.startsWith(n)) && !Object.values(out).includes(i));
    if (idx >= 0) out[key] = idx;
  }
  return out;
}
/** A sheet date → YYYY-MM-DD. dd/mm/yyyy by default (Vietnam); mm/dd/yyyy when `usDates` or when the day cannot be a month. */
export function parseSheetDate(v: string, usDates = false, fallbackYear = new Date().getFullYear()): string {
  const s = String(v || '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2,4}))?/.exec(s);
  if (m) {
    let a = Number(m[1]), b = Number(m[2]); const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : fallbackYear;
    if (usDates && a <= 12 && b <= 31) [a, b] = [b, a]; else if (!usDates && b > 12 && a <= 12) [a, b] = [b, a];
    if (b < 1 || b > 12 || a < 1 || a > 31) return '';
    return `${y}-${String(b).padStart(2, '0')}-${String(a).padStart(2, '0')}`;
  }
  const t = Date.parse(s); if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return '';
}
export function normChannel(v: string): string {
  const s = fold(v);
  if (/\b(fb|facebook|meta)\b/.test(s)) return 'facebook';
  if (/\b(ig|insta|instagram)\b/.test(s)) return 'instagram';
  if (/tiktok|\btt\b/.test(s)) return 'tiktok';
  if (/youtube|\byt\b|shorts/.test(s)) return 'youtube';
  if (/linkedin|\bli\b/.test(s)) return 'linkedin';
  if (/business profile|gbp|google maps|google business/.test(s)) return 'google_business';
  if (/search|ads|google/.test(s)) return 'google_search';
  return 'facebook';
}
export function normFormat(v: string): string {
  const s = fold(v);
  if (/reel|short/.test(s)) return 'reel'; if (/carousel|album|nhieu anh/.test(s)) return 'carousel'; if (/story/.test(s)) return 'story';
  if (/video|clip/.test(s)) return 'video'; if (/article|blog|bai viet dai/.test(s)) return 'article'; if (/ads?\b|quang cao/.test(s)) return 'ad';
  return 'image';
}
export function normStatus(v: string, fallback = 'approved'): string {
  const s = fold(v);
  if (!s) return fallback;
  if (/da dang|posted|published|live|done/.test(s)) return 'live';
  if (/len lich|scheduled/.test(s)) return 'scheduled';
  if (/da duyet|approved|ok|duyet/.test(s)) return 'approved';
  if (/cho duyet|pending|review/.test(s)) return 'pending';
  if (/nhap|draft|todo|chua/.test(s)) return 'draft';
  return fallback;
}
/** Rows of a sheet (first row = header) → posts, or null when the columns cannot be recognised (then the AI maps them). */
export function postsFromSheet(rows: string[][], opts: { usDates?: boolean; fallbackStatus?: string } = {}): SheetPost[] | null {
  const hi = rows.findIndex((r) => { const m = mapSheetColumns(r); return m.date !== undefined && (m.topic !== undefined || m.caption !== undefined); });
  if (hi < 0) return null;
  const col = mapSheetColumns(rows[hi]);
  const get = (r: string[], k: keyof SheetPost) => (col[k] === undefined ? '' : String(r[col[k]!] ?? '').trim());
  const out: SheetPost[] = [];
  for (const r of rows.slice(hi + 1)) {
    const date = parseSheetDate(get(r, 'date'), opts.usDates);
    const topic = get(r, 'topic') || get(r, 'caption').split('\n')[0].slice(0, 120);
    if (!date || !topic) continue;
    const time = (/(\d{1,2})[:h](\d{2})?/.exec(get(r, 'time')) || [] as string[]);
    out.push({ date, time: time[1] ? `${time[1].padStart(2, '0')}:${(time[2] || '00').padStart(2, '0')}` : '19:30', channel: normChannel(get(r, 'channel')), format: normFormat(get(r, 'format')), topic, hook: get(r, 'hook'), caption: get(r, 'caption'), cta: get(r, 'cta'), hashtags: get(r, 'hashtags'), visual: get(r, 'visual'), status: normStatus(get(r, 'status'), opts.fallbackStatus), pillar: get(r, 'pillar') });
  }
  return out;
}
