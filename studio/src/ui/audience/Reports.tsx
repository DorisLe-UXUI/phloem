// Báo cáo: list growth over time, campaign results (sent, open rate, click rate, unsubscribes).
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../../store';
import { reports, type Report } from '../../pipeline/audience';
import { Seg } from '../components';
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
          <thead><tr><th>Chiến dịch</th><th>Gửi tới</th><th class="n">Đã gửi</th><th class="n">Mở</th><th class="n">Click</th><th class="n">Huỷ ĐK</th><th>Ngày</th></tr></thead>
          <tbody>
            {!r.campaigns.length ? <tr><td colSpan={7} class="dim">Chưa có chiến dịch gửi qua máy chủ. Mở một email → Xuất → Gửi bằng email thường → Máy chủ gửi → chọn danh sách.</td></tr>
              : r.campaigns.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.subject || '(không tiêu đề)'}</b>{c.status !== 'done' && <span class="chip" style={{ marginLeft: 6 }}>{c.status}</span>}</td>
                  <td class="dim">{c.list || 'danh sách dán tay'}{c.segment ? ` · ${c.segment}` : ''}</td>
                  <td class="n">{c.sent.toLocaleString('vi-VN')}</td>
                  <td class="n">{pct(c.opens, c.sent)}</td>
                  <td class="n">{pct(c.clicks, c.sent)}</td>
                  <td class="n">{c.unsubscribes}</td>
                  <td class="dim">{fmtDate(c.at)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <div class="dim small">Tỉ lệ mở là ước tính: Apple Mail tải trước ảnh nên có thể tính cả người chưa đọc; click chính xác hơn.</div>
    </div>
  );
}
