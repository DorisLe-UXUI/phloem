// Báo cáo tab: pick a period, see the client's results from every source Phloem has (content, email, imported platform CSVs),
// let AI write the commentary, save the report and send the client a read-only link.
import { useEffect, useState } from 'preact/hooks';
import { toast, useStore } from '../../store';
import { createShare, deleteItem, isRelay } from '../../mkt/data';
import { SOURCES, addDataset, aiCommentary, buildReport, metricsOf, parseMetricsCsv, periodOf, removeDataset, reportsOf, saveReport, type Kpi, type Snapshot, type Source } from '../../mkt/reports';
import { canWrite, type Client } from '../../mkt/types';
import { Btn, Modal } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';
import { Empty, PageHead, fmtDate } from './bits';

type PKind = '7' | '30' | '90' | 'month' | 'lastmonth';
const PERIODS: { id: PKind; label: string }[] = [{ id: '7', label: '7 ngày' }, { id: '30', label: '30 ngày' }, { id: '90', label: '90 ngày' }, { id: 'month', label: 'Tháng này' }, { id: 'lastmonth', label: 'Tháng trước' }];

export function ReportsTab({ client }: { client: Client }) {
  const s = useStore();
  const write = canWrite(client.role) && !client.shared;
  const [pk, setPk] = useState<PKind>('30');
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [writing, setWriting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [open, setOpen] = useState<Snapshot | null>(null);
  const load = async () => { setLoading(true); try { setSnap(await buildReport(client, periodOf(pk))); } catch (e) { toast((e as Error).message, 'err'); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, [client.id, pk, s.clientsAt]);
  const saved = reportsOf(client.id);

  const comment = async () => {
    if (!snap) return; setWriting(true);
    try { setSnap({ ...snap, commentary: await aiCommentary(client, snap) }); } catch (e) { toast((e as Error).message, 'err'); } finally { setWriting(false); }
  };
  const saveAndShare = async (x: Snapshot) => {
    try {
      const it = await saveReport(client.id, x);
      if (!isRelay()) { toast('Đã lưu báo cáo. Gửi link cho khách cần tài khoản relay.', 'ok'); return; }
      const url = await createShare(client.id, 'report', it.id, 30);
      await navigator.clipboard.writeText(url).catch(() => null);
      toast('Đã lưu và chép link báo cáo (30 ngày). Dán gửi khách qua Zalo/email.', 'ok');
    } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <>
      <PageHead title="Báo cáo" sub="Kết quả của khách trong kỳ: nội dung đã đăng, email, số liệu Facebook/Instagram, TikTok, Google Ads, website. AI viết nhận xét, lưu và gửi khách bằng link."
        actions={<>
          {write && <Btn icon="upload" onClick={() => setImporting(true)}>Nhập số liệu</Btn>}
          {write && <Btn icon="sparkle" disabled={!snap || writing} onClick={() => void comment()}>{writing ? 'AI đang viết…' : 'AI viết nhận xét'}</Btn>}
          {write && <Btn kind="primary" icon="send" disabled={!snap} onClick={() => snap && void saveAndShare(snap)}>Lưu & gửi khách</Btn>}
        </>} />
      <div class="row wrap" style={{ marginBottom: 12, gap: 8 }}>
        <div class="seg">{PERIODS.map((p) => <button key={p.id} class={pk === p.id ? 'on' : ''} onClick={() => setPk(p.id)}>{p.label}</button>)}</div>
        {snap && <span class="dim small mono">{snap.period.from} → {snap.period.to}</span>}
        {snap && <span class="dim small">Nguồn: Kế hoạch{snap.email ? ', Email' : ''}{snap.sources.length ? `, ${snap.sources.join(', ')}` : ''}</span>}
      </div>
      {loading && !snap ? <div class="mk-loading">Đang gom số liệu…</div> : snap ? <ReportView s={snap} /> : null}
      {snap && !snap.sources.length && write && (
        <div class="claim" style={{ marginTop: 12 }}><Icon name="info" /><span class="grow">Chưa có số liệu Facebook/Instagram, TikTok, Google Ads hay website. Xuất file CSV từ từng nền tảng rồi bấm <b>Nhập số liệu</b>; báo cáo tự gộp theo ngày.</span><Btn sm onClick={() => setImporting(true)}>Nhập số liệu</Btn></div>
      )}

      <section class="mk-card" style={{ marginTop: 16 }}>
        <div class="mk-card-h"><b>Báo cáo đã lưu</b><span class="dim small">{saved.length ? `${saved.length} báo cáo · bấm để xem, gửi lại link` : 'chưa có'}</span></div>
        {saved.length ? <div class="mk-rp-saved">{saved.map((it) => (
          <div key={it.id} class="mk-rp-item">
            <button class="grow" onClick={() => setOpen(it.data)}><b>{it.data.title}</b><span class="dim small">{it.data.period.from} → {it.data.period.to} · lưu {fmtDate(it.updatedAt)}</span></button>
            {write && <Btn xs icon="link" onClick={() => void saveAndShare(it.data)} title="Chép lại link cho khách">Link</Btn>}
            {write && <Btn xs kind="ghost" icon="trash" onClick={async () => { if (await ask(`Xoá "${it.data.title}"? Link đã gửi khách sẽ không mở được nữa.`)) void deleteItem(client.id, 'report', it.id); }} title="Xoá" />}
          </div>
        ))}</div> : <div style={{ padding: 12 }} class="dim small">Bấm "Lưu & gửi khách" để lưu báo cáo kỳ này.</div>}
      </section>

      {importing && <ImportMetrics client={client} onClose={() => { setImporting(false); void load(); }} />}
      {open && <Modal wide title={open.title} icon="chart" onClose={() => setOpen(null)}><ReportView s={open} /></Modal>}
    </>
  );
}

const fmt = (k: Kpi | { value: number; unit?: string; money?: boolean }, v = k.value) => (k.money ? `${Math.round(v).toLocaleString('vi-VN')}` : `${v.toLocaleString('vi-VN')}${k.unit && k.unit !== 'đ' ? k.unit : ''}`);
/** The report itself: also what the client sees on the shared link. */
export function ReportView({ s }: { s: Snapshot }) {
  const max = Math.max(1, ...s.content.byChannel.map((c) => c.planned));
  return (
    <div class="mk-rp">
      <div class="mk-kpis">
        {s.kpis.map((k) => {
          const d = k.prev != null && k.prev !== 0 ? ((k.value - k.prev) / Math.abs(k.prev)) * 100 : null;
          return <div key={k.id} class="mk-kpi"><span class="l">{k.label}</span><b>{fmt(k)}</b>{d != null ? <span class={`s ${d >= 0 ? 'up' : 'down'}`}>{d >= 0 ? '▲' : '▼'} {Math.abs(Math.round(d))}% so với kỳ trước</span> : k.prev === 0 && k.value ? <span class="s up">mới trong kỳ</span> : <span class="s">&nbsp;</span>}</div>;
        })}
      </div>
      {s.commentary && <section class="mk-card mk-rp-ai"><div class="mk-card-h"><b><Icon name="sparkle" size={13} /> Nhận xét</b></div><div class="mk-rp-md" dangerouslySetInnerHTML={{ __html: md(s.commentary) }} /></section>}
      <div class="mk-rp-charts">
        {s.series.filter((x) => x.points.some((p) => p.value)).map((x) => <section key={x.id} class="mk-card"><div class="mk-card-h"><b>{x.label}</b><span class="dim small mono">{x.points.reduce((a, p) => a + p.value, 0).toLocaleString('vi-VN')}</span></div><Line points={x.points} /></section>)}
      </div>
      <div class="mk-rp-two">
        <section class="mk-card">
          <div class="mk-card-h"><b>Nội dung theo kênh</b><span class="dim small">{s.content.live}/{s.content.planned} bài đã đăng · {s.content.approved} đã duyệt</span></div>
          {s.content.byChannel.length ? <table class="mk-rp-t"><tbody>{s.content.byChannel.map((c) => <tr key={c.channel}><td>{c.label}</td><td class="grow"><span class="mk-rp-bar"><i style={{ width: `${(c.planned / max) * 100}%` }} /><i class="live" style={{ width: `${(c.live / max) * 100}%` }} /></span></td><td class="mono">{c.live}/{c.planned}</td></tr>)}</tbody></table> : <p class="dim small" style={{ padding: 12 }}>Không có bài nào trong kỳ.</p>}
        </section>
        <section class="mk-card">
          <div class="mk-card-h"><b>Email</b>{s.email && <span class="dim small">{s.email.sent.toLocaleString('vi-VN')} đã gửi · {s.email.growth >= 0 ? '+' : ''}{s.email.growth} người đăng ký</span>}</div>
          {s.email && s.email.campaigns.length ? <table class="mk-rp-t"><thead><tr><th>Chiến dịch</th><th>Gửi</th><th>Mở</th><th>Bấm</th><th>Đơn</th></tr></thead><tbody>{s.email.campaigns.slice(0, 12).map((c, i) => <tr key={i}><td class="mk-ell" title={c.subject}>{c.subject}</td><td class="mono">{c.sent}</td><td class="mono">{c.sent ? Math.round((c.opens / c.sent) * 100) : 0}%</td><td class="mono">{c.sent ? Math.round((c.clicks / c.sent) * 100) : 0}%</td><td class="mono">{c.orders}</td></tr>)}</tbody></table> : <p class="dim small" style={{ padding: 12 }}>Không có chiến dịch email nào gửi trong kỳ.</p>}
        </section>
      </div>
    </div>
  );
}

function Line({ points }: { points: { day: string; value: number }[] }) {
  const W = 520, H = 120, max = Math.max(1, ...points.map((p) => p.value)), n = Math.max(1, points.length - 1);
  const xy = points.map((p, i) => [8 + (i / n) * (W - 16), H - 18 - (p.value / max) * (H - 30)]);
  const d = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <svg class="mk-rp-line" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Biểu đồ theo ngày">
      <path d={`${d} L${xy[xy.length - 1][0]},${H - 18} L${xy[0][0]},${H - 18} Z`} class="a" />
      <path d={d} class="l" />
      <text x="8" y={H - 4} class="t">{points[0]?.day.slice(5)}</text>
      <text x={W - 8} y={H - 4} class="t" text-anchor="end">{points[points.length - 1]?.day.slice(5)}</text>
      <text x={W - 8} y="12" class="t" text-anchor="end">{max.toLocaleString('vi-VN')}</text>
    </svg>
  );
}
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
function md(t: string) {
  return esc(t).split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const b = l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); return /^[-•*]\s/.test(l) ? `<li>${b.replace(/^[-•*]\s/, '')}</li>` : `<p>${b}</p>`; }).join('').replace(/(<li>.*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
}

function ImportMetrics({ client, onClose }: { client: Client; onClose: () => void }) {
  const [src, setSrc] = useState<Source>('meta');
  const [busy, setBusy] = useState(false);
  const [, bump] = useState(0);
  const ds = metricsOf(client.id).datasets;
  const add = async (files: File[]) => {
    setBusy(true);
    for (const f of files) {
      try { const d = parseMetricsCsv(await f.text(), src, f.name.replace(/\.[^.]+$/, '')); await addDataset(client.id, d); toast(`Đã nhập ${Object.keys(d.days).length} ngày số liệu từ ${f.name}.`, 'ok'); }
      catch (e) { toast(`${f.name}: ${(e as Error).message}`, 'err'); }
    }
    setBusy(false); bump((n) => n + 1);
  };
  return (
    <Modal title="Nhập số liệu nền tảng" icon="upload" onClose={onClose} footer={<Btn kind="primary" onClick={onClose}>Xong</Btn>}>
      <div class="col" style={{ gap: 12 }}>
        <div class="seg">{SOURCES.map((x) => <button key={x.id} class={src === x.id ? 'on' : ''} onClick={() => setSrc(x.id)}>{x.label}</button>)}</div>
        <p class="dim small"><Icon name="info" size={12} /> {SOURCES.find((x) => x.id === src)?.hint}. Phloem đọc cột ngày và các cột như tiếp cận, hiển thị, tương tác, lượt bấm, chi tiêu, chuyển đổi, doanh thu, phiên truy cập. Kết nối trực tiếp từng nền tảng sẽ đến sau (cần nền tảng duyệt ứng dụng); file CSV dùng được ngay.</p>
        <label class="mk-drop" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add(Array.from(e.dataTransfer?.files || [])); }}>
          <Icon name="upload" size={20} /><span>{busy ? 'Đang đọc file…' : 'Kéo thả file CSV vào đây hoặc bấm để chọn'}</span>
          <input type="file" accept=".csv,text/csv" multiple hidden onChange={(e) => { const f = Array.from((e.target as HTMLInputElement).files || []); (e.target as HTMLInputElement).value = ''; void add(f); }} />
        </label>
        {ds.length > 0 && <div class="mk-rp-saved">{ds.map((d) => { const days = Object.keys(d.days).sort(); return (
          <div key={d.id} class="mk-rp-item"><div class="grow"><b>{SOURCES.find((x) => x.id === d.source)?.label} · {d.name}</b><span class="dim small">{days.length} ngày ({days[0]} → {days[days.length - 1]}) · {[...new Set(Object.values(d.days).flatMap((m) => Object.keys(m)))].join(', ')}</span></div>
            <Btn xs kind="ghost" icon="trash" title="Bỏ bộ số liệu này" onClick={async () => { await removeDataset(client.id, d.id); bump((n) => n + 1); }} /></div>
        ); })}</div>}
      </div>
    </Modal>
  );
}
