// "Ai mở · ai bấm · ai mua": one sent email, person by person. Opens and clicks come from the tracking pixel and the
// signed links; purchases are the orders the shop's order tag matched to this email (click id in the link, or the
// buyer's address), split into goods and booked services, with the link that sold each one.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { set, useStore } from '../store';
import { campaignPeople, type CampaignPeople, type CampaignPerson, type PersonOrder } from '../pipeline/mailServer';
import { downloadBytes } from '../../../src/ui/clipboard';
import { Btn, Modal, Seg } from './components';
import { peopleCsv, reportHtml, type CsvKind } from './campaignReport';
import { Icon } from './icons';

type Filter = 'all' | 'bought' | 'clicked' | 'opened' | 'unopened' | 'out';
const nf = (n: number) => n.toLocaleString('vi-VN');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '–');
const money = (v: number, cur = 'VND') => (cur === 'VND' ? `${Math.round(v).toLocaleString('vi-VN')}₫` : `${v.toLocaleString('vi-VN')} ${cur}`);
/** Always Vietnam time, whatever the viewer's computer is set to. */
const vn = (iso?: string | null, year = false) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', ...(year ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit' }) : '–');
const KIND: Record<string, string> = { product: 'Mua hàng', service: 'Dịch vụ', '': 'Đơn' };
const spent = (x: CampaignPerson) => x.orders.reduce((a, o) => a + (o.value || 0), 0);
const opened = (x: CampaignPerson) => x.opens > 0 || x.clicks > 0; // a click means the email was read even if images were blocked
const out = (x: CampaignPerson) => !!(x.unsubAt || x.bounced || x.status === 'failed');

/** A link's name: what it showed in the email (alt text / words, kept when sent), else utm_content, else host + path. */
export function linkLabel(url: string, label = ''): string {
  if (label) return label;
  try {
    const u = new URL(url); const c = u.searchParams.get('utm_content');
    if (c) { const t = c.replace(/[-_]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); }
    return (u.hostname.replace(/^www\./, '') + u.pathname).replace(/\/$/, '') || u.hostname;
  } catch { return url || '(link)'; }
}

export function PeopleModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const id = s.peopleOf;
  const [d, setD] = useState<CampaignPeople | null>(null);
  const [err, setErr] = useState('');
  const [f, setF] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(300);
  const lab = (i: number, url: string) => linkLabel(url, d?.campaign.labels?.[i] || '');
  const load = async () => { if (!id) return; try { setD(await campaignPeople(id)); setErr(''); } catch (e) { setErr((e as Error).message); } };
  useEffect(() => { setD(null); void load(); }, [id]);

  const all = d?.people || [];
  const counts = useMemo(() => ({ all: all.length, bought: all.filter((x) => x.orders.length).length, clicked: all.filter((x) => x.clicks).length, opened: all.filter(opened).length, unopened: all.filter((x) => !opened(x) && (x.status === 'sent' || x.status === 'unknown')).length, out: all.filter(out).length }), [d]);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return all
      .filter((x) => f === 'all' || (f === 'bought' ? x.orders.length > 0 : f === 'clicked' ? x.clicks > 0 : f === 'opened' ? opened(x) : f === 'unopened' ? !opened(x) && (x.status === 'sent' || x.status === 'unknown') : out(x)))
      .filter((x) => !t || x.email.includes(t) || x.name.toLowerCase().includes(t))
      .sort((a, b) => spent(b) - spent(a) || b.clicks - a.clicks || b.opens - a.opens || a.email.localeCompare(b.email));
  }, [d, f, q]);
  // which link brought clicks and which one sold
  const links = useMemo(() => {
    if (!d) return [];
    const m = new Map<number, { i: number; url: string; people: number; orders: number; revenue: number }>();
    const get = (i: number) => { let r = m.get(i); if (!r) { r = { i, url: d.campaign.links[i] || '', people: 0, orders: 0, revenue: 0 }; m.set(i, r); } return r; };
    for (const x of all) { for (const l of x.links) get(l.i).people++; for (const o of x.orders) if (o.link !== null && o.link !== undefined) { const r = get(o.link); r.orders++; r.revenue += o.value || 0; } }
    for (const o of d.lostOrders) if (o.link !== null && o.link !== undefined) { const r = get(o.link); r.orders++; r.revenue += o.value || 0; }
    return [...m.values()].sort((a, b) => b.revenue - a.revenue || b.people - a.people);
  }, [d]);

  const fileBase = () => (d ? (d.campaign.subject || d.campaign.id).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'chien-dich' : 'chien-dich');
  /** CSV for Excel / Google Sheets: openers, clickers (a column per link: how many times each person clicked it), everyone, or what is filtered now. */
  const csv = async (kind: CsvKind) => {
    if (!d) return;
    const name = { opened: 'nguoi-mo', clicked: 'nguoi-bam', all: 'tat-ca', rows: 'dang-loc' }[kind];
    await downloadBytes(`${fileBase()}-${name}.csv`, new TextEncoder().encode(peopleCsv(d, kind, rows)), 'text/csv');
  };
  /** The campaign report: a print-ready page (Save as PDF) opened in a new tab; downloaded as a file where tabs are blocked. */
  const report = async () => {
    if (!d) return;
    const html = reportHtml(d, s.user?.brand || 'Phloem Email');
    const w = window.open('', '_blank');
    if (w) { w.document.open(); w.document.write(html); w.document.close(); }
    else await downloadBytes(`${fileBase()}-bao-cao.html`, new TextEncoder().encode(html), 'text/html');
  };
  const toReports = () => { try { const k = 'phloem.aud.ui'; localStorage.setItem(k, JSON.stringify({ ...JSON.parse(localStorage.getItem(k) || '{}'), tab: 'reports' })); } catch { /* ignore */ } set({ modal: null, peopleOf: null, route: { name: 'audience' } }); };

  const t = d?.totals;
  const funnel = t ? [
    { label: 'Đã nhận', n: t.recipients, sub: t.failed ? `${nf(t.failed)} lỗi gửi` : d!.campaign.via === 'gmail' ? 'gửi qua Gmail' : 'gửi qua máy chủ' },
    { label: 'Đã mở', n: t.opened, sub: pct(t.opened, t.recipients) },
    { label: 'Bấm link', n: t.clicked, sub: pct(t.clicked, t.recipients) },
    { label: 'Đã mua', n: t.buyers, sub: t.orders ? `${nf(t.orders)} đơn · ${pct(t.buyers, t.clicked || t.recipients)} người bấm` : 'chưa có đơn' },
  ] : [];
  return (
    <Modal wide icon="mail" title="Ai mở · ai bấm · ai mua" onClose={onClose}
      footer={<><span class="dim small grow">Số mở là ước tính (Apple Mail tải ảnh trước); bấm và đơn hàng là số thật. Giờ Việt Nam.</span><Btn sm kind="ghost" onClick={() => void load()}>Làm mới</Btn>
        <details class="ppl-csv"><summary class="btn sm"><Icon name="download" size={14} /> Tải CSV</summary><div class="ppl-csv-menu">
          <button onClick={() => void csv('opened')}>Người mở <i>{d ? d.totals.opened : ''}</i></button>
          <button onClick={() => void csv('clicked')}>Người bấm + số lần bấm từng link <i>{d ? d.totals.clicked : ''}</i></button>
          <button onClick={() => void csv('all')}>Tất cả người nhận <i>{d ? d.people.length : ''}</i></button>
          <button onClick={() => void csv('rows')}>Đang lọc ở bảng <i>{rows.length}</i></button>
        </div></details>
        <Btn sm kind="primary" icon="external" disabled={!d} onClick={() => void report()} title="Trang báo cáo đầy đủ: in hoặc lưu PDF để gửi khách">Báo cáo (PDF)</Btn></>}>
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
      {!d ? !err && <div class="progress"><i class="indet" /></div> : (
        <div class="col ppl" style={{ gap: 14 }}>
          <div class="row wrap" style={{ gap: 8 }}>
            <b class="grow" style={{ fontSize: 15 }}>{d.campaign.subject || '(không tiêu đề)'}</b>
            <span class="chip">{d.campaign.via === 'gmail' ? 'Gmail' : 'máy chủ'}</span>
            <span class="dim small">{vn(d.campaign.at, true)}{d.campaign.list ? ` · ${d.campaign.list}${d.campaign.segment ? ` · ${d.campaign.segment}` : ''}` : ''}</span>
          </div>
          <div class="ppl-funnel">
            {funnel.map((x, i) => (
              <div key={x.label} class={`ppl-step ${i === 3 ? 'buy' : ''}`}>
                <span>{x.label}</span><b>{nf(x.n)}</b><i>{x.sub}</i>
                <div class="ppl-bar"><em style={{ width: `${t!.recipients ? Math.max(x.n ? 2 : 0, Math.min(100, (x.n / t!.recipients) * 100)) : 0}%` }} /></div>
              </div>
            ))}
            <div class="ppl-step rev"><span>Doanh thu từ mail này</span><b>{money(t!.revenue)}</b><i>{t!.orders ? `TB ${money(t!.revenue / t!.orders)} / đơn` : 'cần mã theo dõi đơn trên web'}</i></div>
          </div>
          {!t!.orders && <div class="check info"><span class="lv">ĐƠN HÀNG</span><span class="m">Chưa thấy đơn nào từ mail này. Để biết ai mua hàng hay đặt dịch vụ nhờ mail, gắn mã theo dõi đơn lên website (1 lần). <a href="#" onClick={(e) => { e.preventDefault(); toReports(); }}>Khán giả → Báo cáo → Mã theo dõi đơn</a></span></div>}
          {links.length > 0 && (
            <details open={links.some((l) => l.orders > 0)}>
              <summary class="small"><b>Link nào được bấm, link nào ra đơn</b> <span class="dim">({links.length})</span></summary>
              <div class="adm-table aud-table" style={{ marginTop: 8, maxHeight: 220 }}>
                <table>
                  <thead><tr><th>Link trong mail</th><th class="n">Người bấm</th><th class="n">Đơn</th><th class="n">Doanh thu</th></tr></thead>
                  <tbody>{links.map((l) => <tr key={l.i}><td title={l.url}><b>{lab(l.i, l.url)}</b> <span class="dim mono">{shortUrl(l.url)}</span></td><td class="n">{nf(l.people)}</td><td class="n">{l.orders || <span class="dim">0</span>}</td><td class="n">{l.revenue ? money(l.revenue) : <span class="dim">–</span>}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          )}
          <div class="row wrap" style={{ gap: 8 }}>
            <Seg value={f} onChange={(v) => { setF(v); setLimit(300); }} options={[
              { v: 'all', label: `Tất cả ${nf(counts.all)}` },
              { v: 'bought', label: `Đã mua ${nf(counts.bought)}` },
              { v: 'clicked', label: `Đã bấm ${nf(counts.clicked)}` },
              { v: 'opened', label: `Đã mở ${nf(counts.opened)}` },
              { v: 'unopened', label: `Chưa mở ${nf(counts.unopened)}` },
              { v: 'out', label: `Huỷ · lỗi ${nf(counts.out)}`, title: 'Huỷ đăng ký, thư dội, báo spam hoặc gửi lỗi' },
            ]} />
            <input class="in grow" style={{ minWidth: 200, height: 30 }} placeholder="Tìm email hoặc tên…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          </div>
          <div class="adm-table aud-table ppl-table">
            <table>
              <thead><tr><th>Người nhận</th><th>Mở mail</th><th>Bấm link</th><th>Đã mua</th><th>Trạng thái</th></tr></thead>
              <tbody>
                {!rows.length ? <tr><td colSpan={5} class="dim">{all.length ? 'Không có ai trong nhóm này.' : 'Chưa có dữ liệu người nhận cho mail này.'}</td></tr> : rows.slice(0, limit).map((x) => (
                  <tr key={x.email} class={x.orders.length ? 'ppl-buy' : ''}>
                    <td><div><b>{x.name || x.email}</b></div>{x.name && <div class="dim mono">{x.email}</div>}</td>
                    <td>{x.opens ? <><b>{x.opens}</b> lần<div class="dim mono">{vn(x.lastOpen)}</div></> : x.clicks ? <span title="Ảnh bị chặn nên không có lượt mở, nhưng đã bấm link">có</span> : <span class="dim">–</span>}</td>
                    <td class="ppl-wrap">{x.links.length ? x.links.sort((a, b) => b.n - a.n).map((l) => <span key={l.i} class="chip" title={`${l.url}\nlần cuối ${vn(l.last)}`}>{lab(l.i, l.url)}{l.n > 1 ? ` ×${l.n}` : ''}</span>) : <span class="dim">–</span>}</td>
                    <td class="ppl-wrap">{x.orders.length ? x.orders.map((o) => <OrderChip key={o.orderId} o={o} />) : <span class="dim">–</span>}</td>
                    <td><Status x={x} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && <div class="row"><span class="grow dim small">Đang hiện {nf(limit)} / {nf(rows.length)} người.</span><Btn xs onClick={() => setLimit(limit + 500)}>Hiện thêm</Btn></div>}
          {(t!.unknownOpens > 0 || t!.unknownClicks > 0) && <div class="dim small">+ {nf(t!.unknownOpens)} người mở, {nf(t!.unknownClicks)} người bấm không gọi tên được: mail gửi trước khi Phloem lưu danh sách người nhận.</div>}
          {d.lostOrders.length > 0 && <div class="dim small">+ {nf(d.lostOrders.length)} đơn ({money(d.lostOrders.reduce((a, o) => a + o.value, 0))}) khớp với mail này nhưng web không gửi email người mua.</div>}
        </div>
      )}
    </Modal>
  );
}

const shortUrl = (u: string) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname).replace(/\/$/, ''); } catch { return ''; } };
function OrderChip({ o }: { o: PersonOrder }) {
  return (
    <div class={`ppl-ord ${o.kind}`} title={`Mã đơn ${o.orderId}${o.clickedAt ? `\nbấm link lúc ${vn(o.clickedAt)}` : ''}${o.match === 'email' ? '\nkhớp theo email người mua (không có mã click)' : '\nkhớp mã click trong link email'}`}>
      <div class="row" style={{ gap: 6 }}><em>{KIND[o.kind] || 'Đơn'}</em><b class="grow">{money(o.value, o.currency)}</b><span class="dim mono">{vn(o.at)}</span></div>
      {o.items && <div class="ppl-items">{o.items}</div>}
    </div>
  );
}
function statusText(x: CampaignPerson): string {
  if (x.bounced) return x.bounced === 'complaint' ? 'báo spam' : 'thư dội';
  if (x.unsubAt) return 'huỷ đăng ký';
  return ({ sent: 'đã gửi', queued: 'chờ gửi', failed: 'lỗi gửi', skipped: 'bỏ qua (đã huỷ ĐK)', cancelled: 'huỷ gửi', unknown: 'đã nhận', '': '–' } as Record<string, string>)[x.status] || x.status;
}
function Status({ x }: { x: CampaignPerson }) {
  const t = statusText(x);
  if (x.bounced || x.status === 'failed') return <span class="chip warn" title={x.error || ''}>{t}</span>;
  if (x.unsubAt) return <span class="chip" title={vn(x.unsubAt, true)}>{t}</span>;
  return <span class="dim small" title={x.status === 'unknown' ? 'Gửi trước khi Phloem lưu danh sách người nhận' : ''}>{t}{x.sentAt && x.status === 'sent' ? ` · ${vn(x.sentAt)}` : ''}</span>;
}
