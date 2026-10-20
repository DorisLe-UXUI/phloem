// A sent campaign as a report you can hand to a client (print → PDF) and as CSV files (openers, clickers with how many
// times each link was clicked, everyone). Everything is computed from the per-person report; times are Vietnam time.
import type { CampaignPeople, CampaignPerson } from '../pipeline/mailServer';

const nf = (n: number) => Math.round(n).toLocaleString('vi-VN');
const pct = (a: number, b: number) => (b > 0 ? `${(Math.round((a / b) * 1000) / 10).toLocaleString('vi-VN')}%` : '–');
const money = (v: number, cur = 'VND') => (cur === 'VND' ? `${Math.round(v).toLocaleString('vi-VN')}₫` : `${v.toLocaleString('vi-VN')} ${cur}`);
const vn = (iso?: string | null, year = true) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', ...(year ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' }) : '');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const spent = (x: CampaignPerson) => x.orders.reduce((a, o) => a + (o.value || 0), 0);
const read = (x: CampaignPerson) => x.opens > 0 || x.clicks > 0;

/** A link's name: what it showed in the email, else utm_content, else host + path. */
export function labelOf(d: CampaignPeople, i: number, url: string): string {
  const l = d.campaign.labels?.[i]; if (l) return l;
  try { const u = new URL(url); const c = u.searchParams.get('utm_content'); if (c) { const t = c.replace(/[-_]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); } return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, ''); } catch { return url || '(link)'; }
}

export interface LinkRow { i: number; label: string; url: string; people: number; clicks: number; orders: number; revenue: number }
export function linkRows(d: CampaignPeople): LinkRow[] {
  const m = new Map<number, LinkRow>();
  const get = (i: number) => { let r = m.get(i); if (!r) { const url = d.campaign.links[i] || ''; r = { i, label: labelOf(d, i, url), url, people: 0, clicks: 0, orders: 0, revenue: 0 }; m.set(i, r); } return r; };
  for (const x of d.people) { for (const l of x.links) { const r = get(l.i); r.people++; r.clicks += l.n; } for (const o of x.orders) if (o.link !== null && o.link !== undefined) { const r = get(o.link); r.orders++; r.revenue += o.value || 0; } }
  for (const o of d.lostOrders) if (o.link !== null && o.link !== undefined) { const r = get(o.link); r.orders++; r.revenue += o.value || 0; }
  return [...m.values()].sort((a, b) => b.clicks - a.clicks || b.revenue - a.revenue);
}

/** Plain-language findings a marketer would write under the numbers. */
export function insights(d: CampaignPeople): string[] {
  const t = d.totals, out: string[] = [];
  const openRate = t.recipients ? t.opened / t.recipients : 0, clickRate = t.recipients ? t.clicked / t.recipients : 0;
  if (t.recipients) out.push(`Tỉ lệ mở ${pct(t.opened, t.recipients)}: ${openRate >= 0.4 ? 'cao hơn' : openRate >= 0.25 ? 'quanh' : 'thấp hơn'} mức thường gặp của email marketing (khoảng 25–40%; số mở bị Apple Mail đẩy lên nên chỉ tham khảo).`);
  if (t.recipients) out.push(`Tỉ lệ bấm ${pct(t.clicked, t.recipients)} (${pct(t.clicked, t.opened)} số người mở): ${clickRate >= 0.03 ? 'tốt, nội dung kéo được hành động' : clickRate >= 0.01 ? 'trung bình' : 'thấp: thử nút bấm rõ hơn, đặt sớm hơn trong màn đầu'}.`);
  const links = linkRows(d);
  if (links[0]) out.push(`Link được bấm nhiều nhất: "${links[0].label}" (${nf(links[0].clicks)} lượt, ${nf(links[0].people)} người)${links[0].revenue ? `, mang về ${money(links[0].revenue)}` : ''}.`);
  const peak = [...d.timeline].sort((a, b) => b.openers - a.openers)[0];
  if (peak && peak.openers) { const [day, hh] = peak.h.split('T'); out.push(`Nhiều người mở nhất lúc ${Number(hh)}h–${Number(hh) + 1}h ngày ${day.split('-').reverse().slice(0, 2).join('/')} (${nf(peak.openers)} người): cân nhắc gửi lần sau vào khung giờ này.`); }
  const hot = d.people.filter((x) => x.opens >= 3 || x.clicks >= 2);
  if (hot.length) out.push(`${nf(hot.length)} người mở từ 3 lần hoặc bấm từ 2 lần trở lên: đây là khách đang quan tâm, nên liên hệ trực tiếp hoặc gửi ưu đãi riêng.`);
  const notOpened = d.people.filter((x) => !read(x) && (x.status === 'sent' || x.status === 'unknown')).length;
  if (notOpened && t.recipients) out.push(`${nf(notOpened)} người (${pct(notOpened, t.recipients)}) chưa mở: có thể gửi lại sau 2–3 ngày với tiêu đề khác.`);
  if (t.orders) out.push(`${nf(t.buyers)} người mua, ${nf(t.orders)} đơn, doanh thu ${money(t.revenue)} (trung bình ${money(t.revenue / t.orders)} mỗi đơn).`);
  else out.push('Chưa ghi nhận đơn nào từ email này (cần mã theo dõi đơn trên website để thấy doanh thu).');
  if (t.unsubscribed || t.bounced) out.push(`${nf(t.unsubscribed)} người huỷ đăng ký, ${nf(t.bounced)} thư dội: ${t.recipients && (t.unsubscribed + t.bounced) / t.recipients > 0.02 ? 'cao, nên làm sạch danh sách và xem lại nội dung' : 'ở mức bình thường'}.`);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// CSV (UTF-8 with BOM so Excel reads Vietnamese)
const cell = (v: unknown) => { const x = String(v ?? ''); return /[",\n\r]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; };
const csvOf = (rows: unknown[][]) => '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
const status = (x: CampaignPerson) => (x.bounced ? (x.bounced === 'complaint' ? 'báo spam' : 'thư dội') : x.unsubAt ? 'huỷ đăng ký' : ({ sent: 'đã gửi', queued: 'chờ gửi', failed: 'lỗi gửi', skipped: 'bỏ qua', cancelled: 'huỷ gửi', unknown: 'đã nhận' } as Record<string, string>)[x.status] || x.status);
export type CsvKind = 'opened' | 'clicked' | 'all' | 'rows';
/** One row per person; clickers get one column per link with how many times they clicked it. */
export function peopleCsv(d: CampaignPeople, kind: CsvKind, rows?: CampaignPerson[]): string {
  const list = (kind === 'rows' && rows ? rows : d.people.filter((x) => kind === 'all' || (kind === 'opened' ? read(x) : x.clicks > 0)))
    .slice().sort((a, b) => b.clicks - a.clicks || b.opens - a.opens || a.email.localeCompare(b.email));
  const links = linkRows(d);
  const head = ['Email', 'Tên', 'Trạng thái', 'Số lần mở', 'Mở lần đầu (giờ VN)', 'Mở lần cuối (giờ VN)', 'Số lần bấm', 'Bấm lần cuối (giờ VN)', ...(kind === 'opened' ? [] : links.map((l) => `Bấm: ${l.label}`)), 'Số đơn', 'Đã chi (VND)', 'Mua gì'];
  const body = list.map((x) => {
    const per = new Map(x.links.map((l) => [l.i, l.n]));
    return [x.email, x.name, status(x), x.opens, vn(x.firstOpen), vn(x.lastOpen), x.clicks, vn(x.lastClick), ...(kind === 'opened' ? [] : links.map((l) => per.get(l.i) || 0)), x.orders.length, spent(x), x.orders.map((o) => o.items || o.orderId).join(' | ')];
  });
  return csvOf([head, ...body]);
}
/** Every campaign in Báo cáo as one sheet. */
export function campaignsCsv(rows: { subject: string; via?: string; list: string; segment: string; sent: number; opens: number; clicks: number; unsubscribes: number; buyers?: number; orders: number; revenue: number; at: string }[]): string {
  return csvOf([['Chiến dịch', 'Gửi qua', 'Gửi tới', 'Ngày gửi (giờ VN)', 'Đã gửi', 'Người mở', 'Tỉ lệ mở', 'Người bấm', 'Tỉ lệ bấm', 'Huỷ ĐK', 'Người mua', 'Đơn', 'Doanh thu (VND)'],
    ...rows.map((c) => [c.subject, c.via === 'gmail' ? 'Gmail' : 'Máy chủ', [c.list, c.segment].filter(Boolean).join(' · '), vn(c.at), c.sent, c.opens, c.sent ? pct(c.opens, c.sent) : '', c.clicks, c.sent ? pct(c.clicks, c.sent) : '', c.unsubscribes, c.buyers || 0, c.orders, Math.round(c.revenue)])]);
}

// ---------------------------------------------------------------------------------------------------------------
/** A standalone, print-ready report (A4, light): open it in a tab and save as PDF, or send the file. */
export function reportHtml(d: CampaignPeople, brand = 'Phloem Email'): string {
  const t = d.totals, c = d.campaign, links = linkRows(d).slice(0, 12);
  const top = d.people.filter((x) => x.clicks || x.opens).sort((a, b) => b.clicks - a.clicks || b.opens - a.opens).slice(0, 20);
  const buyers = d.people.filter((x) => x.orders.length).sort((a, b) => spent(b) - spent(a)).slice(0, 20);
  // activity chart: up to the first 72 hours by hour, else by day
  let series = d.timeline.map((x) => ({ k: x.h, label: `${Number(x.h.slice(11))}h`, day: x.h.slice(5, 10).split('-').reverse().join('/'), openers: x.openers, clicks: x.clicks }));
  if (series.length > 72) { const by = new Map<string, { k: string; label: string; day: string; openers: number; clicks: number }>(); for (const s of series) { const k = s.k.slice(0, 10); const r = by.get(k) || { k, label: s.day, day: s.day, openers: 0, clicks: 0 }; r.openers += s.openers; r.clicks += s.clicks; by.set(k, r); } series = [...by.values()]; }
  const W = 700, H = 150, bw = series.length ? W / series.length : W, max = Math.max(1, ...series.map((s) => Math.max(s.openers, s.clicks)));
  const chart = series.length ? `<svg viewBox="0 0 ${W} ${H + 22}" width="100%" role="img" aria-label="Mở và bấm theo thời gian">${series.map((s, i) => {
    const ho = (s.openers / max) * H, hc = (s.clicks / max) * H, x = i * bw;
    return `<rect x="${x + bw * 0.12}" y="${H - ho}" width="${bw * 0.38}" height="${ho}" fill="#7aa7d6"><title>${esc(`${s.day} ${s.label}: ${s.openers} người mở`)}</title></rect><rect x="${x + bw * 0.5}" y="${H - hc}" width="${bw * 0.38}" height="${hc}" fill="#1f7a4d"><title>${esc(`${s.day} ${s.label}: ${s.clicks} lượt bấm`)}</title></rect>`;
  }).join('')}<line x1="0" x2="${W}" y1="${H}" y2="${H}" stroke="#ccc"/><text x="0" y="${H + 16}" font-size="10" fill="#777">${esc(series[0].day)} ${esc(series[0].label)}</text><text x="${W}" y="${H + 16}" font-size="10" fill="#777" text-anchor="end">${esc(series[series.length - 1].day)} ${esc(series[series.length - 1].label)}</text></svg>` : '<p class="muted">Chưa có lượt mở hay bấm nào.</p>';
  const tile = (k: string, v: string, sub = '') => `<div class="tile"><span>${esc(k)}</span><b>${esc(v)}</b>${sub ? `<i>${esc(sub)}</i>` : ''}</div>`;
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Báo cáo · ${esc(c.subject)}</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;background:#f4f5f3;color:#141714;font:13px/1.5 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:820px;margin:24px auto;background:#fff;padding:32px 36px;border-radius:14px;box-shadow:0 10px 30px -18px rgba(0,0,0,.3)}
header{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #141714;padding-bottom:14px;margin-bottom:18px}
h1{font-size:22px;line-height:1.25;margin:4px 0 6px}h2{font-size:14px;letter-spacing:.06em;text-transform:uppercase;margin:26px 0 10px;color:#1f7a4d}
.eyebrow{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#777}.muted{color:#777}
.tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.tile{border:1px solid #e3e5e1;border-radius:10px;padding:10px 12px}
.tile span{display:block;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:#777}.tile b{display:block;font-size:20px;margin-top:2px}.tile i{font-style:normal;color:#777;font-size:11.5px}
table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#777;border-bottom:1px solid #ddd;padding:6px 8px}
td{border-bottom:1px solid #eee;padding:6px 8px;vertical-align:top}td.n,th.n{text-align:right;white-space:nowrap}
ul.ins{margin:0;padding-left:18px}ul.ins li{margin:4px 0}.legend span{display:inline-flex;align-items:center;gap:6px;margin-right:14px;font-size:11.5px;color:#555}.legend i{width:10px;height:10px;border-radius:2px;display:inline-block}
.bar{position:sticky;top:0;background:#141714;color:#fff;padding:10px 16px;display:flex;gap:10px;justify-content:center;font:600 13px system-ui}.bar button{font:inherit;padding:8px 16px;border-radius:999px;border:0;background:#39ff14;color:#0a0f0c;cursor:pointer}
footer{margin-top:24px;padding-top:10px;border-top:1px solid #eee;font-size:11px;color:#999;display:flex;justify-content:space-between}
@media print{body{background:#fff}main{box-shadow:none;margin:0;padding:0;max-width:none}.bar{display:none}h2{break-after:avoid}tr{break-inside:avoid}}
@media (max-width:640px){.tiles{grid-template-columns:repeat(2,1fr)}main{padding:20px}}
</style></head><body>
<div class="bar">Báo cáo chiến dịch email <button onclick="print()">In / Lưu PDF</button></div>
<main>
<header><div><div class="eyebrow">Báo cáo chiến dịch email</div><h1>${esc(c.subject || '(không tiêu đề)')}</h1><div class="muted">${esc(c.from)}${c.from ? ' · ' : ''}gửi ${esc(vn(c.at))} · ${c.via === 'gmail' ? 'qua Gmail' : 'qua máy chủ gửi'}${c.list ? ` · ${esc(c.list)}${c.segment ? ` · ${esc(c.segment)}` : ''}` : ''}</div></div><div class="muted" style="text-align:right;white-space:nowrap">${esc(brand)}<br>lập ${esc(vn(new Date().toISOString()))}</div></header>
<div class="tiles">
${tile('Đã nhận', nf(t.recipients), t.failed ? `${nf(t.failed)} lỗi gửi` : '')}
${tile('Người mở', nf(t.opened), pct(t.opened, t.recipients))}
${tile('Tổng lượt mở', nf(t.totalOpens), t.opened ? `${(t.totalOpens / t.opened).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} lần / người` : '')}
${tile('Người bấm', nf(t.clicked), pct(t.clicked, t.recipients))}
${tile('Tổng lượt bấm', nf(t.totalClicks), `${pct(t.clicked, t.opened)} người mở có bấm`)}
${tile('Người mua', nf(t.buyers), t.orders ? `${nf(t.orders)} đơn` : 'chưa có đơn')}
${tile('Doanh thu', money(t.revenue), t.orders ? `TB ${money(t.revenue / t.orders)} / đơn` : '')}
${tile('Huỷ ĐK · thư dội', `${nf(t.unsubscribed)} · ${nf(t.bounced)}`, pct(t.unsubscribed + t.bounced, t.recipients))}
</div>
<h2>Nhận xét</h2><ul class="ins">${insights(d).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<h2>Mở và bấm theo thời gian <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">(giờ Việt Nam)</span></h2>
<div class="legend"><span><i style="background:#7aa7d6"></i>người mở</span><span><i style="background:#1f7a4d"></i>lượt bấm</span></div>${chart}
<h2>Link được bấm</h2>${links.length ? `<table><thead><tr><th>Link</th><th class="n">Người bấm</th><th class="n">Lượt bấm</th><th class="n">Đơn</th><th class="n">Doanh thu</th></tr></thead><tbody>${links.map((l) => `<tr><td><b>${esc(l.label)}</b><br><span class="muted">${esc(l.url.replace(/^https?:\/\//, '').slice(0, 80))}</span></td><td class="n">${nf(l.people)}</td><td class="n">${nf(l.clicks)}</td><td class="n">${l.orders || '–'}</td><td class="n">${l.revenue ? money(l.revenue) : '–'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Chưa có ai bấm link.</p>'}
<h2>Người quan tâm nhất <span class="muted" style="text-transform:none;letter-spacing:0;font-weight:400">(top ${top.length})</span></h2>${top.length ? `<table><thead><tr><th>Người nhận</th><th class="n">Lượt mở</th><th class="n">Lượt bấm</th><th>Đã bấm</th><th>Mở lần cuối</th></tr></thead><tbody>${top.map((x) => `<tr><td>${esc(x.name || x.email)}${x.name ? `<br><span class="muted">${esc(x.email)}</span>` : ''}</td><td class="n">${x.opens}</td><td class="n">${x.clicks}</td><td>${x.links.map((l) => `${esc(labelOf(d, l.i, l.url))}${l.n > 1 ? ` ×${l.n}` : ''}`).join(', ') || '–'}</td><td>${esc(vn(x.lastOpen, false)) || '–'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Chưa có ai mở hay bấm.</p>'}
${buyers.length ? `<h2>Người mua</h2><table><thead><tr><th>Người mua</th><th>Mua gì</th><th class="n">Đơn</th><th class="n">Giá trị</th></tr></thead><tbody>${buyers.map((x) => `<tr><td>${esc(x.name || x.email)}${x.name ? `<br><span class="muted">${esc(x.email)}</span>` : ''}</td><td>${esc(x.orders.map((o) => o.items || (o.kind === 'service' ? 'Dịch vụ' : 'Đơn hàng')).join(', '))}</td><td class="n">${x.orders.length}</td><td class="n">${money(spent(x))}</td></tr>`).join('')}</tbody></table>` : ''}
<footer><span>Số mở là ước tính (Apple Mail tải ảnh trước); lượt bấm và đơn hàng là số thật.</span><span>Phloem Email</span></footer>
</main></body></html>`;
}
