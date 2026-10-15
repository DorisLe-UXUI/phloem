// Phloem Email audience: the Mailchimp side of the app. One page per scope (personal, or a client workspace) with
// contacts, segments, signup forms, automations, reports and sending setup.
import { useEffect, useState } from 'preact/hooks';
import { set, toast, useStore } from '../../store';
import { audLists, createList, type AudList, type SenderRef } from '../../pipeline/audience';
import { mailSignedIn } from '../../pipeline/mailServer';
import * as A from '../../pipeline/actions';
import { Btn } from '../components';
import { Icon, Logo } from '../icons';
import { ContactsTab } from './Contacts';
import { SegmentsTab } from './Segments';
import { FormsTab } from './Forms';
import { AutomationsTab } from './Automations';
import { ReportsTab } from './Reports';
import { SettingsTab } from './Settings';

export type AudTab = 'contacts' | 'segments' | 'forms' | 'automations' | 'reports' | 'settings';
export interface AudCtx { client: string | null; lists: AudList[]; senders: SenderRef[]; role: string; list: AudList | null; setList: (id: string) => void; reload: () => Promise<void>; canWrite: boolean }
const TABS: { id: AudTab; label: string; icon: 'grid' | 'layers' | 'mail' | 'bolt' | 'reflow' | 'settings' }[] = [
  { id: 'contacts', label: 'Danh bạ', icon: 'grid' },
  { id: 'segments', label: 'Phân nhóm', icon: 'layers' },
  { id: 'forms', label: 'Form đăng ký', icon: 'mail' },
  { id: 'automations', label: 'Tự động', icon: 'bolt' },
  { id: 'reports', label: 'Báo cáo', icon: 'reflow' },
  { id: 'settings', label: 'Gửi & tên miền', icon: 'settings' },
];
const LS = 'phloem.aud.ui';
const ui = (): { tab?: AudTab; list?: Record<string, string> } => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; } };
const keepUi = (patch: object) => { try { localStorage.setItem(LS, JSON.stringify({ ...ui(), ...patch })); } catch { /* ignore */ } };

export function AudiencePage() {
  const s = useStore();
  const client = s.clientFilter && s.clientFilter !== '-' && s.clients.some((c) => c.id === s.clientFilter) ? s.clientFilter : null;
  const scopeKey = client || 'me';
  const [tab, setTab] = useState<AudTab>(ui().tab || 'contacts');
  const [lists, setLists] = useState<AudList[] | null>(null);
  const [senders, setSenders] = useState<SenderRef[]>([]);
  const [role, setRole] = useState('owner');
  const [listId, setListId] = useState<string>(ui().list?.[scopeKey] || '');
  const [err, setErr] = useState('');
  const reload = async () => {
    try { const r = await audLists(client); setLists(r.lists); setSenders(r.senders); setRole(r.role); setErr(''); if (!r.lists.some((l) => l.id === listId) && r.lists[0]) setListId(r.lists[0].id); }
    catch (e) { setErr((e as Error).message); setLists([]); }
  };
  useEffect(() => { setLists(null); setListId(ui().list?.[scopeKey] || ''); if (mailSignedIn()) void reload(); }, [scopeKey]);
  useEffect(() => { void A.loadEmailClients(); }, []);
  const list = lists?.find((l) => l.id === listId) || lists?.[0] || null;
  const ctx: AudCtx = { client, lists: lists || [], senders, role, list, setList: (id) => { setListId(id); keepUi({ list: { ...(ui().list || {}), [scopeKey]: id } }); }, reload, canWrite: role !== 'client_viewer' };
  const go = (t: AudTab) => { setTab(t); keepUi({ tab: t }); void reload(); }; // counts move with sign-ups and sends
  const clientName = client ? s.clients.find((c) => c.id === client)?.name : null;
  const [naming, setNaming] = useState<string | null>(null);
  const newList = () => setNaming(clientName ? `${clientName} · Khách hàng` : 'Khách hàng');
  const createNamed = async () => {
    const name = (naming || '').trim(); if (!name) return;
    try { const r = await createList(client, { name, company: { name: clientName || s.user?.brand || '', address: '' } }); setNaming(null); await reload(); ctx.setList(r.list.id); toast('Đã tạo danh sách.', 'ok'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const namingBox = naming !== null && (
    <div class="row aud-bulk" style={{ gap: 8 }}>
      <b>Tên danh sách</b>
      <input class="in" autoFocus style={{ maxWidth: 320, height: 30 }} value={naming} onInput={(e) => setNaming((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void createNamed(); if (e.key === 'Escape') setNaming(null); }} placeholder="Khách hàng, Bản tin, Khách VIP…" />
      <Btn sm kind="primary" onClick={() => void createNamed()}>Tạo</Btn><Btn sm kind="ghost" onClick={() => setNaming(null)}>Huỷ</Btn>
    </div>
  );

  return (
    <div class="home adm aud">
      <div class="home-top">
        <Logo size={20} onClick={() => set({ route: { name: 'home' } })} />
        <span class="chip on">Khán giả</span>
        <select class="in" style={{ maxWidth: 220, height: 30 }} value={client || ''} onChange={(e) => set({ clientFilter: (e.target as HTMLSelectElement).value || null })} title="Mỗi khách hàng có danh bạ riêng">
          <option value="">Cá nhân</option>
          {s.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span class="grow" />
        <Btn kind="ghost" sm icon="home" onClick={() => set({ route: { name: 'home' } })}>Về Home</Btn>
      </div>
      <div class="home-body">
        {!mailSignedIn() ? (
          <div class="card"><b>Đăng nhập tài khoản Phloem</b><div class="small muted">Danh bạ, form đăng ký, chuỗi tự động và báo cáo nằm trên relay, cần tài khoản Phloem.</div><Btn sm kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập</Btn></div>
        ) : (
          <>
            <div class="aud-head">
              <div class="grow">
                <h1>Khán giả{clientName ? <> · <em>{clientName}</em></> : ''}</h1>
                <p class="small muted">Danh bạ, phân nhóm, form đăng ký, chuỗi email tự động và báo cáo{client ? ', riêng cho khách hàng này: chỉ người trong workspace xem được' : ''}.</p>
              </div>
              {lists && lists.length > 0 && (
                <div class="row" style={{ gap: 6 }}>
                  <span class="dim small">Danh sách</span>
                  <select class="in" style={{ height: 32, minWidth: 200 }} value={list?.id || ''} onChange={(e) => ctx.setList((e.target as HTMLSelectElement).value)}>
                    {lists.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.counts.subscribed.toLocaleString('vi-VN')}</option>)}
                  </select>
                  {ctx.canWrite && <Btn sm icon="plus" onClick={newList}>Danh sách</Btn>}
                </div>
              )}
            </div>
            {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
            {namingBox}
            {lists === null ? <div class="card"><div class="progress"><i class="indet" /></div><div class="dim small">Đang tải (relay có thể đang thức dậy)…</div></div> : (
              <>
                {list && (
                  <div class="aud-tiles">
                    <div class="adm-tile"><span>Đang nhận</span><b>{list.counts.subscribed.toLocaleString('vi-VN')}</b><i>trong {list.total.toLocaleString('vi-VN')} liên hệ</i></div>
                    <div class="adm-tile"><span>Chờ xác nhận</span><b>{list.counts.pending.toLocaleString('vi-VN')}</b><i>đăng ký 2 bước</i></div>
                    <div class="adm-tile"><span>Đã huỷ</span><b>{list.counts.unsubscribed.toLocaleString('vi-VN')}</b><i>không bao giờ gửi lại</i></div>
                    <div class="adm-tile"><span>Thư dội · spam</span><b>{(list.counts.bounced + list.counts.complained).toLocaleString('vi-VN')}</b><i>tự loại khỏi mọi lần gửi</i></div>
                  </div>
                )}
                <div class="seg aud-tabs">
                  {TABS.map((t) => <button key={t.id} class={tab === t.id ? 'on' : ''} onClick={() => go(t.id)}><Icon name={t.icon} size={13} />{t.label}</button>)}
                </div>
                {tab === 'reports' ? <ReportsTab ctx={ctx} /> : !list ? (
                  <div class="card aud-empty">
                    <Icon name="mail" size={28} style={{ color: 'var(--neon)' }} />
                    <b>Tạo danh sách đầu tiên</b>
                    <div class="small muted">Một danh sách là một nhóm người đã đồng ý nhận email (khách hàng, người đăng ký bản tin…). Nhập từ CSV, thêm tay, hoặc để họ tự đăng ký qua form.</div>
                    {ctx.canWrite ? (naming === null && <Btn kind="primary" icon="plus" onClick={newList}>Tạo danh sách</Btn>) : <div class="dim small">Bạn chỉ có quyền xem.</div>}
                  </div>
                ) : (
                  <>
                    {tab === 'contacts' && <ContactsTab ctx={ctx} list={list} />}
                    {tab === 'segments' && <SegmentsTab ctx={ctx} list={list} />}
                    {tab === 'forms' && <FormsTab ctx={ctx} list={list} />}
                    {tab === 'automations' && <AutomationsTab ctx={ctx} list={list} />}
                    {tab === 'settings' && <SettingsTab ctx={ctx} list={list} />}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '–');
export const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '–');
