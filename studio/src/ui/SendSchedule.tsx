// "Lịch gửi": every send of the account in one place: what goes out when (Vietnam time, with a countdown), from which
// mailbox, how far it got, today's cap, what happens next, and why it stopped. Server sends come from the relay; Gmail
// sends run in this browser and come from its queues.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { set, toast, useStore } from '../store';
import { listSenders, mailSignedIn, sendSchedule, serverSendControl, type ScheduleItem, type Sender } from '../pipeline/mailServer';
import { allQueues, sentToday, type MailQueue } from '../pipeline/mailSend';
import { Btn, Modal, Progress } from './components';
import { ask } from './confirm';

const vn = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
const nf = (n: number) => n.toLocaleString('vi-VN');
function until(iso: string | null, nowMs: number): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - nowMs; if (ms <= 0) return 'đến giờ';
  const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `còn ${d} ngày ${h % 24} giờ` : h ? `còn ${h} giờ ${m % 60} phút` : m ? `còn ${m} phút` : `còn ${Math.ceil(ms / 1000)} giây`;
}
type Group = 'sending' | 'scheduled' | 'waiting' | 'stopped' | 'done';
const GROUPS: { id: Group; label: string; hint: string }[] = [
  { id: 'sending', label: 'Đang gửi', hint: 'máy chủ gửi từng đợt, khoảng 20 giây một lần' },
  { id: 'scheduled', label: 'Sắp gửi', hint: 'tự bắt đầu đúng giờ hẹn, đóng máy vẫn chạy' },
  { id: 'waiting', label: 'Đang chờ', hint: 'hết hạn mức hôm nay, hoặc chờ kết quả A/B' },
  { id: 'stopped', label: 'Dừng / lỗi', hint: 'cần bạn xử lý' },
  { id: 'done', label: 'Đã xong', hint: '14 ngày gần đây' },
];
const groupOf = (s: string): Group => (s === 'sending' ? 'sending' : s === 'scheduled' ? 'scheduled' : s === 'waiting' ? 'waiting' : s === 'done' || s === 'cancelled' ? 'done' : 'stopped');

export function ScheduleModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [items, setItems] = useState<ScheduleItem[] | null>(null);
  const [resetAt, setResetAt] = useState('');
  const [err, setErr] = useState('');
  const [nowMs, setNow] = useState(Date.now());
  const [senders, setSenders] = useState<Sender[]>([]);
  const [switching, setSwitching] = useState<string | null>(null); const [to, setTo] = useState('');
  const load = async () => { if (!mailSignedIn()) { setItems([]); return; } try { const r = await sendSchedule(); setItems(r.items); setResetAt(r.dayResetAt); setErr(''); } catch (e) { setErr((e as Error).message); setItems([]); } };
  useEffect(() => { void load(); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000); const c = setInterval(() => setNow(Date.now()), 1000); return () => { clearInterval(t); clearInterval(c); }; }, []);
  const queues = useMemo(() => allQueues(), [items]);
  const since = Date.now() - 14 * 86400e3;
  const grouped = useMemo(() => {
    const g: Record<Group, ScheduleItem[]> = { sending: [], scheduled: [], waiting: [], stopped: [], done: [] };
    for (const x of items || []) { const k = groupOf(x.status); if (k === 'done' && Date.parse(x.lastSentAt || x.sendAt || x.createdAt) < since) continue; g[k].push(x); }
    g.scheduled.sort((a, b) => a.sendAt.localeCompare(b.sendAt));
    return g;
  }, [items]);
  const ctl = async (x: ScheduleItem, a: 'pause' | 'resume' | 'cancel') => {
    if (a === 'cancel' && !(await ask(`Huỷ phần chưa gửi của "${x.subject}"?`, 'Huỷ gửi', true))) return;
    try { await serverSendControl(x.id, a); await load(); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const openSwitch = async (x: ScheduleItem) => { try { const r = await listSenders(); setSenders(r.senders); setTo(r.senders.find((y) => y.id !== x.sender.id && y.health?.ok !== false)?.id || ''); setSwitching(x.id); } catch (e) { toast((e as Error).message, 'err'); } };
  const resumeWith = async (x: ScheduleItem) => { try { await serverSendControl(x.id, 'resume', to); setSwitching(null); await load(); toast('Đã đổi kênh và tiếp tục.', 'ok'); } catch (e) { toast((e as Error).message, 'err'); } };

  const row = (x: ScheduleItem) => {
    const sent = x.counts.sent || 0, failed = x.counts.failed || 0, queued = x.counts.queued || 0, skipped = x.counts.skipped || 0;
    const broken = x.sender.health && !x.sender.health.ok;
    const when = x.status === 'scheduled' ? <><b>Hẹn gửi {vn(x.sendAt)}</b> <span class="sch-count">{until(x.sendAt, nowMs)}</span></>
      : x.status === 'sending' ? <><b>Đang gửi</b> · bắt đầu {vn(x.firstSentAt || x.sendAt)}{x.lastSentAt ? ` · thư gần nhất ${vn(x.lastSentAt)}` : ''}</>
      : x.status === 'waiting' ? <><b>Gửi tiếp {vn(x.nextAt)}</b> <span class="sch-count">{until(x.nextAt, nowMs)}</span> · {x.ab?.phase === 'wait' ? `đang chờ ${x.ab.waitHours} giờ để chọn tiêu đề thắng A/B` : `đã gửi đủ ${nf(x.perDay)} thư hôm nay`}</>
      : x.status === 'done' ? <><b>Xong {vn(x.lastSentAt || x.sendAt)}</b>{x.firstSentAt ? ` · bắt đầu ${vn(x.firstSentAt)}` : ''}</>
      : x.status === 'paused' ? <><b>Tạm dừng</b> · hẹn ban đầu {vn(x.sendAt)}</>
      : x.status === 'cancelled' ? <><b>Đã huỷ</b> · hẹn {vn(x.sendAt)}</>
      : <><b>Dừng vì lỗi</b> · hẹn {vn(x.sendAt)}</>;
    return (
      <div key={x.id} class={`sch-row st-${x.status}`}>
        <div class="row" style={{ gap: 8 }}>
          <b class="grow sch-subj" title={x.subject}>{x.subject || '(không tiêu đề)'}</b>
          <Btn xs kind="ghost" onClick={() => set({ modal: 'people', peopleOf: x.id })}>Ai mở · bấm · mua</Btn>
        </div>
        <div class="small">{when}</div>
        <div class="small dim">Gửi từ <span class="mono">{x.sender.fromEmail || '?'}</span> · {x.sender.label}{broken ? <span class="chip warn" style={{ marginLeft: 6 }} title={x.sender.health?.error}>kênh lỗi</span> : null}{x.audience?.list ? ` · tới ${x.audience.list}${x.audience.segment ? ` · ${x.audience.segment}` : ''}` : ''}</div>
        {x.total > 0 && <><Progress done={sent + failed + skipped} total={x.total - (x.counts.cancelled || 0)} /><div class="small dim">{nf(sent)}/{nf(x.total)} đã gửi · {nf(queued)} chờ · {nf(failed)} lỗi{skipped ? ` · ${nf(skipped)} bỏ qua (đã huỷ ĐK)` : ''} · hôm nay {nf(x.sentToday)}/{nf(x.perDay)}</div></>}
        {(x.status === 'error' || broken) && x.lastError && <div class="check err"><span class="lv">LÝ DO</span><span class="m">{x.lastError}{/401|invalid|API key/i.test(x.lastError) ? ' Khoá API của kênh này sai hoặc đã bị thu hồi: bấm Đổi kênh để gửi bằng hộp mail khác.' : /mật khẩu|535|AUTH/i.test(x.lastError) ? ' Sai mật khẩu hộp mail: lưu lại mật khẩu (Google/Outlook cần mật khẩu ứng dụng) hoặc Đổi kênh.' : /kết nối|ETIMEDOUT|phản hồi/i.test(x.lastError) ? ' Không kết nối được máy chủ mail: kiểm tra máy chủ, cổng.' : ''}</span></div>}
        <div class="row" style={{ gap: 6 }}>
          {['scheduled', 'sending', 'waiting'].includes(x.status) && <Btn xs onClick={() => void ctl(x, 'pause')}>Tạm dừng</Btn>}
          {['paused', 'error'].includes(x.status) && !broken && <Btn xs kind="primary" onClick={() => void ctl(x, 'resume')}>Tiếp tục</Btn>}
          {['paused', 'error'].includes(x.status) && <Btn xs kind={broken ? 'primary' : undefined} onClick={() => void openSwitch(x)}>Đổi kênh</Btn>}
          {!['done', 'cancelled'].includes(x.status) && <Btn xs kind="ghost" onClick={() => void ctl(x, 'cancel')}>Huỷ</Btn>}
        </div>
        {switching === x.id && (
          <div class="row" style={{ gap: 6 }}>
            {senders.length > 1 || (senders.length === 1 && senders[0].id !== x.sender.id) ? <><span class="dim small">Gửi tiếp bằng</span><select class="in grow" style={{ height: 28, minWidth: 0 }} value={to} onChange={(e) => setTo((e.target as HTMLSelectElement).value)}>{senders.map((y) => <option key={y.id} value={y.id} disabled={y.health?.ok === false}>{y.fromEmail} · {y.label}{y.health?.ok === false ? ' (lỗi)' : y.id === x.sender.id ? ' (đang dùng)' : ''}</option>)}</select><Btn xs kind="primary" disabled={!to} onClick={() => void resumeWith(x)}>Tiếp tục</Btn></>
              : <span class="dim small">Chưa có kênh nào khác: thêm hộp mail ở tab Xuất → ô "Gửi từ" → Thêm hộp mail Titan, Zoho…</span>}
            <Btn xs kind="ghost" onClick={() => setSwitching(null)}>Đóng</Btn>
          </div>
        )}
      </div>
    );
  };
  const qRow = (q: MailQueue) => {
    const left = q.recipients.length - q.cursor;
    return (
      <div key={q.id} class={`sch-row st-${q.status}`}>
        <div class="row" style={{ gap: 8 }}><b class="grow sch-subj">{q.subject}</b><span class="chip">Gmail · trình duyệt</span></div>
        <div class="small">{q.status === 'done' ? <b>Xong</b> : q.status === 'sending' ? <b>Đang gửi trong trình duyệt</b> : q.status === 'capped' ? <b>Đủ hạn mức hôm nay: mở lại ngày mai và bấm Tiếp tục gửi</b> : q.status === 'auth' ? <b>Phiên Gmail hết hạn: bấm Kết nối lại ở tab Xuất</b> : <b>{q.status === 'paused' ? 'Tạm dừng' : 'Sẵn sàng'}</b>} · tạo {vn(q.createdAt)}</div>
        <div class="small dim">Gửi từ <span class="mono">{q.from}</span> · {nf(q.sent)}/{nf(q.recipients.length)} đã gửi · còn {nf(left)} · hôm nay {nf(sentToday(q))}/{nf(q.dailyCap)}{left > 0 ? ` · khoảng ${Math.ceil(left / q.dailyCap)} ngày nữa` : ''}</div>
        <Progress done={q.cursor} total={q.recipients.length} />
        <div class="dim small">Gmail gửi khi tab Phloem đang mở: đóng tab là tạm dừng. Muốn hẹn giờ và gửi khi tắt máy, dùng Máy chủ gửi.</div>
      </div>
    );
  };
  const activeQueues = queues.filter((q) => q.status !== 'done' || Date.parse(q.createdAt) > since);
  return (
    <Modal wide icon="send" title="Lịch gửi" onClose={onClose}
      footer={<><span class="dim small grow">Giờ Việt Nam. Hạn mức ngày của máy chủ gửi bắt đầu lại lúc {resetAt ? new Date(resetAt).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' }) : '07:00'} mỗi ngày.</span><Btn sm kind="ghost" onClick={() => void load()}>Làm mới</Btn></>}>
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
      {!mailSignedIn() && <div class="check info"><span class="lv">ĐĂNG NHẬP</span><span class="m">Máy chủ gửi (hẹn giờ, Titan, Zoho…) cần tài khoản Phloem. Dưới đây chỉ có các lần gửi Gmail trong trình duyệt này.</span></div>}
      {items === null ? <div class="progress"><i class="indet" /></div> : (
        <div class="col" style={{ gap: 14 }}>
          {GROUPS.map((g) => grouped[g.id].length > 0 && (
            <div key={g.id} class="col" style={{ gap: 8 }}>
              <div class="row"><b>{g.label}</b><span class="chip" style={{ marginLeft: 6 }}>{grouped[g.id].length}</span><span class="dim small" style={{ marginLeft: 8 }}>{g.hint}</span></div>
              {grouped[g.id].map(row)}
            </div>
          ))}
          {activeQueues.length > 0 && <div class="col" style={{ gap: 8 }}><div class="row"><b>Gmail (trong trình duyệt này)</b><span class="chip" style={{ marginLeft: 6 }}>{activeQueues.length}</span></div>{activeQueues.map(qRow)}</div>}
          {!(items.length || activeQueues.length) && <div class="dim small">Chưa có lần gửi nào. Mở một email → tab Xuất → Gửi bằng email thường.</div>}
          {s.user ? null : null}
        </div>
      )}
    </Modal>
  );
}
