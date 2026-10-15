// Báo cáo: list growth over time, campaign results (sent, open rate, click rate, unsubscribes).
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../../store';
import { createSite, orders as fetchOrders, reports, shopifyPixel, sites as fetchSites, tagSnippet, thankYouSnippet, type OrdersReport, type Report, type Site } from '../../pipeline/audience';
import { connectGA, gaConnected, gaEmailOrders, gaProperties, gaPropertyInfo, type GaOrder, type GaProperty } from '../../pipeline/ga4';
import { Btn, Seg } from '../components';
import { fmtDate, pct, type AudCtx } from './AudiencePage';

export function ReportsTab({ ctx }: { ctx: AudCtx }) {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<Report | null>(null);
  useEffect(() => { setR(null); void reports(ctx.client, days).then(setR).catch((e) => toast((e as Error).message, 'err')); }, [ctx.client, days]);
  if (!r) return <div class="card"><div class="progress"><i class="indet" /></div></div>;
  const subs = r.growth.reduce((a, g) => a + g.subscribed, 0), unsubs = r.growth.reduce((a, g) => a + g.unsubscribed, 0);
  const sent = r.campaigns.reduce((a, c) => a + c.sent, 0), opens = r.campaigns.reduce((a, c) => a + c.opens, 0), clicks = r.campaigns.reduce((a, c) => a + c.clicks, 0);
  const active = r.lists.reduce((a, l) => a + (l.counts.subscribed || 0), 0);
  const max = Math.max(1, ...r.growth.map((g) => Math.max(g.subscribed, g.unsubscribed)));
  const W = 720, H = 160, bw = W / r.growth.length;
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="row"><span class="grow small muted">Số liệu của mọi danh sách trong {ctx.client ? 'khách hàng này' : 'không gian cá nhân'}.</span><Seg value={days} options={[{ v: 7, label: '7 ngày' }, { v: 30, label: '30 ngày' }, { v: 90, label: '90 ngày' }]} onChange={setDays} /></div>
      <div class="aud-tiles" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div class="adm-tile"><span>Đang nhận</span><b>{active.toLocaleString('vi-VN')}</b><i>{r.lists.length} danh sách</i></div>
        <div class="adm-tile"><span>Đăng ký mới</span><b>+{subs.toLocaleString('vi-VN')}</b><i>{days} ngày</i></div>
        <div class="adm-tile"><span>Huỷ đăng ký</span><b>{unsubs.toLocaleString('vi-VN')}</b><i>{pct(unsubs, Math.max(1, active + unsubs))} danh sách</i></div>
        <div class="adm-tile"><span>Tỉ lệ mở</span><b>{pct(opens, sent)}</b><i>{sent.toLocaleString('vi-VN')} thư đã gửi</i></div>
        <div class="adm-tile"><span>Tỉ lệ click</span><b>{pct(clicks, sent)}</b><i>{clicks.toLocaleString('vi-VN')} người click</i></div>
      </div>
      <div class="card">
        <div class="row small"><b class="grow">Tăng trưởng danh sách</b><span class="row" style={{ gap: 10 }}><span><i class="aud-dot" style={{ background: 'var(--neon)' }} /> đăng ký</span><span><i class="aud-dot" style={{ background: 'var(--err)' }} /> huỷ</span></span></div>
        <svg viewBox={`0 0 ${W} ${H + 18}`} class="aud-chart" role="img" aria-label="Biểu đồ đăng ký và huỷ đăng ký theo ngày">
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--line-2)" />
          {r.growth.map((g, i) => {
            const up = (g.subscribed / max) * (H / 2 - 4), dn = (g.unsubscribed / max) * (H / 2 - 4);
            return <g key={g.day}><title>{`${fmtDate(g.day)}: +${g.subscribed} / -${g.unsubscribed}`}</title>
              {up > 0 && <rect x={i * bw + bw * 0.15} y={H / 2 - up} width={bw * 0.7} height={up} rx="2" fill="var(--neon)" />}
              {dn > 0 && <rect x={i * bw + bw * 0.15} y={H / 2} width={bw * 0.7} height={dn} rx="2" fill="var(--err)" />}
            </g>;
          })}
          <text x="0" y={H + 14} fill="var(--dim)" font-size="10">{fmtDate(r.growth[0]?.day)}</text>
          <text x={W} y={H + 14} fill="var(--dim)" font-size="10" text-anchor="end">{fmtDate(r.growth[r.growth.length - 1]?.day)}</text>
        </svg>
      </div>
      <div class="adm-table aud-table">
        <table>
          <thead><tr><th>Chiến dịch</th><th>Gửi tới</th><th class="n">Đã gửi</th><th class="n">Mở</th><th class="n">Click</th><th class="n">Huỷ ĐK</th><th class="n">Đơn</th><th class="n">Doanh thu</th><th>Ngày</th></tr></thead>
          <tbody>
            {!r.campaigns.length ? <tr><td colSpan={9} class="dim">Chưa có chiến dịch gửi qua máy chủ. Mở một email → Xuất → Gửi bằng email thường → Máy chủ gửi → chọn danh sách.</td></tr>
              : r.campaigns.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.subject || '(không tiêu đề)'}</b>{c.status !== 'done' && <span class="chip" style={{ marginLeft: 6 }}>{c.status}</span>}</td>
                  <td class="dim">{c.list || 'danh sách dán tay'}{c.segment ? ` · ${c.segment}` : ''}</td>
                  <td class="n">{c.sent.toLocaleString('vi-VN')}</td>
                  <td class="n">{pct(c.opens, c.sent)}</td>
                  <td class="n">{pct(c.clicks, c.sent)}</td>
                  <td class="n">{c.unsubscribes}</td>
                  <td class="n">{c.orders || <span class="dim">0</span>}</td>
                  <td class="n">{c.revenue ? money(c.revenue) : <span class="dim">–</span>}</td>
                  <td class="dim">{fmtDate(c.at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div class="dim small">Tỉ lệ mở là ước tính: Apple Mail tải trước ảnh nên có thể tính cả người chưa đọc; click chính xác hơn.</div>
      <OrdersSection ctx={ctx} days={days} />
      <Ga4Section ctx={ctx} days={days} />
    </div>
  );
}

const money = (v: number, cur = 'VND') => (cur === 'VND' ? `${Math.round(v).toLocaleString('vi-VN')}₫` : `${v.toLocaleString('vi-VN')} ${cur}`);
/** Always Vietnam time, whatever the viewer's computer is set to. */
const vnTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Đã copy.', 'ok'); } catch { toast('Chọn và copy tay.', 'err'); } };

/** Orders reported by the shop's order tag, each matched (or not) to the email click before it. */
function OrdersSection({ ctx, days }: { ctx: AudCtx; days: number }) {
  const [o, setO] = useState<OrdersReport | null>(null);
  const [site, setSite] = useState<Site | null | undefined>(undefined);
  const [relay, setRelay] = useState('');
  const [show, setShow] = useState(false);
  const [only, setOnly] = useState<'all' | 'email'>('all');
  const load = async () => { try { const [a, b] = await Promise.all([fetchOrders(ctx.client, days), fetchSites(ctx.client)]); setO(a); setSite(b.sites[0] || null); setRelay(b.relay); } catch (e) { toast((e as Error).message, 'err'); } };
  useEffect(() => { void load(); }, [ctx.client, days]);
  const make = async () => { try { const r = await createSite(ctx.client, 'Website'); setSite(r.site); setShow(true); } catch (e) { toast((e as Error).message, 'err'); } };
  const t = o?.totals;
  const rows = (o?.orders || []).filter((x) => only === 'all' || x.match);
  return (
    <div class="card col" style={{ gap: 10 }}>
      <div class="row"><b class="grow">Đơn hàng từ email</b>{site && <Btn xs kind="ghost" onClick={() => setShow(!show)}>{show ? 'Ẩn mã theo dõi' : 'Mã theo dõi đơn'}</Btn>}<Btn xs kind="ghost" onClick={() => void load()}>Làm mới</Btn></div>
      {site === null && (
        <div class="col" style={{ gap: 6 }}>
          <div class="small muted">Gắn mã theo dõi vào website để biết đơn nào thật sự đến từ email nào: mỗi link trong email mang một mã click riêng; khi khách đặt hàng, trang cảm ơn gửi đơn về đây và Phloem khớp đúng người, đúng chiến dịch (trong {o?.attributionDays || 7} ngày sau khi click).</div>
          {ctx.canWrite && <div><Btn sm kind="primary" onClick={() => void make()}>Tạo mã theo dõi cho website</Btn></div>}
        </div>
      )}
      {site && show && (
        <div class="col" style={{ gap: 8 }}>
          <div class="small"><b>1. Mọi trang</b> <span class="dim">(Shopify: theme.liquid · Haravan/Sapo: Giao diện → chèn mã · WordPress: footer)</span></div>
          <textarea class="in mono" readOnly style={{ height: 120, padding: 8, fontSize: 10.5 }} value={tagSnippet(relay, site.key)} onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
          <div class="row"><span class="grow" /><Btn xs onClick={() => void copy(tagSnippet(relay, site.key))}>Copy</Btn></div>
          <div class="small"><b>2. Trang cảm ơn sau khi đặt hàng</b> <span class="dim">thay MÃ_ĐƠN, TỔNG_TIỀN, EMAIL_KHÁCH bằng biến của nền tảng (WooCommerce: $order-&gt;get_order_number(), get_total(), get_billing_email())</span></div>
          <textarea class="in mono" readOnly style={{ height: 60, padding: 8, fontSize: 10.5 }} value={thankYouSnippet} />
          <div class="small"><b>Shopify</b> <span class="dim">bước 2 thay bằng Cài đặt → Sự kiện khách hàng → Thêm pixel tuỳ chỉnh, dán đoạn này:</span></div>
          <textarea class="in mono" readOnly style={{ height: 150, padding: 8, fontSize: 10.5 }} value={shopifyPixel(relay, site.key)} onClick={(e) => (e.target as HTMLTextAreaElement).select()} />
          <div class="row"><span class="grow" /><Btn xs onClick={() => void copy(shopifyPixel(relay, site.key))}>Copy pixel Shopify</Btn></div>
        </div>
      )}
      {t && (
        <div class="aud-tiles">
          <div class="adm-tile hot"><span>Doanh thu từ email</span><b>{money(t.emailRevenue)}</b><i>{days} ngày</i></div>
          <div class="adm-tile"><span>Đơn từ email</span><b>{t.emailOrders}</b><i>trong {t.orders} đơn ghi nhận</i></div>
          <div class="adm-tile"><span>Tỉ lệ đơn từ email</span><b>{pct(t.emailOrders, t.orders)}</b><i>{money(t.revenue)} tổng</i></div>
          <div class="adm-tile"><span>Giá trị TB / đơn email</span><b>{t.emailOrders ? money(t.emailRevenue / t.emailOrders) : '–'}</b><i>giờ Việt Nam</i></div>
        </div>
      )}
      {o && o.orders.length > 0 && (
        <>
          <div class="row"><Seg value={only} options={[{ v: 'all', label: `Tất cả · ${o.orders.length}` }, { v: 'email', label: `Từ email · ${t!.emailOrders}` }]} onChange={setOnly} /></div>
          <div class="adm-table aud-table">
            <table>
              <thead><tr><th>Thời gian (giờ VN)</th><th>Mã đơn</th><th class="n">Giá trị</th><th>Từ email?</th><th>Người mua</th><th>Bấm link lúc</th></tr></thead>
              <tbody>{rows.map((x) => (
                <tr key={x.orderId}>
                  <td class="mono">{vnTime(x.at)}</td>
                  <td class="mono">{x.orderId}</td>
                  <td class="n">{money(x.value, x.currency)}</td>
                  <td>{x.match === 'click' ? <span class="chip on" title="Khớp mã click trong link email">Có · {x.subject || x.campaign}</span> : x.match === 'email' ? <span class="chip" title="Không có mã click; khớp theo email người mua đã bấm link">Có (theo email) · {x.subject || x.campaign}</span> : <span class="chip warn">Không</span>}</td>
                  <td class="mono dim">{x.email || '–'}</td>
                  <td class="mono dim">{x.clickedAt ? vnTime(x.clickedAt) : '–'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
      {o && !o.orders.length && site && <div class="dim small">Chưa có đơn nào được ghi nhận trong {days} ngày. Sau khi gắn mã, đặt thử một đơn để kiểm tra.</div>}
    </div>
  );
}

/** Purchases Google Analytics attributes to email (utm_medium=email), read with the viewer's Google account. */
function Ga4Section({ ctx, days }: { ctx: AudCtx; days: number }) {
  const key = `phloem.ga4.${ctx.client || 'me'}`;
  const [props, setProps] = useState<GaProperty[] | null>(null);
  const [pid, setPid] = useState(() => { try { return localStorage.getItem(key) || ''; } catch { return ''; } });
  const [rows, setRows] = useState<GaOrder[] | null>(null);
  const [tzInfo, setTz] = useState<{ timeZone: string; currencyCode: string } | null>(null);
  const [err, setErr] = useState<{ msg: string; link?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setErr(null); setBusy(true); try { await fn(); } catch (e) { setErr({ msg: (e as Error).message, link: (e as { link?: string }).link }); } finally { setBusy(false); } };
  const connect = () => run(async () => { await connectGA(); const p = await gaProperties(); setProps(p); if (!pid && p[0]) setPid(p[0].id); });
  const pull = (id = pid) => run(async () => { const [info, r] = await Promise.all([gaPropertyInfo(id), gaEmailOrders(id, days)]); setTz(info); setRows(r); try { localStorage.setItem(key, id); } catch { /* ignore */ } });
  return (
    <div class="card col" style={{ gap: 10 }}>
      <div class="row"><b class="grow">Google Analytics 4</b>{gaConnected() ? <span class="chip on">đã kết nối</span> : <Btn xs kind="primary" disabled={busy} onClick={() => void connect()}>Kết nối Google Analytics</Btn>}</div>
      <div class="small muted">Đọc các đơn mua mà GA4 ghi nhận từ nguồn email (utm_medium=email, Phloem tự gắn vào mọi link). Chỉ đọc, dùng tài khoản Google của bạn, không lưu trên máy chủ.</div>
      {props && (
        <div class="row" style={{ gap: 6 }}>
          <select class="in" style={{ maxWidth: 360 }} value={pid} onChange={(e) => setPid((e.target as HTMLSelectElement).value)}>{props.map((p) => <option key={p.id} value={p.id}>{p.account} · {p.name}</option>)}</select>
          <Btn sm disabled={!pid || busy} onClick={() => void pull()}>{busy ? 'Đang đọc…' : 'Xem đơn từ email'}</Btn>
        </div>
      )}
      {props && !props.length && <div class="dim small">Tài khoản Google này chưa có property GA4 nào.</div>}
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err.msg}{err.link && <> <a href={err.link} target="_blank" rel="noopener">Bật API (1 lần, cần chủ dự án Google)</a></>}</span></div>}
      {rows && (
        <div class="adm-table aud-table">
          <table>
            <thead><tr><th>Thời gian ({tzInfo?.timeZone || 'giờ property'})</th><th>Mã đơn</th><th>Chiến dịch</th><th>Nguồn / phương tiện</th><th class="n">Doanh thu</th></tr></thead>
            <tbody>{!rows.length ? <tr><td colSpan={5} class="dim">GA4 chưa ghi nhận đơn nào từ email trong {days} ngày (GA4 cần 24–48 giờ để xử lý dữ liệu).</td></tr> : rows.map((x) => (
              <tr key={x.transactionId + x.at}><td class="mono">{x.at}</td><td class="mono">{x.transactionId}</td><td>{x.campaign}</td><td class="dim">{x.sourceMedium}</td><td class="n">{money(x.revenue, tzInfo?.currencyCode)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
