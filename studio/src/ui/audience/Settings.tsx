// Gửi & tên miền: list settings (company footer, sending account, custom fields), sending accounts with domain
// authentication (DNS records from the provider) and the bounce/complaint webhook.
import { useEffect, useState } from 'preact/hooks';
import { toast } from '../../store';
import { deleteList, updateList, type AudList, type FieldDef, type Group } from '../../pipeline/audience';
import { addSenderDomain, listSenders, senderDomain, type DomainState, type Sender } from '../../pipeline/mailServer';
import { Btn, Field, TextInput } from '../components';
import { SenderForm } from '../MailExtras';
import { ask } from '../confirm';
import type { AudCtx } from './AudiencePage';

const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); toast('Đã copy.', 'ok'); } catch { toast('Chọn và copy tay.', 'err'); } };
const HOOK_HELP: Record<string, string> = {
  resend: 'Resend → Webhooks → Add endpoint: dán link, chọn sự kiện email.bounced và email.complained.',
  brevo: 'Brevo → Transactional → Settings → Webhook: dán link, chọn Hard bounce, Spam, Invalid email, Blocked.',
  ses: 'AWS SNS: tạo topic, subscription HTTPS với link này (relay tự xác nhận), rồi trong SES → Configuration set → Event destinations chọn Bounce + Complaint gửi vào topic đó.',
};

export function SettingsTab({ ctx, list }: { ctx: AudCtx; list: AudList }) {
  const [name, setName] = useState(list.name);
  const [company, setCompany] = useState(list.company?.name || '');
  const [address, setAddress] = useState(list.company?.address || '');
  const [senderId, setSenderId] = useState(list.sender?.id || '');
  const [fields, setFields] = useState<FieldDef[]>(list.fields || []);
  const [groups, setGroups] = useState<Group[]>(list.groups || []);
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [delName, setDelName] = useState<string | null>(null);
  const loadSenders = async () => { try { setSenders((await listSenders()).senders); } catch { setSenders([]); } };
  useEffect(() => { void loadSenders(); }, []);
  useEffect(() => { setName(list.name); setCompany(list.company?.name || ''); setAddress(list.company?.address || ''); setSenderId(list.sender?.id || ''); setFields(list.fields || []); setGroups(list.groups || []); }, [list.id]);
  const save = async () => {
    try { await updateList(ctx.client, list.id, { name, company: { name: company, address }, fields, groups, ...(senderId ? { sender: { owner: '', id: senderId } } : senderId === '' && list.sender ? { sender: null } : {}) }); await ctx.reload(); toast('Đã lưu cài đặt danh sách.', 'ok'); }
    catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div class="aud-split">
      <div class="card col" style={{ gap: 10 }}>
        <b>Danh sách "{list.name}"</b>
        <Field label="Tên danh sách"><TextInput value={name} onCommit={setName} onInput={setName} /></Field>
        <div class="grid2"><Field label="Tên công ty / thương hiệu" hint="hiện ở cuối mỗi email"><TextInput value={company} onCommit={setCompany} onInput={setCompany} /></Field><Field label="Địa chỉ" hint="luật chống spam yêu cầu"><TextInput value={address} onCommit={setAddress} onInput={setAddress} placeholder="12 Lê Lợi, Q.1, TP.HCM" /></Field></div>
        <Field label="Kênh gửi cho xác nhận đăng ký và chuỗi tự động">
          <select class="in" value={senderId} onChange={(e) => setSenderId((e.target as HTMLSelectElement).value)} disabled={!ctx.canWrite}>
            <option value="">Chưa chọn (form đăng ký 1 bước)</option>
            {ctx.senders.map((x) => <option key={x.id} value={x.id}>{x.label} · {x.fromName ? `${x.fromName} <${x.fromEmail}>` : x.fromEmail}</option>)}
            {list.sender && !ctx.senders.some((x) => x.id === list.sender!.id) && <option value={list.sender.id}>Kênh của thành viên khác</option>}
          </select>
        </Field>
        <div class="col" style={{ gap: 6 }}>
          <span class="dim small">Nhóm trong danh sách (hiện thành tab ở Danh bạ; form đăng ký có thể cho khách tự chọn)</span>
          {groups.map((g, i) => (
            <div key={g.tag || i} class="row" style={{ gap: 6 }}>
              <input class="in" value={g.name} onInput={(e) => setGroups(groups.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)))} />
              <span class="chip mono" title="Tag gắn cho người trong nhóm">#{g.tag || 'mới'}</span>
              <Btn xs kind="ghost" title="Xoá nhóm (liên hệ vẫn giữ tag)" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>×</Btn>
            </div>
          ))}
          <div><Btn xs icon="plus" onClick={() => setGroups([...groups, { name: '', tag: '' }])}>Thêm nhóm</Btn></div>
        </div>
        <div class="col" style={{ gap: 6 }}>
          <span class="dim small">Trường tuỳ chỉnh (dùng trong phân nhóm và {'{{ten_truong}}'} trong email)</span>
          {fields.map((f, i) => (
            <div key={i} class="row" style={{ gap: 6 }}>
              <input class="in" style={{ maxWidth: 150 }} placeholder="khoá (city)" value={f.key} onInput={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, key: (e.target as HTMLInputElement).value } : x)))} />
              <input class="in" placeholder="Tên hiển thị" value={f.label} onInput={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, label: (e.target as HTMLInputElement).value } : x)))} />
              <select class="in" style={{ maxWidth: 110 }} value={f.type} onChange={(e) => setFields(fields.map((x, j) => (j === i ? { ...x, type: (e.target as HTMLSelectElement).value as FieldDef['type'] } : x)))}><option value="text">chữ</option><option value="number">số</option><option value="date">ngày</option></select>
              <Btn xs kind="ghost" onClick={() => setFields(fields.filter((_, j) => j !== i))}>×</Btn>
            </div>
          ))}
          <div><Btn xs icon="plus" onClick={() => setFields([...fields, { key: '', label: '', type: 'text' }])}>Thêm trường</Btn></div>
        </div>
        <div class="row">
          {(ctx.role === 'owner' || ctx.role === 'manager') && (delName === null
            ? <Btn kind="danger" sm onClick={() => setDelName('')}>Xoá danh sách</Btn>
            : <div class="row" style={{ gap: 6 }}><input class="in" autoFocus style={{ maxWidth: 200 }} placeholder={`gõ "${list.name}" để xoá`} value={delName} onInput={(e) => setDelName((e.target as HTMLInputElement).value)} /><Btn kind="danger" sm disabled={delName.trim().toLowerCase() !== list.name.trim().toLowerCase()} onClick={async () => { try { await deleteList(ctx.client, list.id, delName); toast(`Đã xoá danh sách và ${list.total} liên hệ.`, 'ok'); setDelName(null); await ctx.reload(); } catch (e) { toast((e as Error).message, 'err'); } }}>Xoá hẳn</Btn><Btn sm kind="ghost" onClick={() => setDelName(null)}>Huỷ</Btn></div>)}
          <span class="grow" />
          {ctx.canWrite && <Btn sm kind="primary" onClick={() => void save()}>Lưu</Btn>}
        </div>
      </div>
      <div class="col" style={{ gap: 10 }}>
        <div class="card col" style={{ gap: 8 }}>
          <div class="row"><b class="grow">Kênh gửi của bạn</b><Btn xs icon="plus" onClick={() => setAdding(!adding)}>Thêm</Btn></div>
          <div class="dim small">Gửi thật từ tên miền của bạn. Resend: 3.000 thư/tháng miễn phí; Brevo: 300 thư/ngày; Amazon SES: khoảng 0,1 USD / 1.000 thư cho số lượng lớn.</div>
          {adding && <SenderForm providers={[]} onSaved={() => { setAdding(false); void loadSenders(); void ctx.reload(); }} onCancel={() => setAdding(false)} />}
          {senders === null ? <div class="dim small">Đang tải…</div> : !senders.length && !adding ? <div class="dim small">Chưa có kênh gửi.</div> : senders.map((x) => <SenderCard key={x.id} s={x} />)}
        </div>
      </div>
    </div>
  );
}

function SenderCard({ s }: { s: Sender }) {
  const [dom, setDom] = useState<DomainState | null>(null);
  const [name, setName] = useState(s.domain?.name || s.fromEmail.split('@')[1] || '');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const run = async (fn: () => Promise<{ domain: DomainState | null }>) => { setBusy(true); try { setDom((await fn()).domain); } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); } };
  const verified = dom ? dom.verified : s.domain?.verified;
  return (
    <div class="card" style={{ background: 'var(--panel)', gap: 8 }}>
      <div class="row small"><b class="grow">{s.label} · {s.fromName ? `${s.fromName} <${s.fromEmail}>` : s.fromEmail}</b>{verified ? <span class="chip on">tên miền đã xác thực</span> : s.domain ? <span class="chip warn">chờ DNS</span> : <span class="chip">chưa xác thực</span>}<Btn xs kind="ghost" onClick={() => { setOpen(!open); if (!open && s.domain && !dom) void run(() => senderDomain(s.id)); }}>{open ? 'Đóng' : 'Tên miền & webhook'}</Btn></div>
      {open && (
        <div class="col" style={{ gap: 8 }}>
          <div class="row" style={{ gap: 6 }}><input class="in" style={{ maxWidth: 220 }} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} placeholder="tenmien.vn" /><Btn xs kind="primary" disabled={busy || !name} onClick={() => void run(() => addSenderDomain(s.id, name))}>{s.domain ? 'Lấy lại bản ghi' : 'Lấy bản ghi DNS'}</Btn>{s.domain && <Btn xs disabled={busy} onClick={() => void run(() => senderDomain(s.id))}>Kiểm tra lại</Btn>}</div>
          {dom && (
            <>
              <div class="dim small">Thêm các bản ghi này ở nơi quản lý DNS của {dom.name} (Cloudflare, Mắt Bão, PA Việt Nam, GoDaddy…), đợi vài phút đến vài giờ rồi bấm Kiểm tra lại. Xác thực xong, thư vào hộp chính thay vì Spam.</div>
              <div class="adm-table" style={{ maxHeight: 260 }}>
                <table>
                  <thead><tr><th>Loại</th><th>Tên</th><th>Giá trị</th><th>Trạng thái</th></tr></thead>
                  <tbody>{dom.records.map((r, i) => (
                    <tr key={i}><td class="mono">{r.type}{r.priority != null ? ` ${r.priority}` : ''}</td>
                      <td class="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all' }} onClick={() => void copy(r.name)} title="Bấm để copy">{r.name}</td>
                      <td class="mono" style={{ whiteSpace: 'normal', wordBreak: 'break-all', maxWidth: 280 }} onClick={() => void copy(r.value)} title="Bấm để copy">{r.value}</td>
                      <td>{r.status === 'verified' ? <span class="chip on">ok</span> : r.status === 'recommended' ? <span class="chip" title={r.note}>nên có</span> : <span class="chip warn">chờ</span>}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
          {s.webhook && (
            <div class="col" style={{ gap: 4 }}>
              <span class="dim small">Webhook báo thư dội & spam (tự loại địa chỉ hỏng khỏi mọi danh sách):</span>
              <div class="row" style={{ gap: 6 }}><input class="in mono" readOnly value={s.webhook} style={{ fontSize: 11 }} onClick={(e) => (e.target as HTMLInputElement).select()} /><Btn xs onClick={() => void copy(s.webhook!)}>Copy</Btn></div>
              <span class="dim small">{HOOK_HELP[s.provider]}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
