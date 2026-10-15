// Phloem MKT shell: top bar (client switcher ⌘K), left navigation, and the agency-level pages
// (Tổng quan, Khách hàng, Thư viện chung). A client opens its own workspace (Workspace.tsx).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { set, toast, useStore } from '../../store';
import * as A from '../../pipeline/actions';
import { cachedItems, isRelay, listItems, loadClients, saveClient } from '../../mkt/data';
import { digest } from '../../mkt/insights';
import { go } from '../../mkt/router';
import { CLIENT_TABS, channelOf, type Client } from '../../mkt/types';
import { Btn, Field, Modal } from '../components';
import { Icon, Logo } from '../icons';
import { ClientAvatar, Empty, PageHead, fmtDate } from './bits';
import { Workspace } from './Workspace';
import { ReviewPage } from './Review';

export function MktApp() {
  const s = useStore();
  const [creating, setCreating] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const [nav, setNav] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  useEffect(() => { if (s.user && s.mkt.view !== 'review') loadClients().then(() => setLoadErr('')).catch((e) => setLoadErr((e as Error).message)); }, [s.user?.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSwitcher((v) => !v); } };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  useEffect(() => { setNav(false); document.querySelector('.mk-main')?.scrollTo(0, 0); }, [s.mkt]);

  if (s.mkt.view === 'review') return <ReviewPage token={s.mkt.token} />;
  if (!s.user) return <Gate />;

  const v = s.mkt;
  const current = v.view === 'client' ? s.clients.find((c) => c.id === v.id) : undefined;
  const active = s.clients.filter((c) => c.status !== 'archived');

  return (
    <div class="mk">
      <header class="mk-top">
        <button class="btn ghost icon mk-burger" onClick={() => setNav(!nav)} aria-label="Mở menu"><Icon name="more" /></button>
        <Logo size={19} mod="mkt" onClick={() => go({ view: 'overview' })} />
        <button class="mk-switch" onClick={() => setSwitcher(true)} aria-label="Chuyển khách hàng (⌘K)">
          {current ? <><ClientAvatar c={current} size={20} /><b>{current.name}</b></> : <><Icon name="search" size={14} /><span class="muted">Chọn khách hàng</span></>}
          <span class="kbd">⌘K</span>
        </button>
        <span class="grow" />
        {!isRelay() && <span class="chip warn" title="Tài khoản trên trình duyệt này: khách hàng chỉ lưu ở máy này, chưa tạo được link duyệt hay mời thành viên.">Lưu trên máy này</span>}
        <a class="btn ghost sm mk-hide-sm" href="../studio/" title="Mở Phloem Email riêng"><Icon name="mail" /> Phloem Email</a>
        <div class="acct" title={s.user.email}>
          <div class="avatar">{(s.user.name || '?').trim().slice(0, 1).toUpperCase()}</div>
          <div class="who mk-hide-sm"><b>{s.user.name}</b><span>{s.user.email}</span></div>
          <Btn kind="ghost" sm class="mk-hide-sm" onClick={() => void A.signOut()}>Đăng xuất</Btn>
        </div>
      </header>
      <div class="mk-body">
        <nav class={`mk-nav ${nav ? 'open' : ''}`}>
          <NavItem icon="grid" label="Tổng quan" on={v.view === 'overview'} onClick={() => go({ view: 'overview' })} />
          <NavItem icon="layers" label="Khách hàng" on={v.view === 'clients'} count={active.length} onClick={() => go({ view: 'clients' })} />
          <div class="mk-nav-clients">
            {active.slice(0, 12).map((c) => (
              <button key={c.id} class={`mk-nav-c ${current?.id === c.id ? 'on' : ''}`} onClick={() => go({ view: 'client', id: c.id, tab: v.view === 'client' ? v.tab : 'overview' })}>
                <ClientAvatar c={c} size={18} /><span>{c.name}</span>
              </button>
            ))}
            <button class="mk-nav-c add" onClick={() => setCreating(true)}><Icon name="plus" size={14} /><span>Tạo khách hàng</span></button>
          </div>
          <NavItem icon="blocks" label="Thư viện chung" on={v.view === 'library'} onClick={() => go({ view: 'library' })} />
          {s.user.admin && <NavItem icon="settings" label="Quản trị" onClick={() => set({ route: { name: 'admin' } })} />}
          <a class="mk-nav-i mk-only-sm" href="../studio/"><Icon name="mail" size={15} /><span class="grow">Phloem Email</span></a>
          <NavItem icon="close" label="Đăng xuất" onClick={() => void A.signOut()} sm />
          <div class="grow" />
          <div class="mk-nav-foot dim small mono">Phloem không tự đăng, tự gửi hay tự chi tiền. Mọi thứ ra ngoài đều chờ người bấm duyệt.</div>
        </nav>
        <main class="mk-main">
          {loadErr && <div class="claim"><Icon name="warn" /><span class="grow">{loadErr}</span><Btn sm onClick={() => loadClients().then(() => setLoadErr('')).catch((e) => setLoadErr((e as Error).message))}>Thử lại</Btn></div>}
          {v.view === 'overview' && <Overview onCreate={() => setCreating(true)} />}
          {v.view === 'clients' && <ClientList onCreate={() => setCreating(true)} />}
          {v.view === 'library' && <Library />}
          {v.view === 'client' && (current ? <Workspace client={current} tab={v.tab} /> : s.clientsAt ? <Empty icon="warn" title="Không mở được khách hàng này" action={<Btn onClick={() => go({ view: 'clients' })}>Về danh sách khách hàng</Btn>}>Khách hàng đã bị xoá, hoặc tài khoản này không có quyền xem.</Empty> : <div class="mk-loading">Đang tải…</div>)}
        </main>
      </div>
      {creating && <CreateClient onClose={() => setCreating(false)} />}
      {switcher && <Switcher onClose={() => setSwitcher(false)} onCreate={() => { setSwitcher(false); setCreating(true); }} />}
    </div>
  );
}

function NavItem({ icon, label, on, count, onClick, sm }: { icon: string; label: string; on?: boolean; count?: number; onClick: () => void; sm?: boolean }) {
  return <button class={`mk-nav-i ${on ? 'on' : ''} ${sm ? 'mk-only-sm' : ''}`} onClick={onClick}><Icon name={icon} size={15} /><span class="grow">{label}</span>{count != null && <span class="mono dim">{count}</span>}</button>;
}

function Gate() {
  return (
    <div class="mk-gate">
      <Logo size={30} mod="mkt" />
      <h1>Tự động hoá marketing cho từng khách hàng của agency.</h1>
      <p class="muted">Mỗi khách hàng là một workspace riêng: thương hiệu, kế hoạch, thiết kế, lịch đăng, quảng cáo, email, báo cáo. Dữ liệu không bao giờ lẫn giữa các khách.</p>
      <div class="row" style={{ justifyContent: 'center' }}>
        <Btn kind="primary" icon="leaf" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập</Btn>
        <Btn onClick={() => set({ modal: 'auth', authTab: 'register' })}>Tạo tài khoản</Btn>
      </div>
      <p class="dim small mono">Dùng chung tài khoản với Phloem Email.</p>
    </div>
  );
}

// ---------- agency overview ----------
function useAllItems(clients: Client[]) {
  const s = useStore();
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => { for (const c of clients) { if (!alive) return; if (!cachedItems(c.id)) { try { await listItems(c.id); force((n) => n + 1); } catch { /* shown per client */ } } } })();
    return () => { alive = false; };
  }, [clients.map((c) => c.id).join(',')]);
  return useMemo(() => clients.map((c) => ({ c, d: digest(cachedItems(c.id)), loaded: !!cachedItems(c.id) })), [clients, s.clientsAt]);
}

function Overview({ onCreate }: { onCreate: () => void }) {
  const s = useStore();
  const active = s.clients.filter((c) => c.status !== 'archived');
  const all = useAllItems(active);
  const todo = all.flatMap(({ c, d }) => d.todo.map((t) => ({ ...t, c })));
  const upcoming = all.flatMap(({ c, d }) => d.upcoming.map((r) => ({ ...r, c }))).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const today = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  if (!active.length && s.clientsAt) return (
    <>
      <PageHead eyebrow={today} title={`Chào ${s.user?.name?.split(' ').pop() || 'bạn'}`} sub="Bắt đầu bằng khách hàng đầu tiên. Mỗi khách là một workspace riêng." />
      <Empty icon="leaf" title="Chưa có khách hàng nào" action={<Btn kind="primary" icon="plus" onClick={onCreate}>Tạo khách hàng</Btn>}>Nhập tên, website và ngành. Phloem mở ngay bước lên thương hiệu từ website của khách.</Empty>
    </>
  );
  return (
    <>
      <PageHead eyebrow={today} title="Hôm nay" sub="Việc cần duyệt, bài sắp đăng và cảnh báo của mọi khách hàng." actions={<Btn kind="primary" icon="plus" onClick={onCreate}>Tạo khách hàng</Btn>} />
      <div class="mk-kpis">
        <Kpi label="Khách hàng đang chạy" value={active.length} />
        <Kpi label="Việc cần xử lý" value={todo.length} tone={todo.some((t) => t.tone === 'err') ? 'err' : todo.length ? 'warn' : undefined} />
        <Kpi label="Bài sắp đăng · 7 ngày" value={upcoming.length} />
        <Kpi label="Quảng cáo đang chạy" value={0} sub="Giai đoạn 5" />
      </div>
      <div class="mk-cols">
        <section class="mk-card">
          <div class="mk-card-h"><b>Việc cần duyệt / xử lý</b><span class="dim mono small">{todo.length}</span></div>
          {todo.length ? todo.slice(0, 30).map((t, i) => (
            <button key={i} class="mk-line" onClick={() => go({ view: 'client', id: t.c.id, tab: t.tab })}>
              <ClientAvatar c={t.c} size={22} /><span class="grow"><b>{t.c.name}</b> · {t.label}</span><span class={`chip ${t.tone === 'err' ? 'err' : t.tone === 'warn' ? 'warn' : ''}`}>{t.tone === 'err' ? 'Cần sửa' : t.tone === 'warn' ? 'Chờ duyệt' : 'Bắt đầu'}</span>
            </button>
          )) : <div class="mk-none">Không có việc nào đang chờ. 🌿</div>}
        </section>
        <section class="mk-card">
          <div class="mk-card-h"><b>Sắp đăng</b><span class="dim mono small">7 ngày tới</span></div>
          {upcoming.length ? upcoming.slice(0, 20).map((r) => (
            <button key={r.c.id + r.id} class="mk-line" onClick={() => go({ view: 'client', id: r.c.id, tab: 'plan' })}>
              <span class="mk-date mono">{r.date.slice(8, 10)}/{r.date.slice(5, 7)}<i>{r.time}</i></span>
              <span class="mk-ch" style={{ background: channelOf(r.channel).color }}>{channelOf(r.channel).short}</span>
              <span class="grow"><b>{r.c.name}</b> · {r.topic}</span>
            </button>
          )) : <div class="mk-none">Chưa có bài đã duyệt trong 7 ngày tới. Duyệt kế hoạch để bài hiện ở đây.</div>}
        </section>
      </div>
      <section class="mk-card">
        <div class="mk-card-h"><b>Theo khách hàng</b></div>
        <div class="mk-table">
          <div class="mk-tr head"><span>Khách hàng</span><span>Thương hiệu</span><span>Kế hoạch</span><span>Tiến độ</span><span>Cập nhật</span></div>
          {all.map(({ c, d, loaded }) => (
            <button key={c.id} class="mk-tr" onClick={() => go({ view: 'client', id: c.id, tab: 'overview' })}>
              <span class="row"><ClientAvatar c={c} size={22} /><b>{c.name}</b></span>
              <span>{!loaded ? '…' : d.brand ? (d.brand.data.status === 'approved' ? 'Đã duyệt' : 'Nháp') : <span class="dim">Chưa có</span>}</span>
              <span>{!loaded ? '…' : d.plan ? `${d.plan.data.setup.months} tháng · ${d.plan.data.rows.length} bài` : <span class="dim">Chưa có</span>}</span>
              <span>{d.progress.total ? <Bar v={d.progress.approved / d.progress.total} label={`${d.progress.approved}/${d.progress.total} đã duyệt`} /> : <span class="dim">–</span>}</span>
              <span class="dim mono">{fmtDate(c.updatedAt)}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'warn' | 'err' }) {
  return <div class={`mk-kpi ${tone || ''}`}><span class="l">{label}</span><b>{value}</b>{sub && <span class="s">{sub}</span>}</div>;
}
export function Bar({ v, label }: { v: number; label?: string }) {
  return <span class="mk-bar" title={label}><i style={{ width: `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%` }} />{label && <em>{label}</em>}</span>;
}

// ---------- clients ----------
function ClientList({ onCreate }: { onCreate: () => void }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const list = s.clients.filter((c) => (showArchived ? c.status === 'archived' : c.status !== 'archived') && (!q.trim() || `${c.name} ${c.industry || ''} ${c.website || ''}`.toLowerCase().includes(q.trim().toLowerCase())));
  return (
    <>
      <PageHead eyebrow="Agency" title="Khách hàng" sub="Mỗi khách hàng là một workspace riêng, có quyền và dữ liệu tách biệt." actions={<Btn kind="primary" icon="plus" onClick={onCreate}>Tạo khách hàng</Btn>} />
      <div class="row wrap" style={{ marginBottom: 14 }}>
        <label class="search mk-search"><Icon name="search" size={14} /><input value={q} placeholder="Tìm theo tên, ngành, website…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Tìm khách hàng" /></label>
        <div class="seg"><button class={!showArchived ? 'on' : ''} onClick={() => setShowArchived(false)}>Đang chạy</button><button class={showArchived ? 'on' : ''} onClick={() => setShowArchived(true)}>Lưu trữ</button></div>
      </div>
      {list.length ? (
        <div class="mk-grid">
          {list.map((c) => (
            <button key={c.id} class="mk-client" onClick={() => go({ view: 'client', id: c.id, tab: 'overview' })}>
              <div class="row"><ClientAvatar c={c} size={36} /><div class="grow" style={{ minWidth: 0 }}><b>{c.name}</b><span class="dim small">{c.industry || 'Chưa có ngành'}</span></div>{c.shared && <span class="chip">{c.role === 'client_viewer' ? 'Xem' : 'Được mời'}</span>}</div>
              <span class="mono dim small mk-ell">{c.website || '—'}</span>
              <div class="row mk-client-tabs">{CLIENT_TABS.slice(1, 7).map((t) => <span key={t.id} title={t.label}><Icon name={t.icon} size={13} /></span>)}<span class="grow" /><span class="dim small">{fmtDate(c.updatedAt)}</span></div>
            </button>
          ))}
        </div>
      ) : <Empty icon="layers" title={showArchived ? 'Không có khách hàng lưu trữ' : q ? 'Không tìm thấy' : 'Chưa có khách hàng'} action={!showArchived && !q ? <Btn icon="plus" onClick={onCreate}>Tạo khách hàng</Btn> : undefined}>{!showArchived && !q ? 'Bấm Tạo khách hàng để mở workspace đầu tiên.' : undefined}</Empty>}
    </>
  );
}

const INDUSTRIES = ['F&B / Nhà hàng', 'Thời trang', 'Mỹ phẩm / Làm đẹp', 'Bất động sản', 'Giáo dục', 'Y tế / Sức khoẻ', 'Công nghệ / SaaS', 'Du lịch / Khách sạn', 'Bán lẻ / TMĐT', 'Tài chính', 'Ô tô / Xe máy', 'Game / Giải trí', 'B2B / Dịch vụ', 'Khác'];
const COLORS = ['#39ff14', '#6fb7ff', '#ff5fa2', '#ffc53d', '#25f4ee', '#ffa94d', '#b197fc', '#ff5c5c'];

export function CreateClient({ onClose, edit }: { onClose: () => void; edit?: Client }) {
  const [name, setName] = useState(edit?.name || '');
  const [website, setWebsite] = useState(edit?.website || '');
  const [industry, setIndustry] = useState(edit?.industry || '');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  const submit = async (e?: Event) => {
    e?.preventDefault();
    if (!name.trim()) { toast('Nhập tên khách hàng.', 'err'); return; }
    setBusy(true);
    try {
      let site = website.trim(); if (site && !/^https?:\/\//i.test(site)) site = `https://${site}`;
      const logo = edit?.logo; // the brand step reads the real logo from the website
      const c = await saveClient({ ...(edit || {}), id: edit?.id, name: name.trim(), website: site, industry, logo, color: edit?.color || COLORS[Math.floor(Math.random() * COLORS.length)], status: edit?.status || 'active', timezone: edit?.timezone || 'Asia/Ho_Chi_Minh', currency: edit?.currency || 'VND' });
      onClose();
      if (!edit) { toast(`Đã tạo workspace "${c.name}". Bước tiếp: lên thương hiệu.`, 'ok'); go({ view: 'client', id: c.id, tab: 'brand' }); }
      else toast('Đã lưu.', 'ok');
    } catch (err) { toast((err as Error).message, 'err'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={edit ? 'Sửa khách hàng' : 'Tạo khách hàng'} icon="plus" narrow onClose={onClose} footer={<><Btn kind="ghost" onClick={onClose}>Huỷ</Btn><Btn kind="primary" disabled={busy} onClick={() => void submit()}>{busy ? 'Đang lưu…' : edit ? 'Lưu' : 'Tạo và lên thương hiệu'}</Btn></>}>
      <form class="col" onSubmit={submit} style={{ gap: 12 }}>
        <Field label="Tên khách hàng"><input ref={first} class="in" value={name} placeholder="VD: Cà phê Gió" onInput={(e) => setName((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Website" hint="để AI đọc thương hiệu"><input class="in" value={website} placeholder="caphegio.vn" inputMode="url" onInput={(e) => setWebsite((e.target as HTMLInputElement).value)} /></Field>
        <Field label="Ngành"><select class="in" value={industry} onChange={(e) => setIndustry((e.target as HTMLSelectElement).value)}><option value="">Chọn ngành…</option>{INDUSTRIES.map((i) => <option key={i}>{i}</option>)}</select></Field>
        <button type="submit" style={{ display: 'none' }} />
      </form>
    </Modal>
  );
}

function Switcher({ onClose, onCreate }: { onClose: () => void; onCreate: () => void }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const list = s.clients.filter((c) => !q.trim() || c.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 12);
  const pick = (c: Client) => { onClose(); go({ view: 'client', id: c.id, tab: s.mkt.view === 'client' ? s.mkt.tab : 'overview' }); };
  return (
    <div class="modal-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="modal narrow mk-k" role="dialog" aria-label="Chuyển khách hàng">
        <div class="row mk-k-in"><Icon name="search" /><input ref={ref} value={q} placeholder="Tìm khách hàng…" onInput={(e) => { setQ((e.target as HTMLInputElement).value); setI(0); }}
          onKeyDown={(e) => { if (e.key === 'Escape') onClose(); if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(list.length, x + 1)); } if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); } if (e.key === 'Enter') { if (i < list.length) pick(list[i]); else onCreate(); } }} /></div>
        <div class="mk-k-list">
          {list.map((c, n) => <button key={c.id} class={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => pick(c)}><ClientAvatar c={c} size={22} /><span class="grow">{c.name}</span><span class="dim small">{c.industry}</span></button>)}
          <button class={i === list.length ? 'on' : ''} onMouseEnter={() => setI(list.length)} onClick={onCreate}><Icon name="plus" size={16} /><span class="grow">Tạo khách hàng{q.trim() ? ` "${q.trim()}"` : ''}</span></button>
        </div>
      </div>
    </div>
  );
}

function Library() {
  return (
    <>
      <PageHead eyebrow="Agency" title="Thư viện chung" sub="Template, brief và caption hay của agency để dùng lại cho khách khác. Khách hàng chỉ thấy bản sao của mình." />
      <Empty icon="blocks" title="Thư viện đang được dựng" action={<a class="btn" href="../studio/">Mở kho đồ hoạ trong Phloem Email</a>}>
        Kho ~15.000 đồ hoạ hiện nằm trong Phloem Email (tab Thiết kế). Giai đoạn 3 (Phloem Design) đưa kho này và template theo kênh vào đây, có sao chép sang từng khách.
      </Empty>
    </>
  );
}
