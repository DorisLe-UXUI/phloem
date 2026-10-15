// Tự động: email sequences started by an event (new subscriber, a tag, a birthday, no opens for a while). Each email
// step is one of this workspace's Phloem emails, composed for server sending (hosted images, tracked links).
import { useEffect, useState } from 'preact/hooks';
import { set, toast, useStore } from '../../store';
import { automationAction, automations as fetchAutos, deleteAutomation, saveAutomation, type AudList, type Automation, type Step } from '../../pipeline/audience';
import { composeForSend } from '../../pipeline/mailSend';
import { db } from '../../storage/idb';
import { normalizeProject } from '../../pipeline/actions';
import type { Project } from '../../model/types';
import { getSession } from '../../auth/core';
import { Btn, Field, TextInput } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';
import { pct, type AudCtx } from './AudiencePage';

const TRIGGERS: { v: Automation['trigger']['type']; label: string; sub: string }[] = [
  { v: 'subscribe', label: 'Có người đăng ký mới', sub: 'qua form, thêm tay, hoặc khi nhập có bật chuỗi chào mừng' },
  { v: 'tag', label: 'Liên hệ được gắn tag', sub: 'ví dụ "da-mua", "vip": gắn tay, khi nhập, hoặc từ một chuỗi khác' },
  { v: 'date', label: 'Đến ngày sinh nhật / kỷ niệm', sub: 'theo trường ngày của liên hệ (dd/mm hoặc yyyy-mm-dd), mỗi năm một lần' },
  { v: 'inactive', label: 'Lâu không mở email', sub: 'kéo khách quay lại, mỗi người một lần' },
];
const PRESETS: { name: string; trigger: Automation['trigger']; steps: Step[] }[] = [
  { name: 'Chuỗi chào mừng', trigger: { type: 'subscribe' }, steps: [{ type: 'email', delayHours: 0, subject: 'Chào mừng {{first_name|bạn}}!' }, { type: 'email', delayHours: 48, subject: 'Câu chuyện của chúng tôi' }, { type: 'email', delayHours: 96, subject: 'Quà cho lần mua đầu tiên' }] },
  { name: 'Chúc mừng sinh nhật', trigger: { type: 'date', field: 'birthday' }, steps: [{ type: 'email', delayHours: 8, subject: 'Chúc mừng sinh nhật {{first_name|bạn}} 🎂' }] },
  { name: 'Kéo khách quay lại', trigger: { type: 'inactive', days: 60 }, steps: [{ type: 'email', delayHours: 0, subject: 'Lâu rồi không gặp, {{first_name|bạn}}' }, { type: 'tag', delayHours: 168, add: ['ngu-dong'] }] },
  { name: 'Cảm ơn khách đã mua', trigger: { type: 'tag', tag: 'da-mua' }, steps: [{ type: 'email', delayHours: 2, subject: 'Cảm ơn bạn đã mua hàng!' }, { type: 'email', delayHours: 24 * 7, subject: 'Bạn thấy sản phẩm thế nào?' }] },
];
const delayText = (h: number) => (!h ? 'ngay' : h % 24 === 0 ? `sau ${h / 24} ngày` : `sau ${h} giờ`);
const trigText = (t: Automation['trigger']) => (t.type === 'tag' ? `khi gắn tag "${t.tag}"` : t.type === 'date' ? `vào ngày ${t.field || 'birthday'}` : t.type === 'inactive' ? `khi ${t.days || 60} ngày không mở` : 'khi đăng ký mới');

export function AutomationsTab({ ctx, list }: { ctx: AudCtx; list: AudList }) {
  const [items, setItems] = useState<Automation[] | null>(null);
  const [edit, setEdit] = useState<Partial<Automation> | null>(null);
  const load = async () => { try { setItems((await fetchAutos(ctx.client)).automations.filter((a) => a.list === list.id)); } catch (e) { toast((e as Error).message, 'err'); setItems([]); } };
  useEffect(() => { void load(); }, [list.id]);
  if (edit) return <AutoEditor ctx={ctx} list={list} a={edit} onClose={() => { setEdit(null); void load(); }} />;
  const toggle = async (a: Automation) => { try { await automationAction(ctx.client, a.id, a.status === 'active' ? 'pause' : 'activate'); toast(a.status === 'active' ? 'Đã tạm dừng.' : 'Đã bật chuỗi.', 'ok'); void load(); } catch (e) { toast((e as Error).message, 'err'); } };
  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="row"><div class="small muted grow">Chuỗi email tự chạy khi có sự kiện. Máy chủ gửi đúng giờ, bỏ qua người đã huỷ đăng ký, và dừng khi họ rời danh sách.</div>{ctx.canWrite && <Btn sm kind="primary" icon="plus" onClick={() => setEdit({ name: 'Chuỗi mới', list: list.id, trigger: { type: 'subscribe' }, steps: [{ type: 'email', delayHours: 0, subject: '' }], sender: list.sender })}>Chuỗi mới</Btn>}</div>
      <div class="aud-cards">
        {items === null ? <div class="dim small">Đang tải…</div> : items.map((a) => (
          <div key={a.id} class="card aud-card">
            <div class="row"><Icon name="bolt" size={14} /><b class="grow">{a.name}</b><span class={`chip ${a.status === 'active' ? 'on' : a.status === 'paused' ? 'warn' : ''}`}>{{ active: 'đang chạy', paused: 'tạm dừng', draft: 'nháp' }[a.status]}</span></div>
            <div class="dim small">Bắt đầu {trigText(a.trigger)} · {a.steps.length} bước · {a.runs?.active || 0} người đang trong chuỗi · {a.runs?.done || 0} xong</div>
            <div class="aud-steps">{a.steps.map((st, i) => <div key={st.id || i} class="aud-step-mini"><span class="dim">{delayText(st.delayHours)}</span>{st.type === 'email' ? <><b>{st.subject || st.projectName || 'Email'}</b>{st.stats && <span class="dim">{st.log?.sent || 0} gửi · mở {pct(st.stats.opens, st.log?.sent || 0)} · click {pct(st.stats.clicks, st.log?.sent || 0)}</span>}</> : <b>Gắn tag {st.add?.join(', ')}</b>}</div>)}</div>
            <div class="row" style={{ gap: 6 }}>{ctx.canWrite && <><Btn xs kind={a.status === 'active' ? undefined : 'primary'} onClick={() => void toggle(a)}>{a.status === 'active' ? 'Tạm dừng' : 'Bật'}</Btn><Btn xs kind="ghost" onClick={() => setEdit(a)}>Sửa</Btn></>}</div>
          </div>
        ))}
        {items && !items.length && <div class="dim small">Chưa có chuỗi nào. Bắt đầu từ mẫu:</div>}
      </div>
      {ctx.canWrite && <div class="row wrap" style={{ gap: 6 }}>{PRESETS.map((p) => <Btn key={p.name} xs onClick={() => setEdit({ name: p.name, list: list.id, trigger: p.trigger, steps: p.steps.map((s) => ({ ...s })), sender: list.sender })}>+ {p.name}</Btn>)}</div>}
    </div>
  );
}

function AutoEditor({ ctx, list, a, onClose }: { ctx: AudCtx; list: AudList; a: Partial<Automation>; onClose: () => void }) {
  const s = useStore();
  const [name, setName] = useState(a.name || '');
  const [trigger, setTrigger] = useState<Automation['trigger']>(a.trigger || { type: 'subscribe' });
  const [senderId, setSenderId] = useState(a.sender?.id || list.sender?.id || ctx.senders[0]?.id || '');
  const [steps, setSteps] = useState<Step[]>((a.steps || []).map((x) => ({ ...x })));
  const [busy, setBusy] = useState('');
  const projects = s.projects.filter((p) => (ctx.client ? p.clientId === ctx.client : !p.clientId || !s.clients.some((c) => c.id === p.clientId)));
  const up = (i: number, p: Partial<Step>) => setSteps(steps.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const move = (i: number, d: -1 | 1) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x); setSteps(n); };
  const senderRef = ctx.senders.find((x) => x.id === senderId) || null;
  const foreignSender = !!a.sender && a.sender.owner !== getSession()?.user.id;
  /** Compose the email steps whose content is missing or whose email changed (or all, with force). */
  const build = async (force = false): Promise<Step[]> => {
    const out: Step[] = [];
    for (const [i, st] of steps.entries()) {
      if (st.type !== 'email' || !st.project || (!force && (st.hasHtml || st.html) && !st.html?.startsWith('#rebuild'))) { out.push(st); continue; }
      setBusy(`Dựng email ${i + 1}/${steps.length}…`);
      const raw = await db.getProject(st.project); if (!raw) throw new Error(`Không tìm thấy email "${st.projectName}" trên máy này.`);
      const p = normalizeProject(raw as Project);
      const m = await composeForSend(p, senderRef?.fromEmail || 'hello@example.com', senderRef?.fromName || '');
      out.push({ ...st, html: m.html, text: m.text, links: m.links, subject: st.subject || p.fields.subject || m.subject, hasHtml: true });
    }
    setBusy(''); return out;
  };
  const save = async (activate = false, force = false) => {
    if (!senderId && activate) { toast('Chọn kênh gửi trước khi bật.', 'err'); return; }
    try {
      const built = await build(force); setSteps(built);
      const r = await saveAutomation(ctx.client, { id: a.id, name: name.trim() || 'Chuỗi tự động', list: list.id, trigger, sender: senderId && !foreignSender ? { owner: '', id: senderId } : (a.sender || null), steps: built.map((st) => ({ ...st, html: st.html || undefined })) });
      a.id = r.automation.id;
      if (activate) { await automationAction(ctx.client, r.automation.id, 'activate'); toast('Đã lưu và bật chuỗi.', 'ok'); onClose(); return; }
      toast('Đã lưu chuỗi.', 'ok');
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(''); }
  };
  const test = async (st: Step) => {
    if (!a.id) { toast('Lưu chuỗi trước khi gửi thử.', 'err'); return; }
    try { const r = await automationAction(ctx.client, a.id, 'test', { step: st.id }); toast(`Đã gửi thử tới ${r.to}.`, 'ok'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <div class="card col" style={{ gap: 12 }}>
      <div class="row"><b class="grow">{a.id ? 'Sửa chuỗi tự động' : 'Chuỗi tự động mới'}</b>{a.status && <span class={`chip ${a.status === 'active' ? 'on' : ''}`}>{a.status === 'active' ? 'đang chạy' : a.status === 'paused' ? 'tạm dừng' : 'nháp'}</span>}<Btn xs kind="ghost" onClick={onClose}>Đóng</Btn></div>
      <div class="grid2">
        <Field label="Tên chuỗi"><TextInput value={name} onCommit={setName} onInput={setName} /></Field>
        <Field label="Gửi bằng" hint="Resend / Brevo / SES">
          {foreignSender ? <div class="small dim">Kênh gửi của thành viên khác trong workspace</div> : (
            <select class="in" value={senderId} onChange={(e) => setSenderId((e.target as HTMLSelectElement).value)}>
              <option value="">Chọn kênh gửi…</option>
              {ctx.senders.map((x) => <option key={x.id} value={x.id}>{x.label} · {x.fromName ? `${x.fromName} <${x.fromEmail}>` : x.fromEmail}</option>)}
            </select>
          )}
        </Field>
      </div>
      {!ctx.senders.length && <div class="check warn"><span class="lv">CẦN</span><span class="m">Thêm kênh gửi ở tab Gửi & tên miền (Resend miễn phí 3.000 thư/tháng).</span></div>}
      <div class="col" style={{ gap: 6 }}>
        <span class="dim small">Bắt đầu khi</span>
        <div class="aud-trig">
          {TRIGGERS.map((t) => (
            <label key={t.v} class={`aud-trig-opt ${trigger.type === t.v ? 'on' : ''}`}>
              <input type="radio" checked={trigger.type === t.v} onChange={() => setTrigger({ ...trigger, type: t.v })} />
              <div><b>{t.label}</b><div class="dim small">{t.sub}</div>
                {trigger.type === t.v && t.v === 'tag' && <input class="in" style={{ marginTop: 6, maxWidth: 220 }} placeholder="tên tag, ví dụ da-mua" value={trigger.tag || ''} onInput={(e) => setTrigger({ ...trigger, tag: (e.target as HTMLInputElement).value })} />}
                {trigger.type === t.v && t.v === 'date' && <input class="in" style={{ marginTop: 6, maxWidth: 220 }} placeholder="trường ngày, ví dụ birthday" value={trigger.field || 'birthday'} onInput={(e) => setTrigger({ ...trigger, field: (e.target as HTMLInputElement).value })} />}
                {trigger.type === t.v && t.v === 'inactive' && <div class="row" style={{ marginTop: 6, gap: 6 }}><input class="in" type="number" min={7} max={365} style={{ maxWidth: 90 }} value={trigger.days || 60} onInput={(e) => setTrigger({ ...trigger, days: Number((e.target as HTMLInputElement).value) })} /><span class="dim small">ngày không mở email</span></div>}
              </div>
            </label>
          ))}
        </div>
      </div>
      <div class="col" style={{ gap: 8 }}>
        <span class="dim small">Các bước</span>
        {steps.map((st, i) => {
          const unit = st.delayHours && st.delayHours % 24 === 0 ? 'd' : 'h';
          return (
            <div key={i} class="aud-step">
              <div class="aud-step-n">{i + 1}</div>
              <div class="col grow" style={{ gap: 8 }}>
                <div class="row wrap" style={{ gap: 6 }}>
                  <span class="dim small">Chờ</span>
                  <input class="in" type="number" min={0} style={{ width: 70 }} value={unit === 'd' ? st.delayHours / 24 : st.delayHours} onInput={(e) => { const n = Math.max(0, Number((e.target as HTMLInputElement).value) || 0); up(i, { delayHours: unit === 'd' ? n * 24 : n }); }} />
                  <select class="in" style={{ width: 90 }} value={unit} onChange={(e) => { const d = (e.target as HTMLSelectElement).value; const n = unit === 'd' ? st.delayHours / 24 : st.delayHours; up(i, { delayHours: d === 'd' ? n * 24 : n }); }}><option value="h">giờ</option><option value="d">ngày</option></select>
                  <span class="dim small">{i === 0 ? 'sau khi bắt đầu, rồi' : 'sau bước trước, rồi'}</span>
                  <select class="in" style={{ width: 130 }} value={st.type} onChange={(e) => up(i, { type: (e.target as HTMLSelectElement).value as Step['type'] })}><option value="email">gửi email</option><option value="tag">gắn / bỏ tag</option></select>
                  <span class="grow" />
                  {i > 0 && <Btn xs kind="ghost" onClick={() => move(i, -1)}>↑</Btn>}
                  {i < steps.length - 1 && <Btn xs kind="ghost" onClick={() => move(i, 1)}>↓</Btn>}
                  <Btn xs kind="ghost" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>×</Btn>
                </div>
                {st.type === 'email' ? (
                  <>
                    <div class="grid2">
                      <select class="in" value={st.project || ''} onChange={(e) => { const id = (e.target as HTMLSelectElement).value; const p = projects.find((x) => x.id === id); up(i, { project: id, projectName: p?.name || '', html: '', hasHtml: false }); }}>
                        <option value="">Chọn email đã thiết kế…</option>
                        {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <input class="in" placeholder="Tiêu đề (để trống = Subject của email)" value={st.subject || ''} onInput={(e) => up(i, { subject: (e.target as HTMLInputElement).value })} />
                    </div>
                    <div class="row small" style={{ gap: 6 }}>
                      {st.hasHtml || st.html ? <span class="chip on">nội dung sẵn sàng</span> : st.project ? <span class="chip warn">dựng khi lưu</span> : <span class="chip">chưa chọn email</span>}
                      {st.project && (st.hasHtml || st.html) && <Btn xs kind="ghost" onClick={() => up(i, { html: '#rebuild', hasHtml: false })}>Cập nhật nội dung</Btn>}
                      {st.project && <Btn xs kind="ghost" onClick={async () => { const p = projects.find((x) => x.id === st.project); if (p) { const { openProject } = await import('../../pipeline/actions'); await openProject(p.id); set({ route: { name: 'editor', projectId: p.id } }); } }}>Mở email</Btn>}
                      {a.id && (st.hasHtml || st.html) && <Btn xs kind="ghost" onClick={() => void test(st)}>Gửi thử cho tôi</Btn>}
                      <span class="dim">Dùng {'{{first_name|bạn}}'} để chèn tên.</span>
                    </div>
                  </>
                ) : (
                  <div class="grid2">
                    <input class="in" placeholder="Gắn tag (cách nhau dấu phẩy)" value={(st.add || []).join(', ')} onInput={(e) => up(i, { add: (e.target as HTMLInputElement).value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                    <input class="in" placeholder="Bỏ tag" value={(st.remove || []).join(', ')} onInput={(e) => up(i, { remove: (e.target as HTMLInputElement).value.split(',').map((t) => t.trim()).filter(Boolean) })} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div class="row" style={{ gap: 6 }}><Btn xs icon="plus" onClick={() => setSteps([...steps, { type: 'email', delayHours: 24, subject: '' }])}>Thêm email</Btn><Btn xs icon="plus" onClick={() => setSteps([...steps, { type: 'tag', delayHours: 0, add: [] }])}>Thêm bước gắn tag</Btn></div>
        {!projects.length && <div class="dim small">Chưa có email nào {ctx.client ? 'của khách hàng này' : 'chưa gán khách'}: thiết kế email trước (Home → Email mới / Dựng bằng AI).</div>}
      </div>
      <div class="row">
        {a.id && <Btn kind="danger" sm onClick={async () => { if (await ask(`Xoá chuỗi "${a.name}"? Người đang trong chuỗi sẽ không nhận các email còn lại.`, 'Xoá chuỗi', true)) { await deleteAutomation(ctx.client, a.id!).catch(() => {}); onClose(); } }}>Xoá</Btn>}
        <span class="grow" />
        {busy && <span class="dim small">{busy}</span>}
        <Btn sm disabled={!!busy} onClick={() => void save(false)}>Lưu</Btn>
        {a.status !== 'active' && <Btn sm kind="primary" disabled={!!busy} onClick={() => void save(true)}>Lưu và bật</Btn>}
      </div>
    </div>
  );
}
