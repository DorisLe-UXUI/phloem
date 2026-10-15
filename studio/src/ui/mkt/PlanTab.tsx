// Module Kế hoạch: setup (1–12 tháng, kênh, mục tiêu, ngân sách) → AI plan → Sheets-like grid with Bảng / Lịch / Kanban /
// Tóm tắt / Ngân sách / KPI views → export (XLSX, CSV, PDF) → client review link. Approved rows feed Thiết kế and Lịch đăng.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { get, toast, useStore } from '../../store';
import { cachedItems, deleteItem, isRelay, newId, putItem } from '../../mkt/data';
import { applyReview } from '../../mkt/insights';
import { buildPlan, type PlanProgress } from '../../mkt/planAi';
import { brandBookOf } from '../../mkt/kit';
import { planEnd, toCsv, toXlsx, vnMarketingDates, type Column } from '../../../../src/shared/mkt';
import { CHANNELS, FORMATS, GOALS, STATUS, STATUS_ORDER, canWrite, channelOf, type Channel, type Client, type Goal, type Item, type Plan, type PlanRow, type PlanSetup, type Review, type Status } from '../../mkt/types';
import { go } from '../../mkt/router';
import { Btn, Field } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';
import { Empty, PageHead, StatusChip, fmtMoney, fmtTime } from './bits';
import { ShareButton } from './Workspace';

type View = 'table' | 'calendar' | 'kanban' | 'summary' | 'budget' | 'kpi';
const VIEWS: { v: View; label: string; icon: string }[] = [
  { v: 'table', label: 'Bảng', icon: 'grid' }, { v: 'calendar', label: 'Lịch', icon: 'layers' }, { v: 'kanban', label: 'Kanban', icon: 'blocks' },
  { v: 'summary', label: 'Tóm tắt', icon: 'text' }, { v: 'budget', label: 'Ngân sách', icon: 'bolt' }, { v: 'kpi', label: 'KPI', icon: 'reflow' },
];

function usePlans(client: Client) {
  const s = useStore();
  return useMemo(() => {
    const items = cachedItems(client.id) || [];
    const plans = (items.filter((i) => i.kind === 'plan') as Item<Plan>[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const reviews: Record<string, Review> = {};
    for (const i of items) if (i.kind === 'review') reviews[i.id] = i.data as Review;
    return { plans, reviews };
  }, [client.id, s.clientsAt]);
}

export function PlanTab({ client }: { client: Client }) {
  const { plans, reviews } = usePlans(client);
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const cur = plans.find((p) => p.id === sel) || plans[0];
  if (creating || !cur) return <PlanSetupForm client={client} onCancel={cur ? () => setCreating(false) : undefined} onDone={(id) => { setSel(id); setCreating(false); }} />;
  return <PlanView key={cur.id} client={client} item={cur} review={reviews[`plan-${cur.id}`]} plans={plans} onPick={setSel} onNew={() => setCreating(true)} />;
}

// ---------- setup ----------
function PlanSetupForm({ client, onCancel, onDone }: { client: Client; onCancel?: () => void; onDone: (id: string) => void }) {
  const today = new Date(); const nextMonday = new Date(today.getTime() + ((8 - today.getDay()) % 7 || 7) * 86400e3);
  const [setup, setSetup] = useState<PlanSetup>({ months: 3, start: nextMonday.toISOString().slice(0, 10), channels: ['facebook', 'instagram', 'tiktok'], goals: ['awareness', 'engagement'], budget: 60_000_000, currency: client.currency || 'VND', events: '', postsPerWeek: 3, brief: '' });
  const [prog, setProg] = useState<PlanProgress | null>(null);
  const [t0, setT0] = useState(0);
  const [, tick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { if (!prog) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [!!prog]);
  const brand = brandBookOf(client.id);
  const write = canWrite(client.role);
  const up = (p: Partial<PlanSetup>) => setSetup({ ...setup, ...p });
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const events = vnMarketingDates(setup.start, planEnd(setup.start, setup.months));
  const organic = setup.channels.filter((c) => ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'google_business'].includes(c)).length;
  const posts = Math.round(organic * setup.postsPerWeek * setup.months * 4.33);

  const run = async () => {
    if (!setup.channels.length) { toast('Chọn ít nhất một kênh.', 'err'); return; }
    abort.current = new AbortController(); setT0(Date.now());
    setProg({ label: 'Bắt đầu…', done: 0, total: 1 + setup.months });
    try {
      const plan = await buildPlan(client, brand, setup, setProg, abort.current.signal);
      const id = newId('plan');
      await putItem(client.id, 'plan', id, plan);
      toast(`Xong kế hoạch: ${plan.rows.length} bài trong ${setup.months} tháng. Xem lại rồi gửi khách duyệt.`, 'ok');
      onDone(id);
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setProg(null); }
  };

  if (prog) return (
    <>
      <PageHead title="AI đang soạn kế hoạch" sub={`${client.name} · ${setup.months} tháng · ${Math.round((Date.now() - t0) / 1000)}s`} />
      <div class="mk-card mk-progress">
        <div class="mk-prog-label">{prog.label}{prog.chars ? <span class="mono dim"> · {Math.round(prog.chars / 100) / 10}k ký tự</span> : null}</div>
        <div class="mk-prog-bar"><i style={{ width: `${Math.max(4, (prog.done / prog.total) * 100)}%` }} /></div>
        <span class="dim small">Chiến lược trước, rồi từng tháng (3 tháng song song). Khoảng {Math.max(1, Math.round(setup.months * 0.6))}–{Math.max(2, setup.months)} phút.</span>
        <Btn sm kind="ghost" onClick={() => abort.current?.abort()}>Huỷ</Btn>
      </div>
    </>
  );
  return (
    <>
      <PageHead title={onCancel ? 'Kế hoạch mới' : 'Kế hoạch'} sub="Chọn thời gian, kênh, mục tiêu và ngân sách. AI soạn chiến lược, trụ cột nội dung, phân bổ ngân sách, KPI và lịch đến từng bài."
        actions={<>{onCancel && <Btn kind="ghost" onClick={onCancel}>Huỷ</Btn>}<Btn kind="primary" icon="sparkle" disabled={!write} onClick={() => void run()}>Soạn kế hoạch</Btn></>} />
      {!brand && <div class="claim"><Icon name="info" /><span class="grow">Chưa có brand book: AI sẽ đoán giọng văn theo ngành. Nên lên thương hiệu trước.</span><Btn sm onClick={() => go({ view: 'client', id: client.id, tab: 'brand' })}>Lên thương hiệu</Btn></div>}
      <div class="mk-cols">
        <section class="mk-card col" style={{ padding: 14, gap: 14 }}>
          <Field label="Số tháng" hint={`${setup.months} tháng`}>
            <div class="row"><input type="range" min={1} max={12} value={setup.months} class="grow mk-range" onInput={(e) => up({ months: Number((e.target as HTMLInputElement).value) })} aria-label="Số tháng" />
              <div class="seg">{[1, 3, 6, 12].map((m) => <button key={m} class={setup.months === m ? 'on' : ''} onClick={() => up({ months: m })}>{m}</button>)}</div></div>
          </Field>
          <div class="grid2">
            <Field label="Bắt đầu"><input class="in" type="date" value={setup.start} onInput={(e) => up({ start: (e.target as HTMLInputElement).value })} /></Field>
            <Field label="Bài / tuần / kênh"><input class="in" type="number" min={1} max={14} value={setup.postsPerWeek} onInput={(e) => up({ postsPerWeek: Math.max(1, Math.min(14, Number((e.target as HTMLInputElement).value) || 1)) })} /></Field>
          </div>
          <Field label="Kênh">
            <div class="mk-checks">{CHANNELS.map((c) => <label key={c.id} class={setup.channels.includes(c.id) ? 'on' : ''}><input type="checkbox" checked={setup.channels.includes(c.id)} onChange={() => up({ channels: toggle(setup.channels, c.id) })} /><i style={{ background: c.color }} />{c.label}<span class="dim">{c.group}</span></label>)}</div>
          </Field>
          <Field label="Mục tiêu">
            <div class="mk-checks">{GOALS.map((g) => <label key={g.id} class={setup.goals.includes(g.id) ? 'on' : ''}><input type="checkbox" checked={setup.goals.includes(g.id)} onChange={() => up({ goals: toggle(setup.goals, g.id as Goal) })} />{g.label}</label>)}</div>
          </Field>
        </section>
        <section class="mk-card col" style={{ padding: 14, gap: 14 }}>
          <div class="grid2">
            <Field label="Ngân sách tổng"><input class="in mono" inputMode="numeric" value={setup.budget.toLocaleString('vi-VN')} onInput={(e) => up({ budget: Number((e.target as HTMLInputElement).value.replace(/\D/g, '')) || 0 })} /></Field>
            <Field label="Tiền tệ"><select class="in" value={setup.currency} onChange={(e) => up({ currency: (e.target as HTMLSelectElement).value })}><option>VND</option><option>USD</option></select></Field>
          </div>
          <Field label="Sự kiện / mùa vụ của khách" hint="tự thêm các dịp Việt Nam"><textarea class="in" rows={2} value={setup.events} placeholder="Khai trương chi nhánh 2 ngày 20/12, sinh nhật thương hiệu 5/1…" onInput={(e) => up({ events: (e.target as HTMLTextAreaElement).value })} /></Field>
          <Field label="Brief thêm"><textarea class="in" rows={3} value={setup.brief} placeholder="Đẩy món mới, nhắm sinh viên quanh trường, ưu tiên video…" onInput={(e) => up({ brief: (e.target as HTMLTextAreaElement).value })} /></Field>
          <div class="mk-mini">
            <span><b>{posts}</b> bài dự kiến</span><span><b>{fmtMoney(setup.budget / Math.max(1, setup.months), setup.currency)}</b> / tháng</span>
          </div>
          {events.length > 0 && <div class="col" style={{ gap: 6 }}><span class="small muted">Dịp trong kỳ</span><div class="bb-chips">{events.slice(0, 14).map((e) => <span key={e.date + e.name}>{e.date.slice(8, 10)}/{e.date.slice(5, 7)} {e.name}</span>)}</div></div>}
        </section>
      </div>
    </>
  );
}

// ---------- the plan ----------
const COLS: (Column & { edit?: 'text' | 'long' | 'date' | 'time' | 'channel' | 'format' | 'status' })[] = [
  { key: 'date', label: 'Ngày', width: 12, edit: 'date' }, { key: 'time', label: 'Giờ', width: 8, edit: 'time' },
  { key: 'channel', label: 'Kênh', width: 14, edit: 'channel' }, { key: 'format', label: 'Định dạng', width: 12, edit: 'format' },
  { key: 'pillar', label: 'Trụ cột', width: 16, edit: 'text' }, { key: 'topic', label: 'Chủ đề', width: 32, edit: 'text' },
  { key: 'hook', label: 'Hook', width: 32, edit: 'long' }, { key: 'caption', label: 'Caption nháp', width: 50, edit: 'long' },
  { key: 'cta', label: 'CTA', width: 14, edit: 'text' }, { key: 'hashtags', label: 'Hashtag', width: 24, edit: 'text' },
  { key: 'visual', label: 'Ý tưởng hình ảnh', width: 36, edit: 'long' }, { key: 'owner', label: 'Phụ trách', width: 14, edit: 'text' },
  { key: 'status', label: 'Trạng thái', width: 12, edit: 'status' }, { key: 'note', label: 'Bình luận', width: 30, edit: 'long' },
];

function PlanView({ client, item, review, plans, onPick, onNew }: { client: Client; item: Item<Plan>; review?: Review; plans: Item<Plan>[]; onPick: (id: string) => void; onNew: () => void }) {
  const s = useStore();
  const write = canWrite(client.role);
  const [plan, setPlan] = useState<Plan>(item.data);
  const [view, setView] = useState<View>(() => { try { return (localStorage.getItem('phloem.mkt.planView') as View) || 'table'; } catch { return 'table'; } });
  const dirty = useRef<{ t: ReturnType<typeof setTimeout> | null; edits: number }>({ t: null, edits: 0 });
  useEffect(() => { if (!dirty.current.edits) setPlan(item.data); }, [item.updatedAt]);
  useEffect(() => { try { localStorage.setItem('phloem.mkt.planView', view); } catch { /* ignore */ } }, [view]);

  // the client's decisions from the review link flow back into the rows (approved → Đã duyệt, comments attached)
  useEffect(() => {
    if (!write) return;
    const next = applyReview(item.data, review);
    if (next) void commit(next, 'Áp dụng phản hồi duyệt của khách', true).then(() => toast('Đã cập nhật theo phản hồi của khách.', 'ok'));
  }, [review && JSON.stringify(review).length]);

  const commit = async (next: Plan, note: string, now = false) => {
    setPlan(next);
    const save = async () => {
      const version = (item.data.version || 1) + 1;
      const n = { ...next, version, versions: [...(next.versions || []), { version, at: new Date().toISOString(), by: s.user?.name || 'Bạn', note }].slice(-40) };
      dirty.current.edits = 0;
      try { await putItem(client.id, 'plan', item.id, n); } catch (e) { toast(`Chưa lưu được: ${(e as Error).message}`, 'err'); }
    };
    if (dirty.current.t) clearTimeout(dirty.current.t);
    if (now) { await save(); return; }
    dirty.current.edits++;
    dirty.current.t = setTimeout(() => void save(), 900);
  };
  const updateRow = (id: string, patch: Partial<PlanRow>) => void commit({ ...plan, rows: plan.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }, `Sửa ${Object.keys(patch).map((k) => COLS.find((c) => c.key === k)?.label || k).join(', ')}`);
  const setStatus = (st: Status) => void commit({ ...plan, status: st, rows: st === 'approved' ? plan.rows.map((r) => (r.status === 'draft' || r.status === 'pending' ? { ...r, status: 'approved' as Status } : r)) : st === 'pending' ? plan.rows.map((r) => (r.status === 'draft' ? { ...r, status: 'pending' as Status } : r)) : plan.rows }, st === 'approved' ? 'Duyệt cả kế hoạch' : st === 'pending' ? 'Gửi duyệt' : `Trạng thái: ${STATUS[st].label}`, true);
  const changes = review ? Object.values(review.rows || {}).filter((x) => x.status === 'changes').length : 0;
  const approvedByClient = review ? Object.values(review.rows || {}).filter((x) => x.status === 'approved').length : 0;

  return (
    <>
      <PageHead title={write ? <input class="mk-title-in" value={plan.title} onChange={(e) => void commit({ ...plan, title: (e.target as HTMLInputElement).value }, 'Đổi tên')} aria-label="Tên kế hoạch" /> : plan.title}
        chips={<><StatusChip s={plan.status} /><span class="chip mono">v{plan.version}</span>{plans.length > 1 && <select class="in mk-pick" value={item.id} onChange={(e) => onPick((e.target as HTMLSelectElement).value)} aria-label="Chọn kế hoạch">{plans.map((p) => <option key={p.id} value={p.id}>{p.data.title}</option>)}</select>}</>}
        sub={`${plan.setup.months} tháng từ ${plan.setup.start.split('-').reverse().join('/')} · ${plan.rows.length} bài · ${fmtMoney(plan.setup.budget, plan.setup.currency)}`}
        actions={<>
          <ExportMenu client={client} plan={plan} />
          {write && <Btn kind="ghost" icon="plus" onClick={onNew}>Kế hoạch mới</Btn>}
          {write && isRelay() && <ShareButton client={client} kind="plan" itemId={item.id} onShared={() => { if (plan.status === 'draft') setStatus('pending'); }} />}
          {write && (plan.status !== 'approved' ? <Btn kind="primary" icon="check" onClick={async () => { if (await ask('Duyệt cả kế hoạch? Mọi bài nháp/chờ duyệt thành "Đã duyệt" và hiện ở Thiết kế, Lịch đăng.', 'Duyệt', false)) setStatus('approved'); }}>Duyệt kế hoạch</Btn> : <Btn kind="ghost" onClick={() => setStatus('draft')}>Mở lại để sửa</Btn>)}
        </>} />
      {review && (changes > 0 || approvedByClient > 0 || review.overall) && (
        <div class={`claim ${changes ? 'err' : ''}`}><Icon name={changes ? 'warn' : 'check'} /><span class="grow">Khách đã phản hồi: <b>{approvedByClient}</b> bài duyệt{changes ? <>, <b>{changes}</b> bài cần sửa</> : null}{review.overall ? ` · tổng thể: ${review.overall.status === 'approved' ? 'đã duyệt' : 'cần sửa'} (${review.overall.by}, ${fmtTime(review.overall.at)})` : ''}.</span></div>
      )}
      {review?.comments?.length ? <details class="mk-card mk-cmts"><summary class="mk-card-h"><b>Bình luận của khách · {review.comments.length}</b></summary>{review.comments.slice().reverse().slice(0, 30).map((c, i) => { const r = c.row ? plan.rows.find((x) => x.id === c.row) : null; return <div key={i} class="mk-line static"><b>{c.by}</b><span class="grow">{r ? <span class="dim">[{r.date.slice(8, 10)}/{r.date.slice(5, 7)} {r.topic}] </span> : null}{c.text}</span><span class="dim small mono">{fmtTime(c.at)}</span></div>; })}</details> : null}
      <div class="row wrap mk-viewbar">
        <div class="seg">{VIEWS.map((x) => <button key={x.v} class={view === x.v ? 'on' : ''} onClick={() => setView(x.v)}><Icon name={x.icon} size={13} />{x.label}</button>)}</div>
        {write && <span class="grow" />}
        {write && <Btn sm kind="ghost" icon="trash" onClick={async () => { if (await ask(`Xoá "${plan.title}"? Không hoàn tác được.`)) { await deleteItem(client.id, 'plan', item.id); toast('Đã xoá kế hoạch.', 'ok'); } }}>Xoá</Btn>}
      </div>
      {view === 'table' && <Grid planId={item.id} plan={plan} review={review} write={write} onRow={updateRow} onAdd={() => { const last = plan.rows[plan.rows.length - 1]; void commit({ ...plan, rows: [...plan.rows, { id: newId('r'), date: last?.date || plan.setup.start, time: '19:30', channel: (plan.setup.channels[0] || 'facebook') as Channel, format: 'image', pillar: '', topic: 'Bài mới', hook: '', caption: '', cta: '', hashtags: '', visual: '', owner: '', status: 'draft' }] }, 'Thêm bài'); }} onDel={(id) => void commit({ ...plan, rows: plan.rows.filter((r) => r.id !== id) }, 'Xoá bài')} />}
      {view === 'calendar' && <CalendarView plan={plan} write={write} onRow={updateRow} />}
      {view === 'kanban' && <Kanban plan={plan} write={write} onRow={updateRow} />}
      {view === 'summary' && <Summary client={client} plan={plan} />}
      {view === 'budget' && <BudgetView plan={plan} />}
      {view === 'kpi' && <KpiView plan={plan} />}
      <section class="mk-card"><div class="mk-card-h"><b>Lịch sử phiên bản</b></div>{(plan.versions || []).slice().reverse().slice(0, 12).map((v) => <div key={v.version} class="mk-line static"><span class="chip mono">v{v.version}</span><span class="grow">{v.note}</span><span class="dim small">{v.by} · {fmtTime(v.at)}</span></div>)}</section>
    </>
  );
}

// ---------- Bảng (Sheets-like grid) ----------
function Grid({ plan, review, write, onRow, onAdd, onDel, planId }: { plan: Plan; review?: Review; write: boolean; onRow: (id: string, p: Partial<PlanRow>) => void; onAdd: () => void; onDel: (id: string) => void; planId: string }) {
  const store = useStore();
  const designOf = (r: PlanRow) => (r.designId && store.projects.find((x) => x.id === r.designId)) || store.projects.find((x) => x.kind === 'design' && x.rowRef?.planId === planId && x.rowRef.rowId === r.id);
  const [q, setQ] = useState('');
  const [ch, setCh] = useState('');
  const [st, setSt] = useState('');
  const [month, setMonth] = useState('');
  const [sort, setSort] = useState<'date' | 'channel' | 'status' | 'pillar'>('date');
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [limit, setLimit] = useState(150);
  const months = [...new Set(plan.rows.map((r) => r.date.slice(0, 7)))];
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = plan.rows.filter((r) => (!ch || r.channel === ch) && (!st || r.status === st) && (!month || r.date.startsWith(month)) && (!t || `${r.topic} ${r.hook} ${r.caption} ${r.pillar}`.toLowerCase().includes(t)));
    const key = (r: PlanRow) => (sort === 'date' ? r.date + r.time : sort === 'channel' ? r.channel + r.date : sort === 'status' ? STATUS_ORDER.indexOf(r.status) + r.date : r.pillar + r.date);
    return list.sort((a, b) => String(key(a)).localeCompare(String(key(b))));
  }, [plan.rows, q, ch, st, month, sort]);
  const groups: { label: string; rows: PlanRow[] }[] = [];
  for (const r of rows.slice(0, limit)) {
    const g = sort === 'date' ? monthLabel(r.date.slice(0, 7)) : sort === 'channel' ? channelOf(r.channel).label : sort === 'status' ? STATUS[r.status].label : r.pillar || 'Chưa có trụ cột';
    if (!groups.length || groups[groups.length - 1].label !== g) groups.push({ label: g, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  const cellView = (r: PlanRow, key: string) => {
    if (key === 'channel') { const c = channelOf(r.channel); return <span class="mk-chcell"><i style={{ background: c.color }} />{c.label}</span>; }
    if (key === 'format') return FORMATS.find((f) => f.id === r.format)?.label || r.format;
    if (key === 'status') { const d = review?.rows?.[r.id]; return <span class="row" style={{ gap: 4 }}><StatusChip s={r.status} />{d && <span class={`chip ${d.status === 'approved' ? 'on' : d.status === 'changes' ? 'err' : ''}`} title={`${d.by} · ${fmtTime(d.at)}`}>{d.status === 'approved' ? 'KH ✓' : d.status === 'changes' ? 'KH sửa' : 'KH'}</span>}</span>; }
    if (key === 'date') return r.date.slice(8, 10) + '/' + r.date.slice(5, 7);
    return String((r as unknown as Record<string, unknown>)[key] ?? '');
  };
  const editor = (r: PlanRow, c: (typeof COLS)[number]) => {
    const v = String((r as unknown as Record<string, unknown>)[c.key] ?? '');
    const done = (nv: string) => { setEditing(null); if (nv !== v) onRow(r.id, { [c.key]: nv } as Partial<PlanRow>); };
    const common = { autoFocus: true, class: 'in', onBlur: (e: Event) => done((e.target as HTMLInputElement).value), onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Escape') setEditing(null); if (e.key === 'Enter' && !(c.edit === 'long' && e.shiftKey)) (e.target as HTMLElement).blur(); } };
    if (c.edit === 'channel') return <select {...common} value={v} onChange={(e) => done((e.target as HTMLSelectElement).value)}>{CHANNELS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>;
    if (c.edit === 'format') return <select {...common} value={v} onChange={(e) => done((e.target as HTMLSelectElement).value)}>{FORMATS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>;
    if (c.edit === 'status') return <select {...common} value={v} onChange={(e) => done((e.target as HTMLSelectElement).value)}>{STATUS_ORDER.map((x) => <option key={x} value={x}>{STATUS[x].label}</option>)}</select>;
    if (c.edit === 'date' || c.edit === 'time') return <input {...common} type={c.edit} defaultValue={v} />;
    if (c.edit === 'long') return <textarea {...common} rows={4} defaultValue={v} />;
    return <input {...common} defaultValue={v} />;
  };
  return (
    <>
      <div class="row wrap mk-filters">
        <label class="search mk-search"><Icon name="search" size={14} /><input value={q} placeholder="Tìm trong chủ đề, hook, caption…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Tìm bài" /></label>
        <select class="in" value={month} onChange={(e) => setMonth((e.target as HTMLSelectElement).value)} aria-label="Lọc theo tháng"><option value="">Mọi tháng</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}</select>
        <select class="in" value={ch} onChange={(e) => setCh((e.target as HTMLSelectElement).value)} aria-label="Lọc theo kênh"><option value="">Mọi kênh</option>{plan.setup.channels.map((c) => <option key={c} value={c}>{channelOf(c).label}</option>)}</select>
        <select class="in" value={st} onChange={(e) => setSt((e.target as HTMLSelectElement).value)} aria-label="Lọc theo trạng thái"><option value="">Mọi trạng thái</option>{STATUS_ORDER.map((x) => <option key={x} value={x}>{STATUS[x].label}</option>)}</select>
        <select class="in" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as typeof sort)} aria-label="Nhóm và sắp xếp"><option value="date">Nhóm theo tháng</option><option value="channel">Nhóm theo kênh</option><option value="status">Nhóm theo trạng thái</option><option value="pillar">Nhóm theo trụ cột</option></select>
        <span class="dim small mono">{rows.length}/{plan.rows.length} bài</span>
      </div>
      <div class="mk-sheet" role="grid" aria-rowcount={rows.length}>
        <table>
          <thead><tr><th class="sticky-c">#</th><th>Ảnh</th>{COLS.map((c) => <th key={c.key} style={{ minWidth: (c.width || 12) * 7 }}>{c.label}</th>)}{write && <th />}</tr></thead>
          <tbody>
            {groups.map((g) => [
              <tr key={'g' + g.label} class="grp"><td class="sticky-c" colSpan={1}><Icon name="chevron" size={11} /></td><td colSpan={COLS.length + 1 + (write ? 1 : 0)}><b>{g.label}</b> <span class="dim">· {g.rows.length} bài</span></td></tr>,
              ...g.rows.map((r) => (
                <tr key={r.id} class={`st-${r.status}`} style={{ ['--ch' as string]: channelOf(r.channel).color }}>
                  <td class="sticky-c mono dim">{plan.rows.indexOf(r) + 1}</td>
                  <td class="c-img sm">{(() => { const d = designOf(r); return <button class={`mk-thumb sm ${d ? '' : 'empty'}`} onClick={() => (d ? void import('../../pipeline/actions').then((A) => A.openProject(d.id)) : go({ view: 'client', id: store.mkt.view === 'client' ? store.mkt.id : '', tab: 'design' }))} title={d ? 'Bấm để chỉnh sửa ảnh' : 'Chưa có ảnh · làm ở tab Thiết kế'} aria-label={d ? `Chỉnh sửa ảnh bài ${r.topic}` : 'Chưa có ảnh'}>{d?.thumb ? <img src={d.thumb} alt="" loading="lazy" /> : <Icon name="image" size={14} />}</button>; })()}</td>
                  {COLS.map((c) => {
                    const on = editing?.id === r.id && editing.key === c.key;
                    return <td key={c.key} class={`c-${c.key} ${on ? 'editing' : ''}`} tabIndex={write ? 0 : -1} onDblClick={() => write && setEditing({ id: r.id, key: c.key })} onKeyDown={(e) => { if (write && !on && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); setEditing({ id: r.id, key: c.key }); } }} onClick={() => write && ['status', 'channel', 'format'].includes(c.key) && setEditing({ id: r.id, key: c.key })} title={on ? undefined : String((r as unknown as Record<string, unknown>)[c.key] ?? '')}>
                      {on ? editor(r, c) : <div class="cv">{cellView(r, c.key)}</div>}
                    </td>;
                  })}
                  {write && <td><Btn xs kind="ghost" icon="trash" title="Xoá bài" onClick={() => onDel(r.id)} /></td>}
                </tr>
              )),
            ])}
          </tbody>
        </table>
        {!rows.length && <div class="mk-none">Không có bài nào khớp bộ lọc.</div>}
      </div>
      <div class="row" style={{ marginTop: 8 }}>
        {rows.length > limit && <Btn sm onClick={() => setLimit(limit + 150)}>Hiện thêm {Math.min(150, rows.length - limit)} bài</Btn>}
        {write && <Btn sm icon="plus" onClick={onAdd}>Thêm bài</Btn>}
        <span class="dim small">Bấm đúp (hoặc Enter) vào ô để sửa. Thay đổi tự lưu.</span>
      </div>
    </>
  );
}
const monthLabel = (m: string) => `Tháng ${Number(m.slice(5, 7))}/${m.slice(0, 4)}`;

// ---------- Lịch ----------
function CalendarView({ plan, write, onRow }: { plan: Plan; write: boolean; onRow: (id: string, p: Partial<PlanRow>) => void }) {
  const months = [...new Set([...plan.months.map((m) => m.month), ...plan.rows.map((r) => r.date.slice(0, 7))])].sort();
  const [m, setM] = useState(months[0] || plan.setup.start.slice(0, 7));
  const [drag, setDrag] = useState<string | null>(null);
  const first = new Date(`${m}-01T00:00:00Z`);
  const lead = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const events = vnMarketingDates(`${m}-01`, `${m}-${String(days).padStart(2, '0')}`);
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${m}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const i = months.indexOf(m);
  return (
    <div class="mk-card">
      <div class="mk-card-h"><Btn xs kind="ghost" icon="chevron" class="flip" disabled={i <= 0} onClick={() => setM(months[i - 1])} title="Tháng trước" /><b>{monthLabel(m)}</b><Btn xs kind="ghost" icon="chevron" disabled={i >= months.length - 1} onClick={() => setM(months[i + 1])} title="Tháng sau" /><span class="grow" /><span class="dim small">{plan.months.find((x) => x.month === m)?.theme}</span></div>
      <div class="mk-cal">
        {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => <div key={d} class="mk-cal-h">{d}</div>)}
        {cells.map((d, k) => (
          <div key={k} class={`mk-cal-d ${d ? '' : 'off'}`} onDragOver={(e) => { if (d && drag) e.preventDefault(); }} onDrop={() => { if (d && drag && write) onRow(drag, { date: d }); setDrag(null); }}>
            {d && <span class="n">{Number(d.slice(8))}</span>}
            {d && events.filter((e) => e.date === d).map((e) => <span key={e.name} class="mk-ev">{e.name}</span>)}
            {d && plan.rows.filter((r) => r.date === d).sort((a, b) => a.time.localeCompare(b.time)).map((r) => (
              <span key={r.id} class={`mk-pill st-${r.status}`} draggable={write} onDragStart={() => setDrag(r.id)} style={{ borderColor: channelOf(r.channel).color }} title={`${r.time} · ${channelOf(r.channel).label} · ${r.topic}\n${STATUS[r.status].label}`}><i style={{ background: channelOf(r.channel).color }} />{r.time} {r.topic}</span>
            ))}
          </div>
        ))}
      </div>
      {write && <div class="dim small" style={{ padding: '8px 12px' }}>Kéo bài sang ngày khác để đổi lịch.</div>}
    </div>
  );
}

// ---------- Kanban ----------
function Kanban({ plan, write, onRow }: { plan: Plan; write: boolean; onRow: (id: string, p: Partial<PlanRow>) => void }) {
  const [drag, setDrag] = useState<string | null>(null);
  return (
    <div class="mk-kanban">
      {STATUS_ORDER.map((st) => {
        const list = plan.rows.filter((r) => r.status === st);
        return (
          <div key={st} class="mk-col" onDragOver={(e) => { if (drag) e.preventDefault(); }} onDrop={() => { if (drag && write) onRow(drag, { status: st }); setDrag(null); }}>
            <div class="mk-col-h"><StatusChip s={st} /><span class="dim mono small">{list.length}</span></div>
            {list.slice(0, 80).map((r) => (
              <div key={r.id} class="mk-kcard" draggable={write} onDragStart={() => setDrag(r.id)} style={{ borderLeftColor: channelOf(r.channel).color }}>
                <span class="dim small mono">{r.date.slice(8, 10)}/{r.date.slice(5, 7)} {r.time} · {channelOf(r.channel).short}</span>
                <b>{r.topic}</b>
                {r.note && <span class="small" style={{ color: 'var(--warn)' }}>{r.note}</span>}
              </div>
            ))}
            {list.length > 80 && <span class="dim small">+{list.length - 80} bài</span>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Tóm tắt (1 trang cho sếp khách) ----------
function Summary({ client, plan }: { client: Client; plan: Plan }) {
  const byCh = plan.setup.channels.map((c) => ({ c, n: plan.rows.filter((r) => r.channel === c).length, money: plan.months.reduce((a, m) => a + (m.budget[c] || 0), 0) }));
  const kpiTotals = plan.kpiNames.map((k) => ({ k, v: plan.months.reduce((a, m) => a + (m.kpi[k] || 0), 0) }));
  return (
    <div class="mk-summary" id="mk-summary">
      <div class="mk-sum-h"><div><span class="mk-eyebrow">{client.name} · {plan.setup.months} tháng</span><h2>{plan.title}</h2></div><Btn sm icon="download" onClick={() => printPlan(client, plan)}>In / PDF</Btn></div>
      <p class="mk-sum-strat">{plan.strategy}</p>
      <div class="mk-kpis">
        <div class="mk-kpi"><span class="l">Ngân sách</span><b>{fmtMoney(plan.setup.budget, plan.setup.currency)}</b></div>
        <div class="mk-kpi"><span class="l">Số bài</span><b>{plan.rows.length}</b></div>
        {kpiTotals.slice(0, 2).map((x) => <div key={x.k} class="mk-kpi"><span class="l">{x.k} (tổng)</span><b>{x.v.toLocaleString('vi-VN')}</b></div>)}
      </div>
      <div class="mk-cols">
        <section class="mk-card"><div class="mk-card-h"><b>Trụ cột nội dung</b></div>{plan.pillars.map((p) => <div key={p.name} class="mk-line static"><span class="grow"><b>{p.name}</b><br /><span class="dim small">{p.desc}</span></span><span class="mk-bar sm"><i style={{ width: `${p.share}%` }} /><em>{p.share}%</em></span></div>)}</section>
        <section class="mk-card"><div class="mk-card-h"><b>Theo kênh</b></div>{byCh.map((x) => <div key={x.c} class="mk-line static"><span class="mk-chcell grow"><i style={{ background: channelOf(x.c).color }} />{channelOf(x.c).label}</span><span class="dim small">{x.n} bài</span><b class="mono">{fmtMoney(x.money, plan.setup.currency)}</b></div>)}</section>
      </div>
      <section class="mk-card"><div class="mk-card-h"><b>Từng tháng</b></div>
        {plan.months.map((m) => <div key={m.month} class="mk-line static mk-month"><b class="mono">{monthLabel(m.month)}</b><span class="grow">{m.theme}<br /><span class="dim small">{m.campaigns.map((c) => c.name).join(' · ')}</span></span><span class="mono">{fmtMoney(Object.values(m.budget).reduce((a, b) => a + b, 0), plan.setup.currency)}</span></div>)}
      </section>
    </div>
  );
}

// ---------- Ngân sách / KPI ----------
function BudgetView({ plan }: { plan: Plan }) {
  const max = Math.max(1, ...plan.months.map((m) => Object.values(m.budget).reduce((a, b) => a + b, 0)));
  const total = plan.months.reduce((a, m) => a + Object.values(m.budget).reduce((x, y) => x + y, 0), 0);
  return (
    <div class="mk-card">
      <div class="mk-card-h"><b>Phân bổ ngân sách</b><span class="dim small">tổng {fmtMoney(total, plan.setup.currency)}</span><span class="grow" /><span class="row small">{plan.setup.channels.map((c) => <span key={c} class="mk-chcell"><i style={{ background: channelOf(c).color }} />{channelOf(c).short}</span>)}</span></div>
      <div class="mk-bars" role="img" aria-label="Biểu đồ ngân sách theo tháng và kênh">
        {plan.months.map((m) => { const t = Object.values(m.budget).reduce((a, b) => a + b, 0); return (
          <div key={m.month} class="mk-bcol" title={`${monthLabel(m.month)}: ${fmtMoney(t, plan.setup.currency)}`}>
            <span class="v mono">{t >= 1e6 ? `${Math.round(t / 1e5) / 10}tr` : fmtMoney(t, plan.setup.currency)}</span>
            <div class="stack" style={{ height: `${(t / max) * 100}%` }}>{plan.setup.channels.map((c) => <i key={c} style={{ flex: m.budget[c] || 0, background: channelOf(c).color }} />)}</div>
            <span class="l">T{Number(m.month.slice(5))}</span>
          </div>
        ); })}
      </div>
      <div class="mk-sheet small-t"><table><thead><tr><th class="sticky-c">Tháng</th>{plan.setup.channels.map((c) => <th key={c}>{channelOf(c).label}</th>)}<th>Tổng</th></tr></thead>
        <tbody>{plan.months.map((m) => <tr key={m.month}><td class="sticky-c">{monthLabel(m.month)}</td>{plan.setup.channels.map((c) => <td key={c} class="mono mk-num">{(m.budget[c] || 0).toLocaleString('vi-VN')}</td>)}<td class="mono mk-num"><b>{Object.values(m.budget).reduce((a, b) => a + b, 0).toLocaleString('vi-VN')}</b></td></tr>)}</tbody></table></div>
    </div>
  );
}
function KpiView({ plan }: { plan: Plan }) {
  return (
    <div class="mk-cols">
      {plan.kpiNames.map((k) => { const max = Math.max(1, ...plan.months.map((m) => m.kpi[k] || 0)); return (
        <section key={k} class="mk-card"><div class="mk-card-h"><b>{k}</b><span class="dim small mono">tổng {plan.months.reduce((a, m) => a + (m.kpi[k] || 0), 0).toLocaleString('vi-VN')}</span></div>
          <div class="mk-bars short">{plan.months.map((m) => <div key={m.month} class="mk-bcol" title={`${monthLabel(m.month)}: ${(m.kpi[k] || 0).toLocaleString('vi-VN')}`}><span class="v mono">{(m.kpi[k] || 0) >= 1000 ? `${Math.round((m.kpi[k] || 0) / 100) / 10}k` : m.kpi[k] || 0}</span><div class="stack" style={{ height: `${((m.kpi[k] || 0) / max) * 100}%` }}><i style={{ flex: 1, background: 'var(--neon-dim)' }} /></div><span class="l">T{Number(m.month.slice(5))}</span></div>)}</div>
        </section>
      ); })}
      <p class="dim small" style={{ gridColumn: '1 / -1' }}>KPI là mục tiêu ước tính, không phải cam kết. Số thật sẽ lấy từ nền tảng ở module Báo cáo.</p>
    </div>
  );
}

// ---------- export ----------
const lighten = (hex: string) => { const n = parseInt(hex.slice(1), 16); const m = (c: number) => Math.round(c + (255 - c) * 0.82).toString(16).padStart(2, '0'); return `${m(n >> 16)}${m((n >> 8) & 255)}${m(n & 255)}`; };
function exportRows(plan: Plan) { return plan.rows.map((r) => ({ ...r, channel: channelOf(r.channel).label, format: FORMATS.find((f) => f.id === r.format)?.label || r.format, status: STATUS[r.status].label })); }
function download(name: string, data: BlobPart, type: string) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
const fileBase = (client: Client, plan: Plan) => `${client.name}-${plan.title}`.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase().slice(0, 80);

function ExportMenu({ client, plan }: { client: Client; plan: Plan }) {
  const [open, setOpen] = useState(false);
  const xlsx = () => {
    const fills: Record<number, string> = {}; plan.rows.forEach((r, i) => { fills[i] = lighten(channelOf(r.channel).color); });
    const budgetRows = plan.months.map((m) => ({ month: monthLabel(m.month), ...m.budget, total: Object.values(m.budget).reduce((a, b) => a + b, 0) }));
    const kpiRows = plan.months.map((m) => ({ month: monthLabel(m.month), ...m.kpi }));
    const stratRows = [...plan.pillars.map((p) => ({ a: 'Trụ cột', b: p.name, c: `${p.share}%`, d: p.desc })), ...plan.months.flatMap((m) => m.campaigns.map((c) => ({ a: monthLabel(m.month), b: c.name, c: c.budget, d: `${c.goal}. ${c.note}` })))];
    const bytes = toXlsx([
      { name: 'Lịch nội dung', cols: COLS, rows: exportRows(plan), fills },
      { name: 'Ngân sách', cols: [{ key: 'month', label: 'Tháng', width: 14 }, ...plan.setup.channels.map((c) => ({ key: c, label: channelOf(c).label, width: 16 })), { key: 'total', label: 'Tổng', width: 16 }], rows: budgetRows },
      { name: 'KPI', cols: [{ key: 'month', label: 'Tháng', width: 14 }, ...plan.kpiNames.map((k) => ({ key: k, label: k, width: 16 }))], rows: kpiRows },
      { name: 'Chiến lược', cols: [{ key: 'a', label: 'Mục', width: 16 }, { key: 'b', label: 'Tên', width: 30 }, { key: 'c', label: 'Tỉ lệ / Ngân sách', width: 18 }, { key: 'd', label: 'Mô tả', width: 70 }], rows: [{ a: 'Chiến lược', b: plan.title, c: '', d: plan.strategy }, ...stratRows] },
    ]);
    download(`${fileBase(client, plan)}.xlsx`, bytes as BlobPart, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    toast('Đã xuất XLSX. Mở bằng Excel, hoặc Google Sheets → Tệp → Nhập.', 'ok'); setOpen(false);
  };
  const csv = () => { download(`${fileBase(client, plan)}.csv`, toCsv(exportRows(plan), COLS), 'text/csv;charset=utf-8'); setOpen(false); };
  return (
    <span class="mk-menu">
      <Btn icon="download" onClick={() => setOpen(!open)} title="Xuất kế hoạch">Xuất</Btn>
      {open && <div class="mk-menu-pop" onMouseLeave={() => setOpen(false)}>
        <button onClick={xlsx}><b>Excel / Google Sheets (.xlsx)</b><span>4 trang: lịch, ngân sách, KPI, chiến lược; tô màu theo kênh</span></button>
        <button onClick={csv}><b>CSV</b><span>lịch nội dung</span></button>
        <button onClick={() => { setOpen(false); printPlan(client, plan); }}><b>PDF</b><span>tóm tắt + lịch, in hoặc lưu PDF</span></button>
      </div>}
    </span>
  );
}

function printPlan(client: Client, plan: Plan) {
  const w = window.open('', '_blank'); if (!w) { toast('Trình duyệt chặn cửa sổ in. Cho phép popup rồi thử lại.', 'err'); return; }
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const money = (n: number) => fmtMoney(n, plan.setup.currency);
  w.document.write(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${esc(plan.title)}</title><style>
    body{font:11px/1.45 Inter,-apple-system,Segoe UI,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;margin:18px 0 6px;border-bottom:2px solid #39ff14;padding-bottom:3px}
    .k{color:#555;font-size:10px;text-transform:uppercase;letter-spacing:1px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:4px 6px;vertical-align:top;text-align:left}th{background:#f2f5f3}
    .ch{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media print{.pb{page-break-before:always}}
  </style></head><body>
  <div class="k">${esc(client.name)} · ${plan.setup.months} tháng từ ${esc(plan.setup.start)} · ${money(plan.setup.budget)}</div><h1>${esc(plan.title)}</h1><p>${esc(plan.strategy)}</p>
  <div class="grid"><div><h2>Trụ cột nội dung</h2><table>${plan.pillars.map((p) => `<tr><td><b>${esc(p.name)}</b><br>${esc(p.desc)}</td><td>${p.share}%</td></tr>`).join('')}</table></div>
  <div><h2>Ngân sách theo tháng</h2><table><tr><th>Tháng</th><th>Chủ đề</th><th>Ngân sách</th></tr>${plan.months.map((m) => `<tr><td>${monthLabel(m.month)}</td><td>${esc(m.theme)}</td><td>${money(Object.values(m.budget).reduce((a, b) => a + b, 0))}</td></tr>`).join('')}</table></div></div>
  <h2>KPI (ước tính)</h2><table><tr><th>Tháng</th>${plan.kpiNames.map((k) => `<th>${esc(k)}</th>`).join('')}</tr>${plan.months.map((m) => `<tr><td>${monthLabel(m.month)}</td>${plan.kpiNames.map((k) => `<td>${(m.kpi[k] || 0).toLocaleString('vi-VN')}</td>`).join('')}</tr>`).join('')}</table>
  <h2 class="pb">Lịch nội dung (${plan.rows.length} bài)</h2><table><tr><th>Ngày</th><th>Kênh</th><th>Định dạng</th><th>Chủ đề</th><th>Hook</th><th>CTA</th><th>Trạng thái</th></tr>
  ${plan.rows.map((r) => `<tr><td>${esc(r.date.split('-').reverse().join('/'))} ${esc(r.time)}</td><td><span class="ch" style="background:${channelOf(r.channel).color}"></span>${esc(channelOf(r.channel).label)}</td><td>${esc(FORMATS.find((f) => f.id === r.format)?.label)}</td><td>${esc(r.topic)}</td><td>${esc(r.hook)}</td><td>${esc(r.cta)}</td><td>${esc(STATUS[r.status].label)}</td></tr>`).join('')}</table>
  <p class="k" style="margin-top:16px">Phloem MKT · KPI là ước tính, không phải cam kết.</p>
  <script>setTimeout(()=>print(),300)</script></body></html>`);
  w.document.close();
}

// ---------- Thiết kế / Lịch đăng: work generated by approved rows ----------
export function ApprovedWork({ client, mode }: { client: Client; mode: 'design' | 'calendar' }) {
  const { plans } = usePlans(client);
  const st = useStore();
  const write = canWrite(client.role);
  const rows = plans.flatMap((p) => (p.data.rows || []).filter((r) => (mode === 'design' ? r.status === 'approved' : ['approved', 'scheduled', 'live'].includes(r.status))).map((r) => ({ ...r, planId: p.id, plan: p })));
  rows.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const today = new Date().toISOString().slice(0, 10);
  const setRow = async (planId: string, id: string, patch: Partial<PlanRow>, note: string) => {
    const p = plans.find((x) => x.id === planId); if (!p) return;
    const version = (p.data.version || 1) + 1;
    try { await putItem(client.id, 'plan', planId, { ...p.data, rows: p.data.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)), version, versions: [...(p.data.versions || []), { version, at: new Date().toISOString(), by: get().user?.name || 'Bạn', note }].slice(-40) }); }
    catch (e) { toast((e as Error).message, 'err'); }
  };
  const copy = (r: PlanRow) => { void navigator.clipboard?.writeText(`${r.hook ? r.hook + '\n\n' : ''}${r.caption}\n\n${r.cta}\n${r.hashtags}`.trim()).then(() => toast('Đã copy caption + CTA + hashtag.', 'ok')); };
  const upcoming = rows.filter((r) => mode === 'design' || r.date >= today);
  return (
    <>
      <PageHead title={mode === 'design' ? 'Thiết kế' : 'Lịch đăng'} chips={<span class="chip">{mode === 'design' ? 'Giai đoạn 3: Phloem Design' : 'Giai đoạn 4: đăng qua API'}</span>}
        sub={mode === 'design' ? 'Bài đã duyệt trong kế hoạch tự thành việc thiết kế ở đây. Editor Phloem Design (ảnh, video, đổi cỡ thần kỳ) đến ở giai đoạn 3.' : 'Chế độ đăng tay: bài đã duyệt hiện theo giờ đăng; copy caption, đăng trên nền tảng, rồi đánh dấu Đã đăng. Đăng tự động qua API cần app được Meta/TikTok/LinkedIn duyệt.'} />
      {!upcoming.length ? <Empty icon={mode === 'design' ? 'shapes' : 'send'} title={mode === 'design' ? 'Chưa có bài nào cần thiết kế' : 'Chưa có bài nào sắp đăng'} action={<Btn onClick={() => go({ view: 'client', id: client.id, tab: 'plan' })}>Mở kế hoạch</Btn>}>Duyệt bài trong kế hoạch (hoặc gửi khách duyệt qua link), bài đã duyệt sẽ hiện ở đây.</Empty> : (
        <div class="mk-work">
          {upcoming.slice(0, 120).map((r) => (
            <div key={r.planId + r.id} class="mk-wcard" style={{ borderTopColor: channelOf(r.channel).color }}>
              <div class="row"><span class="mk-chcell"><i style={{ background: channelOf(r.channel).color }} />{channelOf(r.channel).label}</span><span class="dim small">{FORMATS.find((f) => f.id === r.format)?.label}</span><span class="grow" /><StatusChip s={r.status} /></div>
              <span class="mono small">{r.date.split('-').reverse().join('/')} · {r.time}</span>
              <b>{r.topic}</b>
              {r.designId && (() => { const d = st.projects.find((x) => x.id === r.designId); return d?.thumb ? <img class="mk-wthumb" src={d.thumb} alt={`Thiết kế cho ${r.topic}`} onClick={() => void import('../../pipeline/actions').then((A) => A.openProject(d.id))} style={{ cursor: 'pointer' }} title="Mở thiết kế (xuất PNG/JPG ở tab Xuất ảnh)" /> : null; })()}
              {mode === 'design' ? <p class="small muted"><Icon name="image" size={12} /> {r.visual || 'Chưa có ý tưởng hình ảnh'}</p> : <p class="small muted mk-clamp">{r.hook || r.caption}</p>}
              {write && <div class="row wrap">
                <Btn xs icon="copy" onClick={() => copy(r)}>Copy caption</Btn>
                {mode === 'calendar' && r.status === 'approved' && <Btn xs onClick={() => void setRow(r.planId, r.id, { status: 'scheduled' }, `Lên lịch: ${r.topic}`)}>Đã lên lịch</Btn>}
                {mode === 'calendar' && r.status !== 'live' && <Btn xs kind="primary" onClick={() => void setRow(r.planId, r.id, { status: 'live' }, `Đã đăng tay: ${r.topic}`)}>Đã đăng</Btn>}
                {mode === 'design' && <Btn xs onClick={() => void setRow(r.planId, r.id, { status: 'scheduled' }, `Thiết kế xong: ${r.topic}`)}>Thiết kế xong</Btn>}
              </div>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
