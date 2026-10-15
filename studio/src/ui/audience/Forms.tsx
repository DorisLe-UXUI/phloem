// Form đăng ký: hosted signup pages + embed code, double opt-in, tags on signup, colours.
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../../store';
import { deleteForm, forms as fetchForms, saveForm, type AudList, type SignupForm } from '../../pipeline/audience';
import { Btn, Field, TextInput, Toggle } from '../components';
import { ask } from '../confirm';
import type { AudCtx } from './AudiencePage';

const copy = async (t: string, what: string) => { try { await navigator.clipboard.writeText(t); toast(`Đã copy ${what}.`, 'ok'); } catch { toast('Không copy được: chọn và copy tay.', 'err'); } };
/** HTML snippet for any website: a plain form posting to the relay (works without JavaScript, styles are inline). */
export function embedCode(f: SignupForm): string {
  const a = f.colors.accent;
  const extra = [f.fields.first_name ? '<input name="first_name" placeholder="Tên của bạn" style="flex:1 1 160px;padding:12px 14px;border:1px solid #d6d9d4;border-radius:10px;font:inherit">' : '', f.fields.phone ? '<input name="phone" placeholder="Số điện thoại" style="flex:1 1 160px;padding:12px 14px;border:1px solid #d6d9d4;border-radius:10px;font:inherit">' : ''].filter(Boolean).join('\n  ');
  return `<!-- Phloem Email: form đăng ký "${f.name}" -->
<form action="${f.url}" method="post" style="display:flex;flex-wrap:wrap;gap:8px;max-width:520px;font-family:Helvetica,Arial,sans-serif">
  <input type="email" name="email" required placeholder="Email của bạn" style="flex:2 1 220px;padding:12px 14px;border:1px solid #d6d9d4;border-radius:10px;font:inherit">
  ${extra}<input name="hp" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">
  <button type="submit" style="padding:12px 22px;border:0;border-radius:999px;background:${a};color:#fff;font-weight:700;cursor:pointer">${f.button}</button>
</form>`;
}

export function FormsTab({ ctx, list }: { ctx: AudCtx; list: AudList }) {
  const [items, setItems] = useState<SignupForm[] | null>(null);
  const [edit, setEdit] = useState<Partial<SignupForm> | null>(null);
  const load = async () => { try { setItems((await fetchForms(ctx.client)).forms.filter((f) => f.list === list.id)); } catch (e) { toast((e as Error).message, 'err'); setItems([]); } };
  useEffect(() => { void load(); }, [list.id]);
  if (edit) return <FormEditor ctx={ctx} list={list} f={edit} onClose={() => { setEdit(null); void load(); }} />;
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="row"><div class="small muted grow">Form đăng ký cho website, bio TikTok/Instagram, mã QR tại cửa hàng. Người đăng ký vào thẳng "{list.name}", có ghi lại thời điểm và nơi đồng ý.</div>{ctx.canWrite && <Btn sm kind="primary" icon="plus" onClick={() => setEdit({ list: list.id, name: 'Form chính', title: 'Đăng ký nhận ưu đãi', intro: 'Nhận ưu đãi riêng và tin mới qua email. Không spam.', button: 'Đăng ký', doubleOptIn: true, tags: [], fields: { first_name: true, last_name: false, phone: false, birthday: false }, colors: { bg: '#f4f5f3', accent: '#111111', text: '#141714' } })}>Form mới</Btn>}</div>
      {!list.sender && <div class="check warn"><span class="lv">LƯU Ý</span><span class="m">Danh sách chưa có kênh gửi (tab Gửi & tên miền) nên form đăng ký 1 bước: người điền vào là nhận luôn, không có email xác nhận.</span></div>}
      <div class="aud-cards">
        {items === null ? <div class="dim small">Đang tải…</div> : !items.length ? <div class="dim small">Chưa có form nào.</div> : items.map((f) => (
          <div key={f.id} class="card aud-card">
            <div class="row"><b class="grow">{f.name}</b>{f.doubleOptIn && list.sender ? <span class="chip on">xác nhận 2 bước</span> : <span class="chip">1 bước</span>}</div>
            <div class="small mono dim" style={{ wordBreak: 'break-all' }}>{f.url}</div>
            <div class="row" style={{ gap: 6 }}>
              <Btn xs onClick={() => void copy(f.url, 'link')}>Copy link</Btn>
              <Btn xs onClick={() => void copy(embedCode(f), 'mã nhúng')}>Copy mã nhúng</Btn>
              <a class="btn xs" href={f.url} target="_blank" rel="noopener">Mở</a>
              <span class="grow" />
              {ctx.canWrite && <Btn xs kind="ghost" onClick={() => setEdit(f)}>Sửa</Btn>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FormEditor({ ctx, list, f, onClose }: { ctx: AudCtx; list: AudList; f: Partial<SignupForm>; onClose: () => void }) {
  const [v, setV] = useState<Partial<SignupForm>>(f);
  const [saved, setSaved] = useState<SignupForm | null>(f.id ? (f as SignupForm) : null);
  const [rev, setRev] = useState(0);
  const up = (p: Partial<SignupForm>) => setV({ ...v, ...p });
  const save = async () => {
    try { const r = await saveForm(ctx.client, { ...v, list: list.id, tags: typeof v.tags === 'string' ? String(v.tags).split(',').map((t) => t.trim()).filter(Boolean) : v.tags }); setSaved(r.form); setV(r.form); setRev(rev + 1); toast('Đã lưu form.', 'ok'); }
    catch (e) { toast((e as Error).message, 'err'); }
  };
  const c = v.colors || { bg: '#f4f5f3', accent: '#111111', text: '#141714' };
  const fl = v.fields || { first_name: true, last_name: false, phone: false, birthday: false };
  return (
    <div class="aud-split">
      <div class="card col" style={{ gap: 10 }}>
        <div class="row"><b class="grow">{f.id ? 'Sửa form' : 'Form mới'}</b><Btn xs kind="ghost" onClick={onClose}>Đóng</Btn></div>
        <Field label="Tên (chỉ bạn thấy)"><TextInput value={v.name || ''} onCommit={(x) => up({ name: x })} onInput={(x) => up({ name: x })} /></Field>
        <Field label="Tiêu đề"><TextInput value={v.title || ''} onCommit={(x) => up({ title: x })} onInput={(x) => up({ title: x })} /></Field>
        <Field label="Mô tả"><TextInput value={v.intro || ''} onCommit={(x) => up({ intro: x })} onInput={(x) => up({ intro: x })} /></Field>
        <div class="grid2"><Field label="Chữ trên nút"><TextInput value={v.button || ''} onCommit={(x) => up({ button: x })} onInput={(x) => up({ button: x })} /></Field><Field label="Gắn tag khi đăng ký"><TextInput value={Array.isArray(v.tags) ? v.tags.join(', ') : String(v.tags || '')} onCommit={(x) => up({ tags: x.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field></div>
        <div class="row wrap small" style={{ gap: 12 }}>
          <span class="dim">Hỏi thêm:</span>
          {(['first_name', 'last_name', 'phone', 'birthday'] as const).map((k) => <label key={k} class="row" style={{ gap: 4 }}><input type="checkbox" checked={fl[k]} onChange={(e) => up({ fields: { ...fl, [k]: (e.target as HTMLInputElement).checked } })} />{{ first_name: 'Tên', last_name: 'Họ', phone: 'Số điện thoại', birthday: 'Ngày sinh' }[k]}</label>)}
          {list.groups?.length > 0 && <label class="row" style={{ gap: 4 }}><input type="checkbox" checked={!!fl.groups} onChange={(e) => up({ fields: { ...fl, groups: (e.target as HTMLInputElement).checked } })} />Cho chọn nhóm</label>}
        </div>
        {fl.groups && list.groups?.length > 0 && <Field label="Câu hỏi chọn nhóm" hint={list.groups.map((g) => g.name).join(' · ')}><TextInput value={v.groupsLabel || ''} placeholder="Bạn quan tâm" onCommit={(x) => up({ groupsLabel: x })} onInput={(x) => up({ groupsLabel: x })} /></Field>}
        <Toggle checked={v.doubleOptIn !== false} onChange={(x) => up({ doubleOptIn: x })} label="Xác nhận 2 bước qua email" sub={list.sender ? 'Người đăng ký bấm link trong email mới vào danh sách: chặn email giả, lọt hộp thư chính tốt hơn' : 'Cần kênh gửi cho danh sách (tab Gửi & tên miền)'} />
        <Field label="Lời cảm ơn sau khi đăng ký"><TextInput value={v.success || ''} onCommit={(x) => up({ success: x })} onInput={(x) => up({ success: x })} placeholder="Cảm ơn bạn! Ưu đãi đang trên đường tới hộp thư." /></Field>
        <Field label="Chuyển tới trang (tuỳ chọn)" hint="https://… sau khi đăng ký"><TextInput value={v.redirect || ''} onCommit={(x) => up({ redirect: x })} onInput={(x) => up({ redirect: x })} /></Field>
        <Field label="Dòng đồng ý nhận email"><TextInput value={v.consentText || ''} onCommit={(x) => up({ consentText: x })} onInput={(x) => up({ consentText: x })} placeholder="Bạn có thể huỷ đăng ký bất cứ lúc nào." /></Field>
        <div class="row small" style={{ gap: 10 }}>
          {(['bg', 'accent', 'text'] as const).map((k) => <label key={k} class="row" style={{ gap: 4 }}><input type="color" value={c[k]} onInput={(e) => up({ colors: { ...c, [k]: (e.target as HTMLInputElement).value } })} />{{ bg: 'Nền', accent: 'Nút', text: 'Chữ' }[k]}</label>)}
        </div>
        <div class="row">
          {f.id && <Btn kind="danger" sm onClick={async () => { if (await ask('Xoá form này? Link và mã nhúng đang dùng sẽ ngừng hoạt động.', 'Xoá form', true)) { await deleteForm(ctx.client, f.id!).catch(() => {}); onClose(); } }}>Xoá</Btn>}
          <span class="grow" />
          <Btn sm kind="primary" onClick={() => void save()}>{saved ? 'Lưu' : 'Tạo form'}</Btn>
        </div>
      </div>
      <div class="col" style={{ gap: 10 }}>
        {saved ? (
          <>
            <div class="aud-preview"><iframe key={rev} src={saved.url} title="Xem trước form" /></div>
            <div class="row" style={{ gap: 6 }}><span class="mono small grow" style={{ wordBreak: 'break-all' }}>{saved.url}</span><Btn xs onClick={() => void copy(saved.url, 'link')}>Copy link</Btn></div>
            <Field label="Mã nhúng cho website" hint="dán vào HTML, Shopify, WordPress, Ladipage…"><textarea class="in mono" readOnly style={{ height: 150, padding: 8, fontSize: 11 }} value={embedCode(saved)} onClick={(e) => (e.target as HTMLTextAreaElement).select()} /></Field>
            <Btn sm onClick={() => void copy(embedCode(saved), 'mã nhúng')}>Copy mã nhúng</Btn>
          </>
        ) : <div class="card dim small">Lưu form để có link và mã nhúng.</div>}
      </div>
    </div>
  );
}
