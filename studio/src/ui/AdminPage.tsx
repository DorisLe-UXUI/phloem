// Database console for admins: what lives on the relay (users, projects, images, AI codes), backups, export.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { set, toast, useStore } from '../store';
import { adminGrant, backupNow, dbConsole, deleteUser, exportDb, type DbConsole } from '../ai/access';
import { downloadBytes } from '../../../src/ui/clipboard';
import { Btn } from './components';
import { Icon, Logo } from './icons';
import { ask } from './confirm';

const kb = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(0, Math.round(b / 1024))} KB`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const ago = (iso: string | null) => { if (!iso) return '—'; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'vừa xong' : m < 60 ? `${m} phút trước` : m < 1440 ? `${Math.round(m / 60)} giờ trước` : `${Math.round(m / 1440)} ngày trước`; };
type Tab = 'users' | 'projects' | 'assets';

export function AdminPage() {
  const s = useStore();
  const [d, setD] = useState<DbConsole | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>('users');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const load = async () => { setErr(''); try { setD(await dbConsole()); } catch (e) { setErr((e as Error).message); } };
  useEffect(() => { void load(); }, []);
  const ql = q.trim().toLowerCase();
  const match = (...xs: (string | null | undefined)[]) => !ql || xs.some((x) => (x || '').toLowerCase().includes(ql));
  const users = useMemo(() => (d?.users || []).filter((u) => match(u.name, u.email, u.brand)), [d, ql]);
  const projects = useMemo(() => (d?.projects || []).filter((p) => match(p.name, p.owner)), [d, ql]);
  const assets = useMemo(() => (d?.assets || []).filter((a) => match(a.name, a.owner, a.source)), [d, ql]);
  const t = d?.totals;

  const doBackup = async () => { setBusy('backup'); try { const r = await backupNow(); if (r.error) toast(`Sao lưu lỗi: ${r.error}`, 'err'); else toast(`Đã sao lưu ${r.kb} KB lên R2.`, 'ok'); void load(); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); } };
  const doExport = async () => { setBusy('export'); try { const f = await exportDb(); await downloadBytes(f.name, f.bytes, 'application/vnd.sqlite3'); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); } };
  const toggleAi = async (id: string, on: boolean) => { try { await adminGrant(id, on); void load(); } catch (e) { toast((e as Error).message, 'err'); } };
  const remove = async (id: string, email: string) => {
    if (!(await ask(`Xoá vĩnh viễn tài khoản ${email} cùng toàn bộ project, ảnh và hồ sơ client của họ trên relay? Không hoàn tác được.`, 'Xoá vĩnh viễn', true))) return;
    try { await deleteUser(id); toast(`Đã xoá ${email}.`, 'ok'); void load(); } catch (e) { toast((e as Error).message, 'err'); }
  };

  return (
    <div class="home adm">
      <div class="home-top">
        <Logo size={20} onClick={() => set({ route: { name: 'home' } })} />
        <span class="chip on">Database</span>
        <span class="grow" />
        <Btn kind="ghost" sm icon="sparkle" onClick={() => set({ modal: 'aiadmin' })}>Mã AI{t?.pending ? ` · ${t.pending} chờ` : ''}</Btn>
        <Btn kind="ghost" sm icon="reflow" onClick={() => void load()}>Tải lại</Btn>
        <Btn kind="ghost" sm icon="home" onClick={() => set({ route: { name: 'home' } })}>Về Home</Btn>
      </div>
      <div class="home-body">
        <div class="hero"><div><h1>Database <em>relay</em></h1><p>Mọi thứ đang nằm trên máy chủ Phloem: tài khoản, project đã đồng bộ, ảnh, mã AI. Chỉ admin ({s.user?.email}) thấy trang này.</p></div></div>
        {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
        {!d && !err && <div class="card"><div class="progress"><i class="indet" /></div><div class="dim small">Đang đọc database (relay có thể đang thức dậy, tối đa ~1 phút)…</div></div>}
        {d && t && (
          <>
            <div class="adm-tiles">
              <div class="adm-tile"><span>Người dùng</span><b>{t.users}</b><i>{t.googleUsers} Google · {t.aiUsers} có AI</i></div>
              <div class="adm-tile"><span>Project</span><b>{t.projects}</b><i>{kb(t.projectBytes)}</i></div>
              <div class="adm-tile"><span>Ảnh</span><b>{t.assets}</b><i>{kb(t.assetBytes)}</i></div>
              <div class="adm-tile"><span>Database</span><b>{kb(t.dbBytes)}</b><i>{t.sessions} phiên đăng nhập</i></div>
              <div class="adm-tile"><span>Mã AI</span><b>{t.codesUsed}/{t.codes}</b><i>đã dùng / đã tạo</i></div>
              <div class={`adm-tile ${t.pending ? 'hot' : ''}`} onClick={() => set({ modal: 'aiadmin' })} style={{ cursor: 'pointer' }}><span>Yêu cầu AI</span><b>{t.pending}</b><i>đang chờ duyệt</i></div>
            </div>
            <div class="adm-cards">
              <div class="card">
                <div class="row"><Icon name="download" /><b class="grow">Sao lưu</b>{d.backup ? (d.backup.error ? <span class="chip err">lỗi</span> : <span class="chip on">bật</span>) : <span class="chip warn">tắt</span>}</div>
                {d.backup ? <div class="small muted">Bucket <b>{d.backup.bucket}</b> · mỗi {d.backup.every} phút · lần gần nhất {d.backup.at ? `${when(d.backup.at)} (${ago(d.backup.at)}), ${d.backup.kb} KB` : 'chưa có'}{d.backup.error ? ` · ${d.backup.error}` : ''}</div> : <div class="small muted">Chưa cấu hình BACKUP_S3_*: dữ liệu mất mỗi lần relay deploy lại.</div>}
                <div class="row"><Btn sm kind="primary" disabled={!d.backup || busy === 'backup'} onClick={doBackup}>{busy === 'backup' ? 'Đang sao lưu…' : 'Sao lưu ngay'}</Btn><Btn sm icon="download" disabled={busy === 'export'} onClick={doExport}>{busy === 'export' ? 'Đang xuất…' : 'Tải file .db'}</Btn></div>
              </div>
              <div class="card">
                <div class="row"><Icon name="bolt" /><b class="grow">Relay</b><span class="chip">{d.relay.commit || 'local'}</span></div>
                <div class="small muted">Chạy từ {when(d.relay.startedAt)} ({ago(d.relay.startedAt)}) · AI {d.relay.ai ? 'bật' : 'tắt'} · Google {d.relay.google ? 'bật' : 'tắt'} · admin: {d.relay.admins.join(', ')}</div>
                <div class="small dim">Gói free: relay ngủ sau 15 phút không dùng; dữ liệu được khôi phục từ bản sao lưu khi khởi động lại.</div>
              </div>
            </div>
            <div class="row wrap" style={{ gap: 8 }}>
              <div class="seg" style={{ height: 32 }}>
                {(['users', 'projects', 'assets'] as Tab[]).map((k) => <button key={k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{{ users: `Người dùng · ${t.users}`, projects: `Project · ${t.projects}`, assets: `Ảnh · ${t.assets}` }[k]}</button>)}
              </div>
              <span class="grow" />
              <input class="in" style={{ maxWidth: 280, height: 32 }} placeholder="Tìm tên, email, website…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
            </div>
            <div class="adm-table">
              {tab === 'users' && (
                <table>
                  <thead><tr><th>Người dùng</th><th>Đăng nhập</th><th>AI</th><th class="n">Project</th><th class="n">Ảnh</th><th class="n">Dung lượng</th><th>Hoạt động</th><th>Tạo lúc</th><th /></tr></thead>
                  <tbody>{users.map((u) => (
                    <tr key={u.id}>
                      <td><b>{u.name}</b><div class="mono dim">{u.email}</div>{u.brand && <div class="dim">{u.brand}</div>}</td>
                      <td>{u.google ? <span class="chip">Google</span> : <span class="chip">Email</span>}</td>
                      <td>{d.relay.admins.includes(u.email.toLowerCase()) ? <span class="chip on">admin</span> : u.ai ? <button class="chip on" title="Thu hồi AI" onClick={() => void toggleAi(u.id, false)}>có AI ✕</button> : <button class="chip" title="Cấp AI" onClick={() => void toggleAi(u.id, true)}>+ cấp AI</button>}</td>
                      <td class="n">{u.projects}</td><td class="n">{u.assets}</td><td class="n">{kb(u.projectBytes + u.assetBytes)}</td>
                      <td>{ago(u.lastSeen)}</td><td>{when(u.createdAt)}</td>
                      <td>{u.id !== s.user?.id && <button class="adm-del" title="Xoá tài khoản" onClick={() => void remove(u.id, u.email)}><Icon name="trash" size={14} /></button>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              {tab === 'projects' && (
                <table>
                  <thead><tr><th>Project</th><th>Chủ</th><th>Cập nhật</th><th>Tạo lúc</th><th class="n">Kích thước</th><th>Đã xuất</th></tr></thead>
                  <tbody>{projects.map((p) => <tr key={p.id}><td><b>{p.name}</b><div class="mono dim">{p.id}</div></td><td class="mono">{p.owner}</td><td>{ago(p.updatedAt)}</td><td>{when(p.createdAt)}</td><td class="n">{kb(p.size)}</td><td>{p.provider ? <span class="chip on">{p.provider}</span> : <span class="dim">—</span>}</td></tr>)}</tbody>
                </table>
              )}
              {tab === 'assets' && (
                <table>
                  <thead><tr><th>Ảnh</th><th>Chủ</th><th>Nguồn</th><th class="n">Kích thước</th><th class="n">Dung lượng</th><th>Thêm lúc</th></tr></thead>
                  <tbody>{assets.map((a) => <tr key={a.id}><td><b>{a.name}</b><div class="mono dim">{a.mime}</div></td><td class="mono">{a.owner}</td><td>{a.source || <span class="dim">tải lên</span>}</td><td class="n">{a.w}×{a.h}</td><td class="n">{kb(a.bytes)}</td><td>{when(a.createdAt)}</td></tr>)}</tbody>
                </table>
              )}
              {((tab === 'users' && !users.length) || (tab === 'projects' && !projects.length) || (tab === 'assets' && !assets.length)) && <div class="dim small" style={{ padding: 16 }}>{ql ? 'Không có kết quả khớp.' : 'Chưa có dữ liệu.'}</div>}
            </div>
            <div class="dim small">Hiển thị tối đa 1.000 người dùng, 500 project và 500 ảnh mới nhất. "Tải file .db" cho bản đầy đủ (mở bằng DB Browser for SQLite).</div>
          </>
        )}
      </div>
    </div>
  );
}
