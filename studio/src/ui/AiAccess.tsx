// "Mở khoá AI": ask the admin for a code (logged on the relay + an e-mail from your own mail app) and redeem it.
// "Quản lý AI" (admins): pending requests, one-time codes, who has access.
import { useEffect, useState } from 'preact/hooks';
import { set, toast, useStore } from '../store';
import { adminCode, adminData, adminGrant, aiAccess, redeemAi, requestAi, type AccessState, type AdminData } from '../ai/access';
import { copyText } from '../../../src/ui/clipboard';
import { Btn, Eyebrow, Field, Modal, TextArea, TextInput } from './components';
import { Icon } from './icons';

export function AiCodeModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [st, setSt] = useState<AccessState | null>(null);
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [sent, setSent] = useState<{ mailto: string; mailed: boolean } | null>(null);
  const relayUser = !!s.user && s.sync.state !== 'off';
  useEffect(() => { if (relayUser) void aiAccess().then(setSt).catch((e) => setErr((e as Error).message)); }, [relayUser]);
  const redeem = async () => { setErr(''); setBusy('redeem'); try { await redeemAi(code); toast('Đã mở khoá AI. Dùng thoải mái!', 'ok'); onClose(); } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const ask = async () => { setErr(''); setBusy('ask'); try { const r = await requestAi(note); setSent(r); if (!r.mailed) location.href = r.mailto; } catch (e) { setErr((e as Error).message); } finally { setBusy(''); } };
  const admin = st?.adminEmail || 'vankhanh.le@sentryxp.com';
  return (
    <Modal title="Mở khoá AI" icon="sparkle" onClose={onClose} narrow footer={<Btn onClick={onClose}>Đóng</Btn>}>
      {!relayUser ? (
        <div class="col">
          <div class="small muted">AI chạy trên máy chủ của Phloem nên cần tài khoản và mã truy cập. Đăng nhập (hoặc đăng ký bằng Google) trước.</div>
          <Btn kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập / Đăng ký</Btn>
        </div>
      ) : st?.access ? (
        <div class="result"><Icon name="check" /> Tài khoản này đã dùng được AI.</div>
      ) : (
        <div class="col" style={{ gap: 14 }}>
          <div class="small muted">AI cần mã từ quản trị viên ({admin}). Đã có mã thì nhập bên dưới; chưa có thì bấm <b>Xin mã</b>, yêu cầu được gửi kèm email tài khoản của bạn.</div>
          <Field label="Mã truy cập">
            <div class="row"><div class="grow"><TextInput value={code} mono placeholder="PHL-XXXX-XXXX" onInput={setCode} onCommit={setCode} /></div><Btn kind="primary" disabled={!code.trim() || busy === 'redeem'} onClick={redeem}>{busy === 'redeem' ? 'Đang kiểm tra…' : 'Mở khoá'}</Btn></div>
          </Field>
          <Eyebrow>Chưa có mã</Eyebrow>
          {sent ? (
            <div class="card"><b>Đã gửi yêu cầu.</b><div class="small muted">{sent.mailed ? `Quản trị viên đã nhận email. Mã sẽ được gửi lại cho ${s.user?.email}.` : `Ứng dụng mail đã mở với nội dung soạn sẵn; bấm gửi trong đó. Nếu mail không mở, gửi email tới ${admin} kèm email tài khoản ${s.user?.email}.`}</div>{!sent.mailed && <a href={sent.mailto}>Mở lại email soạn sẵn</a>}</div>
          ) : (
            <>
              <Field label="Lời nhắn (tuỳ chọn)"><TextArea value={note} rows={2} placeholder="Bạn là ai, dùng AI để làm gì…" onInput={setNote} onCommit={setNote} /></Field>
              <Btn icon="mail" disabled={busy === 'ask'} onClick={ask}>{busy === 'ask' ? 'Đang gửi…' : `Xin mã từ ${admin}`}</Btn>
              {st?.requested === 'pending' && <div class="small muted">Bạn đã gửi yêu cầu trước đó; quản trị viên chưa xử lý.</div>}
            </>
          )}
        </div>
      )}
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
    </Modal>
  );
}

export function AiAdminModal({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<AdminData | null>(null);
  const [err, setErr] = useState('');
  const [made, setMade] = useState<{ code: string; for?: string } | null>(null);
  const [note, setNote] = useState('');
  const load = () => adminData().then(setD).catch((e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, []);
  const make = async (forEmail?: string) => { setErr(''); try { const r = await adminCode(forEmail ? `cho ${forEmail}` : note); setMade({ code: r.code, for: forEmail }); setNote(''); void load(); } catch (e) { setErr((e as Error).message); } };
  const grant = async (userId: string, on: boolean) => { try { await adminGrant(userId, on); void load(); } catch (e) { setErr((e as Error).message); } };
  const mailCode = (to: string, code: string) => `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent('Mã dùng AI Phloem Studio')}&body=${encodeURIComponent(`Chào bạn,\n\nMã dùng AI của bạn: ${code}\n\nMở Phloem Studio → Mở khoá AI → nhập mã. Mỗi mã dùng một lần.\n`)}`;
  const pending = d?.requests.filter((r) => r.status === 'pending') || [];
  return (
    <Modal title="Quản lý AI" icon="sparkle" onClose={onClose} wide footer={<><span class="grow small muted">Chỉ admin thấy trang này. Mã chỉ hiện một lần; relay lưu bản băm.</span><Btn onClick={onClose}>Đóng</Btn></>}>
      {made && (
        <div class="card glow">
          <div class="row"><b class="grow">Mã mới{made.for ? ` cho ${made.for}` : ''}</b><Btn sm onClick={() => { void copyText(made.code); toast('Đã copy mã.', 'ok'); }}>Copy</Btn>{made.for && <a class="btn sm primary" href={mailCode(made.for, made.code)}>Gửi qua email</a>}</div>
          <div class="mono" style={{ fontSize: 20, letterSpacing: 2 }}>{made.code}</div>
        </div>
      )}
      <Eyebrow>Yêu cầu đang chờ · {pending.length}</Eyebrow>
      {pending.length ? pending.map((r) => (
        <div key={r.userId} class="card">
          <div class="row"><b class="grow">{r.name} · <span class="mono small">{r.email}</span></b><span class="dim small">{new Date(r.at).toLocaleString('vi-VN')}</span></div>
          {r.note && <div class="small muted">{r.note}</div>}
          <div class="row"><Btn sm kind="primary" onClick={() => void make(r.email)}>Tạo mã &amp; gửi</Btn><Btn sm onClick={() => void grant(r.userId, true)}>Cấp luôn (không cần mã)</Btn></div>
        </div>
      )) : <div class="dim small">Chưa có yêu cầu nào.</div>}
      <Eyebrow>Tạo mã lẻ</Eyebrow>
      <div class="row"><div class="grow"><TextInput value={note} placeholder="Ghi chú (ví dụ: cho team marketing)" onInput={setNote} onCommit={setNote} /></div><Btn onClick={() => void make()}>Tạo mã</Btn></div>
      <Eyebrow>Người dùng · {d?.users.length ?? 0}</Eyebrow>
      <div class="catalog">
        {(d?.users || []).map((u) => (
          <div key={u.id} class="row" style={{ padding: '6px 8px' }}>
            <div class="grow"><b>{u.name}</b> <span class="mono small dim">{u.email}</span>{u.google && <span class="chip" style={{ marginLeft: 6 }}>Google</span>}</div>
            {u.ai ? <><span class="chip on">AI</span><Btn sm kind="ghost" onClick={() => void grant(u.id, false)}>Thu hồi</Btn></> : <Btn sm onClick={() => void grant(u.id, true)}>Cấp AI</Btn>}
          </div>
        ))}
      </div>
      <Eyebrow>Mã đã tạo · {d?.codes.length ?? 0}</Eyebrow>
      <div class="small">{(d?.codes || []).slice(0, 20).map((c) => <div key={c.id} class="row" style={{ gap: 8 }}><span class="grow">{c.note || '—'}</span><span class="dim">{new Date(c.createdAt).toLocaleDateString('vi-VN')}</span><span class={c.usedBy ? 'chip on' : 'chip'}>{c.usedBy ? `đã dùng · ${c.usedBy}` : 'chưa dùng'}</span></div>)}</div>
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
    </Modal>
  );
}
