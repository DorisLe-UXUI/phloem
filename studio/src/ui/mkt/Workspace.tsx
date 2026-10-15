// One client's workspace: header, tab bar, and the tabs that are not modules of their own
// (Tổng quan, Email, Cài đặt, and the "coming in phase N" pages).
import { useEffect, useMemo, useState } from 'preact/hooks';
import { set, toast, useStore } from '../../store';
import * as A from '../../pipeline/actions';
import { makeZip } from '../../../../src/shared/zip';
import { cachedItems, createShare, deleteClient, exportClient, isRelay, listAudit, listItems, listMembers, listShares, logoDataUrl, removeMember, reviewUrl, revokeShare, saveClient, setMember } from '../../mkt/data';
import { digest } from '../../mkt/insights';
import { go } from '../../mkt/router';
import { CLIENT_TABS, ROLE_LABEL, STATUS, canManage, canWrite, channelOf, type Status, type AuditRow, type Client, type ClientTab, type Member, type Role, type ShareLink } from '../../mkt/types';
import { Btn, Field, Modal } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';
import { ClientAvatar, Empty, PageHead, StatusChip, actionLabel, fmtDate, fmtTime } from './bits';
import { Bar, CreateClient, Kpi } from './MktApp';
import { BrandTab } from './BrandTab';
import { PlanTab, ApprovedWork } from './PlanTab';

export function Workspace({ client, tab }: { client: Client; tab: ClientTab }) {
  const s = useStore();
  const [err, setErr] = useState('');
  useEffect(() => { setErr(''); listItems(client.id).catch((e) => setErr((e as Error).message)); }, [client.id]);
  const items = cachedItems(client.id);
  const d = useMemo(() => digest(items), [items, s.clientsAt]);
  return (
    <div class="mk-ws">
      <div class="mk-ws-h">
        <ClientAvatar c={client} size={34} />
        <div class="grow" style={{ minWidth: 0 }}>
          <div class="row" style={{ gap: 8 }}><b class="mk-ws-name">{client.name}</b>{client.status === 'archived' && <span class="chip">Lưu trữ</span>}{client.shared && <span class="chip">{ROLE_LABEL[client.role as Role] || client.role}</span>}</div>
          <span class="dim small mono mk-ell">{[client.industry, client.website?.replace(/^https?:\/\//, '')].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div class="mk-tabs" role="tablist">
        {CLIENT_TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} class={tab === t.id ? 'on' : ''} onClick={() => go({ view: 'client', id: client.id, tab: t.id })}>
            <Icon name={t.icon} size={14} />{t.label}
            {t.id === 'brand' && items && !d.brand && <i class="dot" title="Chưa có brand book" />}
            {t.id === 'plan' && d.todo.some((x) => x.tab === 'plan' && x.tone === 'err') && <i class="dot err" title="Khách yêu cầu sửa" />}
          </button>
        ))}
      </div>
      <div class="mk-ws-b">
        {err && <div class="claim"><Icon name="warn" /><span class="grow">{err}</span><Btn sm onClick={() => listItems(client.id).then(() => setErr('')).catch((e) => setErr((e as Error).message))}>Thử lại</Btn></div>}
        {!items && !err ? <div class="mk-loading">Đang tải dữ liệu khách hàng…</div> : (
          <>
            {tab === 'overview' && <ClientOverview client={client} />}
            {tab === 'brand' && <BrandTab client={client} />}
            {tab === 'plan' && <PlanTab client={client} />}
            {tab === 'design' && <ApprovedWork client={client} mode="design" />}
            {tab === 'calendar' && <ApprovedWork client={client} mode="calendar" />}
            {tab === 'ads' && <Soon title="Quảng cáo" phase={5} text="Thu thập quảng cáo đối thủ (Meta Ad Library), so sánh, AI đề xuất campaign và bảng mô phỏng ngân sách có thanh kéo. Campaign đẩy sang nền tảng luôn ở trạng thái tạm dừng." />}
            {tab === 'email' && <EmailTab client={client} />}
            {tab === 'reports' && <Soon title="Báo cáo" phase={7} text="Số liệu thật từ Meta, TikTok, Google, GA4 cùng nhận xét AI, báo cáo tuần/tháng gửi khách tự động, và cổng khách hàng." />}
            {tab === 'settings' && <Settings client={client} />}
          </>
        )}
      </div>
    </div>
  );
}

function Soon({ title, phase, text }: { title: string; phase: number; text: string }) {
  return <><PageHead title={title} chips={<span class="chip">Giai đoạn {phase}</span>} /><Empty icon="leaf" title="Module này đến ở giai đoạn sau">{text}</Empty></>;
}

// ---------- Tổng quan khách ----------
function ClientOverview({ client }: { client: Client }) {
  const s = useStore();
  const d = useMemo(() => digest(cachedItems(client.id)), [client.id, s.clientsAt]);
  const emails = s.projects.filter((p) => p.clientId === client.id);
  const week = useMemo(() => { const out: { date: string; label: string }[] = []; for (let i = 0; i < 7; i++) { const t = new Date(Date.now() + i * 86400e3); out.push({ date: t.toISOString().slice(0, 10), label: t.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' }) }); } return out; }, []);
  const next = !d.brand ? { label: 'Lên thương hiệu', tab: 'brand' as const } : !d.plan ? { label: 'Soạn kế hoạch', tab: 'plan' as const } : { label: 'Mở kế hoạch', tab: 'plan' as const };
  return (
    <>
      <PageHead title="Tổng quan" sub={client.note || 'KPI, tiến độ kế hoạch, việc chờ và lịch 7 ngày tới.'} actions={<Btn kind="primary" icon="chevron" onClick={() => go({ view: 'client', id: client.id, tab: next.tab })}>{next.label}</Btn>} />
      <div class="mk-kpis">
        <Kpi label="Bài trong kế hoạch" value={d.progress.total} sub={d.plan ? `${d.plan.data.setup.months} tháng` : 'chưa có kế hoạch'} />
        <Kpi label="Đã duyệt" value={d.progress.total ? `${Math.round((d.progress.approved / d.progress.total) * 100)}%` : '–'} sub={`${d.progress.approved}/${d.progress.total} bài`} />
        <Kpi label="Việc chờ" value={d.todo.length} tone={d.todo.some((t) => t.tone === 'err') ? 'err' : d.todo.length ? 'warn' : undefined} />
        <Kpi label="Email" value={emails.length} sub="trong workspace này" />
      </div>
      <div class="mk-cols">
        <section class="mk-card">
          <div class="mk-card-h"><b>Việc chờ</b></div>
          {d.todo.length ? d.todo.map((t, i) => <button key={i} class="mk-line" onClick={() => go({ view: 'client', id: client.id, tab: t.tab })}><Icon name={t.tone === 'err' ? 'warn' : 'info'} size={15} /><span class="grow">{t.label}</span><Icon name="chevron" size={13} /></button>) : <div class="mk-none">Không có việc nào đang chờ.</div>}
          {d.progress.total > 0 && <div style={{ padding: '10px 12px' }}><Bar v={d.progress.approved / d.progress.total} label={`Tiến độ duyệt kế hoạch: ${d.progress.approved}/${d.progress.total}`} /></div>}
        </section>
        <section class="mk-card">
          <div class="mk-card-h"><b>7 ngày tới</b><span class="dim small">bài đã duyệt</span></div>
          <div class="mk-week">
            {week.map((w) => {
              const rows = d.upcoming.filter((r) => r.date === w.date);
              return <div key={w.date} class="mk-day"><span class="mono dim small">{w.label}</span>{rows.length ? rows.map((r) => <span key={r.id} class="mk-pill" style={{ borderColor: channelOf(r.channel).color }} title={r.topic}><i style={{ background: channelOf(r.channel).color }} />{r.time} {r.topic}</span>) : <span class="dim small">—</span>}</div>;
            })}
          </div>
        </section>
      </div>
    </>
  );
}

// ---------- Email (Phloem Email filtered to this client) ----------
function EmailTab({ client }: { client: Client }) {
  const s = useStore();
  useEffect(() => { void A.refreshProjects(); }, []);
  const list = s.projects.filter((p) => p.clientId === client.id);
  const write = canWrite(client.role);
  const own = !client.shared;
  const hasBrand = !!cachedItems(client.id)?.some((i) => i.kind === 'brand');
  return (
    <>
      <PageHead title="Email" sub={hasBrand ? 'Email mới tự dùng màu, font, logo trong brand kit của khách. Phloem chỉ tạo draft, bạn bấm gửi trong Mailchimp/Klaviyo/Gmail.' : 'Chưa có brand kit: email mới dùng màu mặc định. Lên thương hiệu trước để email đúng màu khách.'}
        actions={write && own ? <><Btn icon="sparkle" onClick={() => set({ modal: 'ai' })}>Dựng bằng AI</Btn><Btn kind="primary" icon="plus" onClick={() => set({ modal: 'templates' })}>Email mới</Btn></> : undefined} />
      {!own && <div class="claim"><Icon name="info" /><span class="grow">Email của khách này do chủ workspace quản lý trong tài khoản của họ.</span></div>}
      {list.length ? (
        <div class="proj-grid mk-proj">
          {list.map((p) => (
            <div key={p.id} class="proj" onClick={() => void A.openProject(p.id)}>
              <div class="frame"><div class="dots"><i /><i /><i /></div>{p.thumb ? <img class="shot" src={p.thumb} alt="" /> : <div class="blank" style={{ marginTop: 18 }}><Icon name="mail" size={28} /></div>}</div>
              <div class="meta">
                <span class="nm">{p.name}</span>
                <Btn xs kind="ghost" icon="copy" title="Nhân bản" onClick={(e) => { e.stopPropagation(); void A.duplicateProject(p.id); }} />
                <Btn xs kind="ghost" icon="trash" title="Xoá" onClick={async (e) => { e.stopPropagation(); if (await ask(`Xoá "${p.name}"? Không hoàn tác được.`)) void A.deleteProject(p.id); }} />
                <span class="sub">Sửa lần cuối {fmtDate(p.updatedAt)} · {p.provider === 'mailchimp' ? 'Mailchimp' : p.provider === 'klaviyo' ? 'Klaviyo' : 'chưa xuất'}</span>
              </div>
            </div>
          ))}
        </div>
      ) : <Empty icon="mail" title="Chưa có email nào cho khách này" action={write && own ? <Btn icon="plus" onClick={() => set({ modal: 'templates' })}>Email mới</Btn> : undefined}>Bấm Email mới để chọn template, hoặc Dựng bằng AI để AI đọc website và dựng 3 phương án.</Empty>}
    </>
  );
}

// ---------- Cài đặt ----------
function Settings({ client }: { client: Client }) {
  const s = useStore();
  const [editing, setEditing] = useState(false);
  const [audit, setAudit] = useState<AuditRow[] | null>(null);
  const [members, setMembers] = useState<{ members: Member[]; me: Role } | null>(null);
  const [shares, setShares] = useState<ShareLink[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('designer');
  const [deleting, setDeleting] = useState(false);
  const manage = canManage(client.role);
  const owner = client.role === 'owner' || !client.role;
  const reload = () => {
    listAudit(client.id).then(setAudit).catch(() => setAudit([]));
    if (isRelay()) { listMembers(client.id).then(setMembers).catch(() => setMembers(null)); if (canWrite(client.role)) listShares(client.id).then(setShares).catch(() => setShares([])); }
  };
  useEffect(reload, [client.id, s.clientsAt]);

  const exportZip = async () => {
    try {
      const data = await exportClient(client.id) as { projects?: { id: string; name: string }[] };
      const te = new TextEncoder();
      const files = [{ name: 'client.json', data: te.encode(JSON.stringify({ ...data, projects: undefined }, null, 2)) }, ...(data.projects || []).filter(Boolean).map((p) => ({ name: `emails/${p.id}.phloem.json`, data: te.encode(JSON.stringify({ phloem: 1, project: p })) }))];
      files.push({ name: 'README.txt', data: te.encode(`Dữ liệu khách hàng "${client.name}" xuất từ Phloem MKT lúc ${new Date().toLocaleString('vi-VN')}.\nclient.json: thông tin, thương hiệu, kế hoạch, duyệt, nhật ký, thành viên.\nemails/: từng email (mở lại bằng Phloem Email → Mở file .phloem.json).\n`) });
      const blob = new Blob([makeZip(files) as BlobPart], { type: 'application/zip' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `phloem-${client.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.zip`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast('Đã xuất dữ liệu khách hàng (ZIP).', 'ok'); reload();
    } catch (e) { toast((e as Error).message, 'err'); }
  };
  const setLogo = async (f: File) => { try { await saveClient({ ...client, logo: await logoDataUrl(f) }); toast('Đã đổi logo.', 'ok'); } catch (e) { toast((e as Error).message, 'err'); } };

  return (
    <>
      <PageHead title="Cài đặt" sub="Thông tin khách hàng, thành viên và quyền, link duyệt, nhật ký, xuất hoặc xoá dữ liệu." actions={manage ? <Btn icon="settings" onClick={() => setEditing(true)}>Sửa thông tin</Btn> : undefined} />
      <div class="mk-cols">
        <section class="mk-card">
          <div class="mk-card-h"><b>Thông tin</b></div>
          <div class="mk-kv">
            <span>Tên</span><b>{client.name}</b>
            <span>Ngành</span><span>{client.industry || '—'}</span>
            <span>Website</span><span class="mk-ell">{client.website ? <a href={client.website} target="_blank" rel="noopener">{client.website}</a> : '—'}</span>
            <span>Múi giờ</span><span>{client.timezone || 'Asia/Ho_Chi_Minh'}</span>
            <span>Tiền tệ</span><span>{client.currency || 'VND'}</span>
            <span>Tạo lúc</span><span>{fmtDate(client.createdAt)}</span>
            <span>Logo</span><span class="row">{client.logo ? <ClientAvatar c={client} size={28} /> : <span class="dim">chưa có</span>}{manage && <label class="btn xs">Đổi logo<input type="file" accept="image/*" hidden onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void setLogo(f); }} /></label>}</span>
          </div>
          {manage && <div class="row" style={{ padding: 12 }}>
            <Btn sm onClick={() => void saveClient({ ...client, status: client.status === 'archived' ? 'active' : 'archived' }).then(() => toast(client.status === 'archived' ? 'Đã mở lại.' : 'Đã lưu trữ. Dữ liệu vẫn còn.', 'ok'))}>{client.status === 'archived' ? 'Mở lại' : 'Lưu trữ'}</Btn>
          </div>}
        </section>
        <section class="mk-card">
          <div class="mk-card-h"><b>Thành viên và quyền</b></div>
          {!isRelay() ? <div class="mk-none">Mời thành viên cần tài khoản relay (đăng nhập Phloem trên máy chủ).</div> : !members ? <div class="mk-none">Đang tải…</div> : (
            <>
              <div class="mk-line static"><span class="grow"><b>{client.shared ? 'Chủ workspace' : `${s.user?.name} (bạn)`}</b></span><span class="chip on">{ROLE_LABEL.owner}</span></div>
              {members.members.map((m) => (
                <div key={m.userId} class="mk-line static">
                  <span class="grow"><b>{m.name}</b> <span class="dim small mono">{m.email}</span></span>
                  {owner ? <select class="in mk-role" value={m.role} aria-label={`Vai trò của ${m.name}`} onChange={(e) => void setMember(client.id, m.email, (e.target as HTMLSelectElement).value as Role).then(reload).catch((er) => toast((er as Error).message, 'err'))}>{(['manager', 'designer', 'content', 'ads', 'client_viewer'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select> : <span class="chip">{ROLE_LABEL[m.role]}</span>}
                  {owner && <Btn xs kind="ghost" icon="close" title={`Bỏ ${m.name}`} onClick={async () => { if (await ask(`Bỏ ${m.name} khỏi workspace "${client.name}"?`, 'Bỏ')) await removeMember(client.id, m.email).then(reload).catch((er) => toast((er as Error).message, 'err')); }} />}
                </div>
              ))}
              {owner && <form class="row" style={{ padding: 12 }} onSubmit={(e) => { e.preventDefault(); if (!email.trim()) return; void setMember(client.id, email, role).then(() => { setEmail(''); toast('Đã thêm thành viên.', 'ok'); reload(); }).catch((er) => toast((er as Error).message, 'err')); }}>
                <input class="in grow" type="email" placeholder="email@agency.vn (đã có tài khoản Phloem)" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-label="Email thành viên" />
                <select class="in mk-role" value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as Role)} aria-label="Vai trò">{(['manager', 'designer', 'content', 'ads', 'client_viewer'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                <Btn sm type="submit">Thêm</Btn>
              </form>}
            </>
          )}
        </section>
      </div>
      {isRelay() && canWrite(client.role) && (
        <section class="mk-card">
          <div class="mk-card-h"><b>Link duyệt đang mở</b><span class="dim small">khách mở không cần tài khoản</span></div>
          {!shares ? <div class="mk-none">Đang tải…</div> : shares.length ? shares.map((l) => (
            <div key={l.id} class="mk-line static">
              <span class="grow">{l.kind === 'plan' ? 'Kế hoạch' : l.kind === 'brand' ? 'Brand book' : l.kind} <span class="dim small mono">{l.itemId}</span></span>
              <span class="dim small">hết hạn {fmtDate(l.expiresAt)}</span>
              <Btn xs kind="ghost" title="Thu hồi link" onClick={async () => { if (await ask('Thu hồi link này? Khách sẽ không mở được nữa.', 'Thu hồi')) await revokeShare(client.id, l.id).then(reload).catch((er) => toast((er as Error).message, 'err')); }}>Thu hồi</Btn>
            </div>
          )) : <div class="mk-none">Chưa có link nào. Gửi duyệt từ tab Thương hiệu hoặc Kế hoạch.</div>}
        </section>
      )}
      <section class="mk-card">
        <div class="mk-card-h"><b>Nhật ký</b><span class="dim small">ai làm gì, lúc nào</span></div>
        {!audit ? <div class="mk-none">Đang tải…</div> : audit.length ? <div class="mk-audit">{audit.slice(0, 60).map((a, i) => <div key={i}><span class="mono dim">{fmtTime(a.at)}</span><b>{a.actor}</b><span>{actionLabel(a.action)}{a.detail ? <span class="dim"> · {a.detail.replace(/→ (\w+)$/, (_, st: string) => `→ ${STATUS[st as Status]?.label || st}`)}</span> : null}</span></div>)}</div> : <div class="mk-none">Chưa có thao tác nào.</div>}
      </section>
      {manage && (
        <section class="mk-card mk-danger">
          <div class="mk-card-h"><b>Dữ liệu (Nghị định 13/2023)</b></div>
          <div class="mk-line static"><span class="grow">Xuất toàn bộ dữ liệu của khách này: thông tin, thương hiệu, kế hoạch, duyệt, nhật ký, email.</span><Btn sm icon="download" onClick={() => void exportZip()}>Xuất ZIP</Btn></div>
          {owner && <div class="mk-line static"><span class="grow">Xoá vĩnh viễn khách hàng và mọi thứ thuộc về khách. Không hoàn tác được.</span><Btn sm kind="danger" icon="trash" onClick={() => setDeleting(true)}>Xoá khách hàng</Btn></div>}
        </section>
      )}
      {editing && <CreateClient edit={client} onClose={() => setEditing(false)} />}
      {deleting && <DeleteClient client={client} onClose={() => setDeleting(false)} />}
    </>
  );
}

function DeleteClient({ client, onClose }: { client: Client; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toLowerCase() === client.name.trim().toLowerCase();
  const del = async () => {
    setBusy(true);
    try { await deleteClient(client.id, typed); onClose(); toast(`Đã xoá "${client.name}".`, 'ok'); go({ view: 'clients' }); }
    catch (e) { toast((e as Error).message, 'err'); setBusy(false); }
  };
  return (
    <Modal title="Xoá khách hàng" icon="trash" narrow onClose={onClose} footer={<><Btn kind="ghost" onClick={onClose}>Huỷ</Btn><Btn kind="danger" disabled={!ok || busy} onClick={() => void del()}>{busy ? 'Đang xoá…' : 'Xoá vĩnh viễn'}</Btn></>}>
      <p style={{ margin: 0 }}>Xoá <b>{client.name}</b> cùng thương hiệu, kế hoạch, link duyệt, nhật ký và các email của khách. Nên <b>Xuất ZIP</b> trước nếu cần giữ lại.</p>
      <Field label={`Gõ "${client.name}" để xác nhận`}><input class="in" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} autoFocus /></Field>
    </Modal>
  );
}

/** "Gửi duyệt" button shared by the brand and plan tabs: makes a review link, copies it, marks the item pending. */
export function ShareButton({ client, kind, itemId, onShared, disabled }: { client: Client; kind: 'brand' | 'plan'; itemId: string; onShared?: () => void; disabled?: boolean }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { const u = await createShare(client.id, kind, itemId, 30); setUrl(u); try { await navigator.clipboard.writeText(u); toast('Đã copy link duyệt. Gửi cho khách qua Zalo/email.', 'ok'); } catch { /* shown in the dialog */ } onShared?.(); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setBusy(false); }
  };
  return (
    <>
      <Btn icon="send" disabled={busy || disabled} onClick={() => void make()} title="Tạo link duyệt 30 ngày cho khách (không cần tài khoản)">{busy ? 'Đang tạo…' : 'Gửi khách duyệt'}</Btn>
      {url && <Modal title="Link duyệt cho khách" icon="link" narrow onClose={() => setUrl('')} footer={<><a class="btn ghost" href={url} target="_blank" rel="noopener">Xem như khách</a><Btn kind="primary" onClick={() => { void navigator.clipboard.writeText(url).then(() => toast('Đã copy.', 'ok')); }}>Copy link</Btn></>}>
        <p style={{ margin: 0 }}>Khách mở link, không cần tài khoản: duyệt từng hàng hoặc cả bản, bình luận. Link hết hạn sau 30 ngày; thu hồi trong Cài đặt.</p>
        <input class="in mono" readOnly value={url} onFocus={(e) => (e.target as HTMLInputElement).select()} aria-label="Link duyệt" />
      </Modal>}
    </>
  );
}
export { reviewUrl };
