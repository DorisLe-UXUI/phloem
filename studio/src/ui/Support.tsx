// Customer care: the "Hỗ trợ" bubble on every screen (bug / idea / question, screenshot, the screen's context) and the
// admin inbox (Database → Hỗ trợ): threads, reply by email, status, notification mailbox, CSV.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { set, toast, useStore } from '../store';
import { Btn } from './components';
import { Icon } from './icons';
import { isArtifact } from './confirm';
import { downloadBytes } from '../../../src/ui/clipboard';
import {
  KIND_VI, STATUS_VI, adminCsv, adminInbox, adminNotifySender, adminReply, adminStatus, adminTestMail, adminTicket, captureScreen, context, hasTickets, imageFromFile,
  myTickets, rateTicket, readTicket, rememberKey, replyTicket, sendTicket, signedIn, type Inbox, type Kind, type Msg, type Status, type Ticket,
} from '../pipeline/support';

// links from the reply emails: #/ho-tro/<ticket>/<key> (customer) and #/admin/ho-tro/<ticket> (admin), read once at load
const BOOT = typeof location !== 'undefined' ? location.hash : '';
const bootUser = /^#\/ho-tro(?:\/([A-Za-z0-9_]+)(?:\/([A-Za-z0-9_-]+))?)?\/?$/.exec(BOOT);
if (bootUser?.[1] && bootUser[2]) rememberKey(bootUser[1], bootUser[2]);
let adminIntent: { ticket: string | null } | null = (() => { const m = /^#\/admin\/ho-tro(?:\/([A-Za-z0-9_]+))?/.exec(BOOT); return m ? { ticket: m[1] || null } : null; })();
/** AdminPage asks once on mount whether it should open on Hỗ trợ (and which thread). */
export const takeAdminIntent = () => { const x = adminIntent; adminIntent = null; return x; };
export function openAdminSupport(ticket: string | null = null) { adminIntent = { ticket }; set({ route: { name: 'admin' } }); window.dispatchEvent(new CustomEvent('phloem:admin-support')); }
/** Open the bubble from anywhere (menus, error messages). */
export const openSupport = (kind?: Kind) => window.dispatchEvent(new CustomEvent('phloem:support', { detail: { kind } }));

const ago = (iso: string) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút` : m < 1440 ? `${Math.round(m / 60)} giờ` : `${Math.round(m / 1440)} ngày`; };
const when = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const PLACEHOLDER: Record<Kind, string> = { bug: 'Bạn đang làm gì thì lỗi? Lỗi hiện ra thế nào? (dán ảnh chụp bằng Ctrl/⌘+V)', idea: 'Bạn muốn Phloem có thêm gì, hoặc làm khác đi chỗ nào?', help: 'Bạn cần giúp gì? Càng cụ thể càng nhanh.', other: 'Viết cho Phloem…' };
const LS_EMAIL = 'phloem.support.email';
const lsGet = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

/** Attach a picture: screenshot of this tab, a file, or a paste. */
function useImage(onBusy?: (b: boolean) => void) {
  const [img, setImg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const take = async (p: Promise<string>) => { onBusy?.(true); try { setImg(await p); } catch (e) { const m = (e as Error).message; if (!/denied|NotAllowed|Permission/i.test(m)) toast(m, 'err'); } finally { onBusy?.(false); } };
  const onPaste = (e: ClipboardEvent) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) { e.preventDefault(); void take(imageFromFile(f)); } };
  const ui = (capture: () => void) => (
    <div class="sup-attach">
      {img ? <span class="sup-thumb"><img src={img} alt="" /><button type="button" title="Bỏ ảnh" onClick={() => setImg(null)}>×</button></span> : (
        <>
          <Btn xs icon="fit" onClick={capture} title="Chụp màn hình tab này (trình duyệt sẽ hỏi chia sẻ tab nào)">Chụp màn hình</Btn>
          <Btn xs kind="ghost" icon="upload" onClick={() => file.current?.click()}>Đính kèm ảnh</Btn>
          <input ref={file} type="file" accept="image/*" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) void take(imageFromFile(f)); }} />
        </>
      )}
    </div>
  );
  return { img, setImg, take, onPaste, ui };
}

function Thread({ messages, mine }: { messages: Msg[]; mine: 'user' | 'admin' }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  return (
    <div class="sup-thread">
      {messages.map((m) => (
        <div key={m.id} class={`sup-msg ${m.author === mine ? 'me' : 'them'} ${m.author}`}>
          <div class="sup-who">{m.author === 'admin' ? `Phloem${m.name ? ` · ${m.name}` : ''}` : m.name || 'Khách'} · {when(m.at)}</div>
          <div class="sup-body">{m.body}</div>
          {m.image && <a href={m.image} target="_blank" rel="noopener" class="sup-img" onClick={(e) => { e.preventDefault(); const w = window.open(); if (w) w.document.write(`<img src="${m.image}" style="max-width:100%">`); }}><img src={m.image} alt="ảnh đính kèm" /></a>}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
export function SupportBubble() {
  const s = useStore();
  const [open, setOpen] = useState(!!bootUser);
  const [tab, setTab] = useState<'new' | 'mine'>(bootUser?.[1] ? 'mine' : 'new');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [unread, setUnread] = useState(0);
  const [cur, setCur] = useState<string | null>(bootUser?.[1] || null);
  const [kind, setKind] = useState<Kind>('bug');
  const [msg, setMsg] = useState('');
  const [email, setEmail] = useState(lsGet(LS_EMAIL));
  const [name, setName] = useState('');
  const [meta, setMeta] = useState(true);
  const [hp, setHp] = useState('');
  const [busy, setBusy] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [sent, setSent] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');
  const pic = useImage(setBusy), rpic = useImage(setBusy);
  const user = signedIn() ? s.user : null;

  const refresh = async () => { if (!hasTickets()) { setTickets([]); setUnread(0); return; } try { const r = await myTickets(); setTickets(r.tickets); setUnread(r.unread); } catch { /* offline: keep what we have */ } };
  useEffect(() => {
    const first = setTimeout(() => void refresh(), 2500);
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 180_000);
    const onOpen = (e: Event) => { const k = (e as CustomEvent).detail?.kind as Kind | undefined; if (k) setKind(k); setTab('new'); setSent(null); setOpen(true); };
    window.addEventListener('phloem:support', onOpen);
    return () => { clearTimeout(first); clearInterval(t); window.removeEventListener('phloem:support', onOpen); };
  }, [s.user?.id]);
  useEffect(() => { if (open) void refresh(); }, [open]);
  const ticket = tickets.find((t) => t.id === cur) || null;
  useEffect(() => { if (open && ticket?.userUnread) { void readTicket(ticket.id).then(() => { setTickets((xs) => xs.map((x) => (x.id === ticket.id ? { ...x, userUnread: false } : x))); setUnread((n) => Math.max(0, n - 1)); }); } }, [open, ticket?.id, ticket?.userUnread]);

  if (isArtifact()) return null; // the claude.ai copy can't reach the relay
  const shot = async (p: ReturnType<typeof useImage>) => { setCapturing(true); await new Promise((r) => setTimeout(r, 60)); try { await p.take(captureScreen()); } finally { setCapturing(false); } };
  const submit = async () => {
    if (msg.trim().length < 3) { toast('Viết vài chữ để Phloem hiểu vấn đề nhé.', 'err'); return; }
    if (!user && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { toast('Nhập email để Phloem trả lời bạn.', 'err'); return; }
    setBusy(true);
    try {
      const t = await sendTicket({ kind, message: msg.trim(), email: user ? undefined : email.trim(), name: user ? undefined : name.trim(), image: pic.img, meta, website: hp });
      if (!user) try { localStorage.setItem(LS_EMAIL, email.trim()); } catch { /* ignore */ }
      setSent(t); setMsg(''); pic.setImg(null); void refresh();
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const sendReply = async () => {
    if (!ticket || !reply.trim()) return; setBusy(true);
    try { const t = await replyTicket(ticket.id, reply.trim(), rpic.img); setTickets((xs) => xs.map((x) => (x.id === t.id ? t : x))); setReply(''); rpic.setImg(null); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const rate = async (r: 1 | -1) => { if (!ticket) return; try { const t = await rateTicket(ticket.id, r); setTickets((xs) => xs.map((x) => (x.id === t.id ? t : x))); toast(r > 0 ? 'Cảm ơn bạn!' : 'Cảm ơn, Phloem sẽ làm tốt hơn.', 'ok'); } catch (e) { toast((e as Error).message, 'err'); } };
  const ctx = context();

  return (
    <>
      <button type="button" class={`sup-fab ${s.route.name === 'editor' ? 'ed' : ''} ${open ? 'on' : ''}`} onClick={() => setOpen(!open)} title="Hỗ trợ · báo lỗi · góp ý" aria-label="Hỗ trợ">
        <Icon name={open ? 'close' : 'mail'} /><span class="t">Hỗ trợ</span>{unread > 0 && !open && <b class="sup-badge">{unread}</b>}
      </button>
      {open && !capturing && (
        <div class={`sup-panel ${s.route.name === 'editor' ? 'ed' : ''}`} role="dialog" aria-label="Phloem hỗ trợ">
          <div class="sup-head">
            <div class="grow"><b>Phloem hỗ trợ</b><div class="dim small">Báo lỗi, góp ý, hỏi cách dùng. Phloem trả lời qua email và ngay tại đây.</div></div>
            <button type="button" class="sup-x" onClick={() => setOpen(false)} aria-label="Đóng"><Icon name="close" /></button>
          </div>
          <div class="seg sup-tabs">
            <button class={tab === 'new' ? 'on' : ''} onClick={() => { setTab('new'); setCur(null); }}>Gửi mới</button>
            <button class={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>Đã gửi{tickets.length ? ` · ${tickets.length}` : ''}{unread ? <b class="sup-dot" /> : null}</button>
          </div>
          {tab === 'new' && (sent ? (
            <div class="sup-done">
              <div class="sup-ok"><Icon name="check" /></div>
              <b>Đã gửi tới Phloem</b>
              <div class="dim">Phloem sẽ trả lời qua <b>{sent.email}</b> và trong mục Đã gửi. Mã yêu cầu: <span class="mono">{sent.id.slice(-6)}</span></div>
              <div class="row" style={{ gap: 6, justifyContent: 'center' }}><Btn sm onClick={() => { setTab('mine'); setCur(sent.id); setSent(null); }}>Xem yêu cầu</Btn><Btn sm kind="ghost" onClick={() => setSent(null)}>Gửi thêm</Btn></div>
            </div>
          ) : (
            <div class="sup-form">
              <div class="sup-kinds">{(Object.keys(KIND_VI) as Kind[]).map((k) => <button key={k} type="button" class={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{KIND_VI[k]}</button>)}</div>
              <textarea class="in sup-ta" rows={5} maxLength={5000} placeholder={PLACEHOLDER[kind]} value={msg} onInput={(e) => setMsg((e.target as HTMLTextAreaElement).value)} onPaste={pic.onPaste} />
              {pic.ui(() => void shot(pic))}
              {!user && (
                <div class="sup-guest">
                  <input class="in" placeholder="Tên của bạn" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
                  <input class="in" type="email" placeholder="Email để nhận trả lời *" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
                </div>
              )}
              <input class="sup-hp" tabIndex={-1} autocomplete="off" aria-hidden="true" value={hp} onInput={(e) => setHp((e.target as HTMLInputElement).value)} />
              <details class="sup-meta">
                <summary><label onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={meta} onChange={(e) => setMeta((e.target as HTMLInputElement).checked)} /> Gửi kèm thông tin kỹ thuật</label></summary>
                <div class="mono dim">{Object.entries(ctx).filter(([, v]) => (Array.isArray(v) ? v.length : v)).map(([k, v]) => <div key={k}>{k}: {Array.isArray(v) ? v.join(' | ') : v}</div>)}</div>
              </details>
              <div class="row" style={{ gap: 8 }}>
                <span class="dim small grow">{user ? <>Trả lời về <b>{user.email}</b></> : 'Không cần đăng nhập.'}</span>
                <Btn sm kind="primary" icon="send" disabled={busy} onClick={() => void submit()}>{busy ? 'Đang gửi…' : 'Gửi'}</Btn>
              </div>
            </div>
          ))}
          {tab === 'mine' && (ticket ? (
            <div class="sup-open">
              <div class="row" style={{ gap: 6 }}>
                <button type="button" class="sup-back" onClick={() => setCur(null)}>‹ Tất cả</button>
                <b class="grow sup-ell">{ticket.subject}</b><span class={`chip ${ticket.status === 'done' ? 'on' : ''}`}>{STATUS_VI[ticket.status]}</span>
              </div>
              <Thread messages={ticket.messages || []} mine="user" />
              {ticket.status === 'done' && ticket.rating == null && (
                <div class="sup-rate"><span class="dim">Vấn đề đã được giải quyết chưa?</span><Btn xs onClick={() => void rate(1)}>👍 Rồi</Btn><Btn xs kind="ghost" onClick={() => void rate(-1)}>👎 Chưa</Btn></div>
              )}
              <textarea class="in sup-ta" rows={2} placeholder="Trả lời…" value={reply} onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} onPaste={rpic.onPaste} />
              <div class="row" style={{ gap: 6 }}>{rpic.ui(() => void shot(rpic))}<span class="grow" /><Btn sm kind="primary" icon="send" disabled={busy || !reply.trim()} onClick={() => void sendReply()}>Gửi</Btn></div>
            </div>
          ) : (
            <div class="sup-list">
              {!tickets.length && <div class="dim small" style={{ padding: '18px 4px' }}>{hasTickets() ? 'Chưa có yêu cầu nào.' : 'Yêu cầu bạn gửi từ trình duyệt này sẽ hiện ở đây.'}</div>}
              {tickets.map((t) => (
                <button key={t.id} type="button" class={`sup-row ${t.userUnread ? 'unread' : ''}`} onClick={() => setCur(t.id)}>
                  <div class="row" style={{ gap: 6 }}><span class="chip">{KIND_VI[t.kind]}</span><b class="grow sup-ell">{t.subject}</b><span class="dim small">{ago(t.updatedAt)}</span></div>
                  <div class="dim small sup-ell">{t.last ? `${t.last.author === 'admin' ? 'Phloem: ' : 'Bạn: '}${t.last.body}` : ''}</div>
                  <div class="row small" style={{ gap: 6 }}><span class={`chip ${t.status === 'done' ? 'on' : ''}`}>{STATUS_VI[t.status]}</span>{t.lastBy === 'admin' && t.status !== 'done' && <span class="neon">Phloem đã trả lời</span>}{t.userUnread && <b class="sup-dot" />}</div>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------------------
type Filter = 'active' | 'new' | 'open' | 'done' | 'spam' | 'all';
export function SupportInbox({ initial = null }: { initial?: string | null }) {
  const [filter, setFilter] = useState<Filter>('active');
  const [data, setData] = useState<Inbox | null>(null);
  const [err, setErr] = useState('');
  const [q, setQ] = useState('');
  const [cur, setCur] = useState<Ticket | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  const load = async (f = filter) => { setErr(''); try { setData(await adminInbox(f)); } catch (e) { setErr((e as Error).message); } };
  const open = async (id: string) => { try { const t = await adminTicket(id); setCur(t); setReply(''); setData((d) => (d ? { ...d, tickets: d.tickets.map((x) => (x.id === id ? { ...x, adminUnread: false } : x)), counts: { ...d.counts, unread: Math.max(0, d.counts.unread - (d.tickets.find((x) => x.id === id)?.adminUnread ? 1 : 0)) } } : d)); } catch (e) { toast((e as Error).message, 'err'); } };
  useEffect(() => { void load(); if (initial) void open(initial); const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 120_000); return () => clearInterval(t); }, []);
  useEffect(() => { const on = () => { const x = takeAdminIntent(); if (x?.ticket) void open(x.ticket); }; window.addEventListener('phloem:admin-support', on); return () => window.removeEventListener('phloem:admin-support', on); }, []);
  const ql = q.trim().toLowerCase();
  const rows = useMemo(() => (data?.tickets || []).filter((t) => !ql || [t.subject, t.email, t.name, t.last?.body].some((x) => (x || '').toLowerCase().includes(ql))), [data, ql]);
  const c = data?.counts;
  const send = async (close: boolean) => {
    if (!cur || !reply.trim()) return; setBusy(close ? 'close' : 'reply');
    try {
      const r = await adminReply(cur.id, reply.trim(), close); setCur(r.ticket); setReply(''); void load();
      if (r.mailed === 'ok') toast(`Đã trả lời và gửi email cho ${r.ticket.email}.`, 'ok');
      else toast(r.mailed === 'off' ? 'Đã lưu câu trả lời (khách thấy trong bong bóng Hỗ trợ). Chưa gửi email: chọn hộp mail gửi thông báo ở trên.' : `Đã lưu câu trả lời nhưng email chưa gửi được (${r.mailed.replace(/^lỗi: /, '')}).`, 'err');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  };
  const setStatus = async (st: Status) => { if (!cur) return; try { const t = await adminStatus(cur.id, st); setCur({ ...cur, ...t }); void load(); } catch (e) { toast((e as Error).message, 'err'); } };
  const pickSender = async (id: string) => { try { await adminNotifySender(id); void load(); toast(id ? 'Đã chọn hộp mail gửi thông báo hỗ trợ.' : 'Đã tắt email thông báo.', 'ok'); } catch (e) { toast((e as Error).message, 'err'); } };
  const test = async () => { setBusy('test'); try { const r = await adminTestMail(); toast(`Đã gửi thư thử tới ${r.to.join(', ')}.`, 'ok'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); } };
  const csv = async () => { try { await downloadBytes(`phloem-ho-tro-${new Date().toISOString().slice(0, 10)}.csv`, await adminCsv(), 'text/csv'); } catch (e) { toast((e as Error).message, 'err'); } };
  const st = data?.settings;
  const tech = cur ? Object.entries(cur.meta || {}).filter(([, v]) => (Array.isArray(v) ? v.length : v)) : [];

  return (
    <div class="sup-admin">
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
      {st && (
        <div class="card sup-notify">
          <div class="row wrap" style={{ gap: 8 }}>
            <Icon name="mail" /><b>Email thông báo</b>
            <span class={`chip ${st.channel ? 'on' : 'warn'}`}>{st.channel === 'mailbox' ? 'bật' : st.channel === 'resend' ? 'Resend (env)' : 'chưa bật'}</span>
            <span class="dim small grow">Góp ý mới gửi tới {st.admins.join(', ') || '—'} (Trả lời trong hộp thư là tới thẳng khách). Câu trả lời của bạn được gửi email cho khách.</span>
          </div>
          <div class="row wrap" style={{ gap: 8 }}>
            <span class="dim small">Gửi bằng</span>
            <select class="in" style={{ maxWidth: 320, height: 30 }} value={st.sender === 'other' ? '' : st.sender} onChange={(e) => void pickSender((e.target as HTMLSelectElement).value)}>
              <option value="">{st.sender === 'other' ? `— hộp mail của ${st.senderOwner} —` : '— chưa chọn —'}</option>
              {st.senders.map((x) => <option key={x.id} value={x.id}>{x.fromEmail} · {x.label}</option>)}
            </select>
            <Btn sm disabled={!st.channel || busy === 'test'} onClick={() => void test()}>{busy === 'test' ? 'Đang gửi…' : 'Gửi thử'}</Btn>
            {!st.senders.length && <span class="dim small">Chưa có hộp mail: mở một email → Xuất → Gửi từ → <b>Thêm hộp mail</b> (Titan, Google mật khẩu ứng dụng…). Gmail kết nối bằng nút Google chỉ gửi được từ trình duyệt nên không dùng cho thông báo.</span>}
          </div>
        </div>
      )}
      <div class="row wrap" style={{ gap: 8 }}>
        <div class="seg" style={{ height: 32 }}>
          {(['active', 'new', 'open', 'done', 'spam', 'all'] as Filter[]).map((k) => <button key={k} class={filter === k ? 'on' : ''} onClick={() => { setFilter(k); void load(k); }}>{{ active: `Cần xử lý${c ? ` · ${c.new + c.open}` : ''}`, new: `Mới${c ? ` · ${c.new}` : ''}`, open: 'Đang xử lý', done: `Xong${c ? ` · ${c.done}` : ''}`, spam: 'Rác', all: 'Tất cả' }[k]}</button>)}
        </div>
        <span class="grow" />
        <input class="in" style={{ maxWidth: 240, height: 32 }} placeholder="Tìm tiêu đề, email, nội dung…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <Btn sm kind="ghost" icon="download" onClick={() => void csv()}>CSV</Btn>
        <Btn sm kind="ghost" icon="reflow" onClick={() => void load()}>Tải lại</Btn>
      </div>
      <div class="sup-inbox">
        <div class="sup-ilist">
          {!data && !err && <div class="dim small" style={{ padding: 14 }}>Đang tải…</div>}
          {data && !rows.length && <div class="dim small" style={{ padding: 14 }}>{ql ? 'Không có kết quả khớp.' : filter === 'active' ? 'Không còn yêu cầu nào cần xử lý.' : 'Trống.'}</div>}
          {rows.map((t) => (
            <button key={t.id} type="button" class={`sup-irow ${cur?.id === t.id ? 'on' : ''} ${t.adminUnread ? 'unread' : ''}`} onClick={() => void open(t.id)}>
              <div class="row" style={{ gap: 6 }}>{t.adminUnread && <b class="sup-dot" />}<span class={`chip ${t.kind === 'bug' ? 'warn' : ''}`}>{KIND_VI[t.kind]}</span><b class="grow sup-ell">{t.subject}</b><span class="dim small">{ago(t.updatedAt)}</span></div>
              <div class="dim small sup-ell">{t.name || t.email} · {t.email}{t.owner ? '' : ' · khách'}</div>
              <div class="row small" style={{ gap: 6 }}><span class={`chip ${t.status === 'done' ? 'on' : ''}`}>{STATUS_VI[t.status]}</span>{t.lastBy === 'user' && t.status !== 'done' && <span class="warn-t">chờ bạn trả lời</span>}{t.rating === 1 && <span>👍</span>}{t.rating === -1 && <span>👎</span>}{t.mailed.startsWith('lỗi') && <span class="err-t" title={t.mailed}>email lỗi</span>}</div>
            </button>
          ))}
        </div>
        <div class="sup-iview">
          {!cur ? <div class="dim small" style={{ padding: 18 }}>Chọn một yêu cầu bên trái.</div> : (
            <>
              <div class="row wrap" style={{ gap: 6 }}>
                <b class="grow" style={{ fontSize: 14 }}>{cur.subject}</b>
                <div class="seg" style={{ height: 28 }}>{(['new', 'open', 'done', 'spam'] as Status[]).map((x) => <button key={x} class={cur.status === x ? 'on' : ''} onClick={() => void setStatus(x)}>{STATUS_VI[x]}</button>)}</div>
              </div>
              <div class="small muted">{KIND_VI[cur.kind]} · <b>{cur.name || 'Khách'}</b> &lt;<a href={`mailto:${cur.email}?subject=${encodeURIComponent(`Re: ${cur.subject}`)}`}>{cur.email}</a>&gt; · {cur.owner ? 'có tài khoản' : 'chưa đăng nhập'} · gửi {when(cur.createdAt)}{cur.rating === 1 ? ' · khách hài lòng 👍' : cur.rating === -1 ? ' · khách chưa hài lòng 👎' : ''}</div>
              {cur.mailed && cur.mailed !== 'ok' && <div class="small warn-t">Email báo admin khi khách gửi: {cur.mailed === 'off' ? 'không gửi (lúc đó chưa chọn hộp mail)' : cur.mailed}</div>}
              {tech.length > 0 && <details class="sup-meta"><summary class="dim small">Thông tin kỹ thuật</summary><div class="mono dim">{tech.map(([k, v]) => <div key={k}>{k}: {Array.isArray(v) ? v.join(' | ') : v}</div>)}</div></details>}
              <Thread messages={cur.messages || []} mine="admin" />
              <textarea class="in sup-ta" rows={4} placeholder={`Trả lời ${cur.name || cur.email}… (gửi email cho khách và hiện trong bong bóng Hỗ trợ của họ)`} value={reply} onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)} />
              <div class="row" style={{ gap: 6 }}>
                <span class="grow" />
                <Btn sm disabled={!reply.trim() || !!busy} onClick={() => void send(false)}>{busy === 'reply' ? 'Đang gửi…' : 'Trả lời'}</Btn>
                <Btn sm kind="primary" icon="check" disabled={!reply.trim() || !!busy} onClick={() => void send(true)}>{busy === 'close' ? 'Đang gửi…' : 'Trả lời & xong'}</Btn>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Admin's count of tickets waiting (Home button badge). */
export function useSupportWaiting(admin: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!admin) return;
    const go = () => { void adminInbox('active').then((d) => setN(d.counts.unread)).catch(() => {}); };
    const first = setTimeout(go, 3000); const t = setInterval(() => { if (document.visibilityState === 'visible') go(); }, 180_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [admin]);
  return n;
}
