// Danh bạ: search, filter, page through contacts; edit one; tag / remove many; import CSV; export.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { get, toast } from '../../store';
import { getSession } from '../../auth/core';
import { addContact, bulkTags, contacts as fetchContacts, deleteContact, exportUrl, importContacts, listTags, parseCsv, guessColumn, rowsToContacts, patchContact, segments as fetchSegments, updateList, STATUS_LABEL, type AudList, type Contact, type ContactStatus, type Segment } from '../../pipeline/audience';
import { Btn, Field, Modal, TextInput, Toggle } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';
import { fmtDate, type AudCtx } from './AudiencePage';

const STATUS_TONE: Record<ContactStatus, string> = { subscribed: 'on', pending: '', unsubscribed: 'warn', bounced: 'err', complained: 'err' };
const PAGE = 100;

export function ContactsTab({ ctx, list }: { ctx: AudCtx; list: AudList }) {
  const [rows, setRows] = useState<Contact[] | null>(null);
  const [total, setTotal] = useState(0);
  const [qy, setQy] = useState('');
  const [status, setStatus] = useState('');
  const [tag, setTag] = useState('');
  const [tags, setTags] = useState<{ tag: string; n: number }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<Contact | null>(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [tagText, setTagText] = useState('');
  const [segment, setSegment] = useState('');
  const [segs, setSegs] = useState<Segment[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const groups = list.groups || [];
  const load = async () => {
    try {
      const [r, t] = await Promise.all([fetchContacts(ctx.client, list.id, { q: qy.trim(), status, tag, segment, limit }), listTags(ctx.client, list.id)]);
      setRows(r.contacts); setTotal(r.total); setTags(t.tags);
    } catch (e) { toast((e as Error).message, 'err'); setRows([]); }
  };
  useEffect(() => { const t = setTimeout(() => void load(), qy ? 300 : 0); return () => clearTimeout(t); }, [list.id, qy, status, tag, segment, limit]);
  useEffect(() => { setTag(''); setSegment(''); void fetchSegments(ctx.client).then((r) => setSegs(r.segments.filter((x) => x.list === list.id))).catch(() => setSegs([])); }, [list.id]);
  const pick = (t: string, sg = '') => { setTag(t); setSegment(sg); setSel(new Set()); setLimit(PAGE); };
  const count = Object.fromEntries(tags.map((t) => [t.tag, t.n]));
  const loose = tags.filter((t) => !groups.some((g) => g.tag === t.tag)).slice(0, 8);
  const addGroup = async () => {
    const name = (naming || '').trim(); if (!name) return;
    try { await updateList(ctx.client, list.id, { groups: [...groups, { name, tag: '' }] }); setNaming(null); await ctx.reload(); toast(`Đã tạo nhóm "${name}". Chọn liên hệ rồi bấm Thêm vào nhóm.`, 'ok'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const toGroup = async (g: { tag: string; name: string }, remove = false) => {
    const r = await bulkTags(ctx.client, list.id, [...sel], remove ? [] : [g.tag], remove ? [g.tag] : []).catch((e) => { toast((e as Error).message, 'err'); return null; });
    if (r) toast(`${remove ? 'Đã bỏ' : 'Đã thêm'} ${r.updated} liên hệ ${remove ? 'khỏi' : 'vào'} "${g.name}".`, 'ok');
    setSel(new Set()); await refresh();
  };
  const refresh = async () => { await load(); await ctx.reload(); };
  const allOn = !!rows?.length && rows.every((r) => sel.has(r.email));
  const toggle = (e: string) => setSel((prev) => { const n = new Set(prev); if (n.has(e)) n.delete(e); else n.add(e); return n; });
  const bulk = async (kind: 'add' | 'remove' | 'delete') => {
    const emails = [...sel];
    if (kind === 'delete') {
      if (!(await ask(`Xoá hẳn ${emails.length} liên hệ khỏi "${list.name}"? Lịch sử của họ mất theo. (Muốn ngừng gửi thì đổi trạng thái thành Đã huỷ.)`, 'Xoá liên hệ', true))) return;
      for (const e of emails) await deleteContact(ctx.client, list.id, e).catch(() => {});
      toast(`Đã xoá ${emails.length} liên hệ.`, 'ok');
    } else {
      const t = tagText.trim(); if (!t) { toast('Gõ tên tag trước.', 'err'); return; }
      const list2 = t.split(',').map((x) => x.trim()).filter(Boolean);
      const r = await bulkTags(ctx.client, list.id, emails, kind === 'add' ? list2 : [], kind === 'remove' ? list2 : []).catch((e) => { toast((e as Error).message, 'err'); return null; });
      if (r) toast(`Đã cập nhật ${r.updated} liên hệ.`, 'ok');
    }
    setSel(new Set()); await refresh();
  };
  const download = async () => {
    const ses = getSession(); const relay = get().settings.relayUrl.replace(/\/$/, '');
    try {
      const r = await fetch(exportUrl(relay, ctx.client, list.id), { headers: { Authorization: `Bearer ${ses?.token || ''}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${list.name.replace(/[^\w.-]+/g, '-')}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { toast(`Không xuất được: ${(e as Error).message}`, 'err'); }
  };

  return (
    <div class="col" style={{ gap: 12 }}>
      <div class="aud-groups" role="tablist" aria-label="Nhóm trong danh sách">
        <button role="tab" class={!tag && !segment ? 'on' : ''} onClick={() => pick('')}>Tất cả<i>{list.total.toLocaleString('vi-VN')}</i></button>
        {groups.map((g) => <button key={g.tag} role="tab" class={tag === g.tag ? 'on' : ''} onClick={() => pick(g.tag)} title={`Nhóm (tag "${g.tag}")`}>{g.name}<i>{(count[g.tag] || 0).toLocaleString('vi-VN')}</i></button>)}
        {segs.map((x) => <button key={x.id} role="tab" class={`seg ${segment === x.id ? 'on' : ''}`} onClick={() => pick('', x.id)} title="Phân nhóm theo điều kiện (tự cập nhật)">⚡ {x.name}</button>)}
        {loose.map((t) => <button key={t.tag} role="tab" class={`tag ${tag === t.tag ? 'on' : ''}`} onClick={() => pick(t.tag)} title="Tag">#{t.tag}<i>{t.n}</i></button>)}
        {ctx.canWrite && (naming === null
          ? <button class="add" onClick={() => setNaming('')}>+ Nhóm</button>
          : <span class="row" style={{ gap: 4 }}><input class="in" autoFocus style={{ width: 170, height: 28 }} placeholder="Tên nhóm (VIP, Đã mua…)" value={naming} onInput={(e) => setNaming((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') void addGroup(); if (e.key === 'Escape') setNaming(null); }} /><Btn xs kind="primary" onClick={() => void addGroup()}>Tạo</Btn><Btn xs kind="ghost" onClick={() => setNaming(null)}>×</Btn></span>)}
      </div>
      <div class="row wrap aud-toolbar">
        <input class="in" style={{ maxWidth: 260, height: 32 }} placeholder="Tìm email hoặc tên…" value={qy} onInput={(e) => { setQy((e.target as HTMLInputElement).value); setLimit(PAGE); }} />
        <select class="in" style={{ maxWidth: 170, height: 32 }} value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="">Mọi trạng thái</option>
          {(Object.keys(STATUS_LABEL) as ContactStatus[]).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]} · {list.counts[k] || 0}</option>)}
        </select>
        <span class="grow" />
        {ctx.canWrite && <Btn sm icon="plus" onClick={() => setAdding(true)}>Thêm</Btn>}
        {ctx.canWrite && <Btn sm kind="primary" icon="upload" onClick={() => setImporting(true)}>Nhập CSV</Btn>}
        <Btn sm icon="download" onClick={() => void download()}>Xuất CSV</Btn>
      </div>
      {sel.size > 0 && ctx.canWrite && (
        <div class="row aud-bulk wrap"><b>{sel.size} đã chọn</b>{groups.length > 0 && <select class="in" style={{ maxWidth: 190, height: 26 }} value="" onChange={(e) => { const v = (e.target as HTMLSelectElement).value; const g = groups.find((x) => x.tag === v.slice(1)); if (g) void toGroup(g, v[0] === '-'); }}><option value="">Thêm vào nhóm…</option>{groups.map((g) => <option key={g.tag} value={`+${g.tag}`}>+ {g.name}</option>)}{groups.map((g) => <option key={`r${g.tag}`} value={`-${g.tag}`}>− bỏ khỏi {g.name}</option>)}</select>}<input class="in" style={{ maxWidth: 200, height: 26 }} placeholder="tag (cách nhau dấu phẩy)" value={tagText} onInput={(e) => setTagText((e.target as HTMLInputElement).value)} /><Btn xs onClick={() => void bulk('add')}>Gắn tag</Btn><Btn xs onClick={() => void bulk('remove')}>Bỏ tag</Btn><Btn xs kind="danger" onClick={() => void bulk('delete')}>Xoá</Btn><span class="grow" /><Btn xs kind="ghost" onClick={() => setSel(new Set())}>Bỏ chọn</Btn></div>
      )}
      <div class="adm-table aud-table">
        <table>
          <thead><tr>
            <th style={{ width: 28 }}><input type="checkbox" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows?.map((r) => r.email)))} /></th>
            <th>Email</th><th>Tên</th><th>Trạng thái</th><th>Tag</th><th class="n">Mở</th><th class="n">Click</th><th>Nguồn</th><th>Ngày thêm</th>
          </tr></thead>
          <tbody>
            {rows === null ? <tr><td colSpan={9} class="dim">Đang tải…</td></tr>
              : !rows.length ? <tr><td colSpan={9} class="dim">{qy || status || tag || segment ? (tag && groups.some((g) => g.tag === tag) ? 'Nhóm chưa có ai: tick liên hệ ở tab Tất cả rồi chọn Thêm vào nhóm.' : 'Không có ai khớp bộ lọc.') : 'Danh sách trống: nhập CSV, thêm tay, hoặc tạo form đăng ký.'}</td></tr>
                : rows.map((c) => (
                  <tr key={c.email} onClick={() => setOpen(c)} style={{ cursor: 'pointer' }}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(c.email)} onChange={() => toggle(c.email)} /></td>
                    <td class="mono">{c.email}</td>
                    <td>{[c.last_name, c.first_name].filter(Boolean).join(' ') || <span class="dim">–</span>}</td>
                    <td><span class={`chip ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span></td>
                    <td>{c.tags.slice(0, 3).map((t) => <span key={t} class="chip" style={{ marginRight: 4 }}>{t}</span>)}{c.tags.length > 3 && <span class="dim">+{c.tags.length - 3}</span>}</td>
                    <td class="n">{c.opens}</td><td class="n">{c.clicks}</td>
                    <td class="dim">{{ import: 'nhập', form: 'form', manual: 'thêm tay' }[c.source] || c.source || '–'}</td>
                    <td class="dim">{fmtDate(c.createdAt)}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <div class="row small"><span class="dim grow">{rows ? `${Math.min(rows.length, total).toLocaleString('vi-VN')} / ${total.toLocaleString('vi-VN')} liên hệ` : ''}</span>{rows && total > rows.length && <Btn xs onClick={() => setLimit(limit + PAGE * 4)}>Xem thêm</Btn>}</div>
      {open && <ContactModal ctx={ctx} list={list} c={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); void refresh(); }} />}
      {adding && <AddModal ctx={ctx} list={list} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void refresh(); }} />}
      {importing && <ImportModal ctx={ctx} list={list} onClose={() => setImporting(false)} onDone={() => { setImporting(false); void refresh(); }} />}
    </div>
  );
}

function ContactModal({ ctx, list, c, onClose, onSaved }: { ctx: AudCtx; list: AudList; c: Contact; onClose: () => void; onSaved: () => void }) {
  const [first, setFirst] = useState(c.first_name); const [last, setLast] = useState(c.last_name);
  const [tags, setTags] = useState(c.tags.join(', '));
  const [fields, setFields] = useState<Record<string, string>>({ ...c.fields });
  const [busy, setBusy] = useState(false);
  const keys = [...new Set([...list.fields.map((f) => f.key), ...Object.keys(c.fields)])];
  const save = async (extra: Partial<Contact> & { confirmConsent?: boolean } = {}) => {
    setBusy(true);
    try { await patchContact(ctx.client, list.id, c.email, { first_name: first, last_name: last, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), fields, ...extra }); toast('Đã lưu.', 'ok'); onSaved(); }
    catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(false); }
  };
  const consent = c.consent || {};
  return (
    <Modal title={c.email} icon="mail" onClose={onClose} footer={ctx.canWrite ? <>
      <Btn kind="danger" onClick={async () => { if (await ask(`Xoá hẳn ${c.email}?`, 'Xoá', true)) { await deleteContact(ctx.client, list.id, c.email).catch((e) => toast((e as Error).message, 'err')); onSaved(); } }}>Xoá</Btn>
      <span class="grow" />
      {c.status === 'subscribed' && <Btn onClick={() => void save({ status: 'unsubscribed' })}>Huỷ đăng ký giúp</Btn>}
      {c.status === 'unsubscribed' && <Btn onClick={async () => { if (await ask(`Đăng ký lại ${c.email}? Chỉ làm khi người này đã đồng ý nhận lại (ví dụ họ nhắn yêu cầu).`, 'Họ đã đồng ý', true)) void save({ status: 'subscribed', confirmConsent: true }); }}>Đăng ký lại</Btn>}
      <Btn kind="primary" disabled={busy} onClick={() => void save()}>Lưu</Btn>
    </> : undefined}>
      <div class="col" style={{ gap: 10 }}>
        <div class="row small"><span class={`chip ${STATUS_TONE[c.status]}`}>{STATUS_LABEL[c.status]}</span><span class="dim">mở {c.opens} · click {c.clicks}{c.lastOpenAt ? ` · mở gần nhất ${fmtDate(c.lastOpenAt)}` : ''}</span></div>
        <div class="grid2"><Field label="Họ"><TextInput value={last} onCommit={setLast} onInput={setLast} /></Field><Field label="Tên"><TextInput value={first} onCommit={setFirst} onInput={setFirst} /></Field></div>
        <Field label="Tag" hint="cách nhau dấu phẩy"><TextInput value={tags} onCommit={setTags} onInput={setTags} /></Field>
        {keys.map((k) => <Field key={k} label={list.fields.find((f) => f.key === k)?.label || k}><TextInput value={fields[k] || ''} onCommit={(v) => setFields({ ...fields, [k]: v })} onInput={(v) => setFields({ ...fields, [k]: v })} /></Field>)}
        <div class="dim small">Đồng ý nhận email: {consent.method === 'form' ? `qua form ${consent.at ? fmtDate(consent.at) : ''}${consent.confirmedAt ? ', đã xác nhận qua email' : ''}${consent.ip ? ` · IP ${consent.ip}` : ''}` : consent.method === 'import' ? `nhập CSV bởi ${consent.by || '?'} ${consent.at ? fmtDate(consent.at) : ''}` : consent.method ? `${consent.method} bởi ${consent.by || '?'}` : 'không rõ'}</div>
      </div>
    </Modal>
  );
}

function AddModal({ ctx, list, onClose, onSaved }: { ctx: AudCtx; list: AudList; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState(''); const [first, setFirst] = useState(''); const [last, setLast] = useState(''); const [tags, setTags] = useState('');
  const [ok, setOk] = useState(false);
  const save = async () => {
    try { await addContact(ctx.client, list.id, { email, first_name: first, last_name: last, tags: tags.split(',').map((t) => t.trim()).filter(Boolean) }); toast('Đã thêm.', 'ok'); onSaved(); }
    catch (e) { toast((e as Error).message, 'err'); }
  };
  return (
    <Modal title="Thêm liên hệ" icon="plus" narrow onClose={onClose} footer={<><span class="grow" /><Btn onClick={onClose}>Huỷ</Btn><Btn kind="primary" disabled={!ok || !/\S+@\S+\.\S+/.test(email)} onClick={() => void save()}>Thêm</Btn></>}>
      <div class="col" style={{ gap: 10 }}>
        <Field label="Email"><TextInput value={email} onCommit={setEmail} onInput={setEmail} placeholder="khach@email.com" /></Field>
        <div class="grid2"><Field label="Họ"><TextInput value={last} onCommit={setLast} onInput={setLast} /></Field><Field label="Tên"><TextInput value={first} onCommit={setFirst} onInput={setFirst} /></Field></div>
        <Field label="Tag"><TextInput value={tags} onCommit={setTags} onInput={setTags} placeholder="vip, hcm" /></Field>
        <Toggle checked={ok} onChange={setOk} label="Người này đã đồng ý nhận email" sub="Gửi cho người chưa đồng ý dễ bị báo spam và khoá kênh gửi" />
      </div>
    </Modal>
  );
}

const TARGETS: { v: string; label: string }[] = [
  { v: '', label: 'Bỏ qua' }, { v: 'email', label: 'Email' }, { v: 'first_name', label: 'Tên' }, { v: 'last_name', label: 'Họ' }, { v: 'full_name', label: 'Họ và tên' }, { v: 'tags', label: 'Tag' },
  { v: 'fields.phone', label: 'Số điện thoại' }, { v: 'fields.birthday', label: 'Ngày sinh' }, { v: 'fields.city', label: 'Thành phố' },
];

function ImportModal({ ctx, list, onClose, onDone }: { ctx: AudCtx; list: AudList; onClose: () => void; onDone: () => void }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [header, setHeader] = useState(true);
  const [map, setMap] = useState<string[]>([]);
  const [tags, setTags] = useState('');
  const [attest, setAttest] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ added: number; updated: number; invalid: number; skipped: number; suppressed: number } | null>(null);
  const [paste, setPaste] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const read = (text: string) => {
    const all = parseCsv(text); if (!all.length) { toast('Không đọc được dòng nào.', 'err'); return; }
    const looksHeader = !all[0].some((c) => /\S+@\S+\.\S+/.test(c));
    setHeader(looksHeader); setRows(all);
    const first = all[0];
    setMap(first.map((h, i) => (looksHeader ? guessColumn(h) : all.slice(0, 5).some((r) => /\S+@\S+\.\S+/.test(r[i] || '')) ? 'email' : '')));
  };
  const data = rows ? (header ? rows.slice(1) : rows) : [];
  const contacts = useMemo(() => (rows ? rowsToContacts(data, map).filter((c) => c.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email.trim())) : []), [rows, map, header]);
  const custom = rows && header ? rows[0].map((h, i) => ({ h, i })).filter(({ i }) => map[i]?.startsWith('fields.') && !TARGETS.some((t) => t.v === map[i])) : [];
  const run = async () => {
    const tg = tags.split(',').map((t) => t.trim()).filter(Boolean);
    const sum = { added: 0, updated: 0, invalid: 0, skipped: 0, suppressed: 0 };
    setBusy({ done: 0, total: contacts.length });
    try {
      for (let i = 0; i < contacts.length; i += 5000) {
        const r = await importContacts(ctx.client, list.id, { rows: contacts.slice(i, i + 5000), tags: tg, attest: true, triggerAutomations: welcome });
        for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += r[k];
        setBusy({ done: Math.min(contacts.length, i + 5000), total: contacts.length });
      }
      setResult(sum);
    } catch (e) { toast((e as Error).message, 'err'); } finally { setBusy(null); }
  };
  return (
    <Modal title={`Nhập liên hệ vào "${list.name}"`} icon="upload" wide onClose={onClose} footer={result ? <><span class="grow" /><Btn kind="primary" onClick={onDone}>Xong</Btn></> : <><span class="grow" /><Btn onClick={onClose}>Huỷ</Btn><Btn kind="primary" disabled={!contacts.length || !attest || !!busy} onClick={() => void run()}>{busy ? `Đang nhập ${busy.done}/${busy.total}…` : `Nhập ${contacts.length.toLocaleString('vi-VN')} liên hệ`}</Btn></>}>
      {result ? (
        <div class="col" style={{ gap: 8 }}>
          <div class="aud-tiles" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
            <div class="adm-tile"><span>Thêm mới</span><b>{result.added}</b></div>
            <div class="adm-tile"><span>Cập nhật</span><b>{result.updated}</b></div>
            <div class="adm-tile"><span>Email sai</span><b>{result.invalid}</b></div>
            <div class="adm-tile"><span>Đã huỷ trước đó</span><b>{result.suppressed}</b><i>bỏ qua, không gửi lại</i></div>
          </div>
          <div class="dim small">Người đã huỷ đăng ký, thư dội hoặc báo spam không bao giờ được thêm lại bằng cách nhập.</div>
        </div>
      ) : !rows ? (
        <div class="col" style={{ gap: 10 }}>
          <div class="aud-drop" onClick={() => file.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={async (e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) read(await f.text()); }}>
            <Icon name="upload" size={22} /><b>Chọn hoặc kéo file CSV vào đây</b><span class="dim small">Xuất từ Excel / Google Sheets / Mailchimp / Shopify. Cột email bắt buộc; tên, tag, số điện thoại, ngày sinh… tự nhận ra.</span>
          </div>
          <input ref={file} type="file" accept=".csv,.txt,.tsv,text/csv" style={{ display: 'none' }} onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) read(await f.text()); }} />
          <div class="dim small">hoặc dán danh sách:</div>
          <textarea class="in" style={{ height: 120, padding: 8 }} placeholder={'email,ho_ten,tags\nlan@gmail.com,Nguyễn Thị Lan,vip'} value={paste} onInput={(e) => setPaste((e.target as HTMLTextAreaElement).value)} />
          <div class="row"><span class="grow" /><Btn sm disabled={!paste.trim()} onClick={() => read(paste)}>Đọc</Btn></div>
        </div>
      ) : (
        <div class="col" style={{ gap: 12 }}>
          <div class="row small"><b class="grow">{contacts.length.toLocaleString('vi-VN')} liên hệ có email hợp lệ (trong {data.length.toLocaleString('vi-VN')} dòng)</b><label class="row dim" style={{ gap: 4 }}><input type="checkbox" checked={header} onChange={(e) => setHeader((e.target as HTMLInputElement).checked)} />dòng đầu là tiêu đề</label><Btn xs kind="ghost" onClick={() => setRows(null)}>Chọn file khác</Btn></div>
          <div class="adm-table" style={{ maxHeight: 260 }}>
            <table>
              <thead><tr>{(rows[0] || []).map((h, i) => <th key={i}><div class="dim" style={{ textTransform: 'none', marginBottom: 4 }}>{header ? h : `Cột ${i + 1}`}</div>
                <select class="in" style={{ height: 26 }} value={map[i] || ''} onChange={(e) => { const n = [...map]; n[i] = (e.target as HTMLSelectElement).value; setMap(n); }}>
                  {[...TARGETS, ...(map[i] && !TARGETS.some((t) => t.v === map[i]) ? [{ v: map[i], label: `Trường: ${map[i].slice(7)}` }] : [])].map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
                </select></th>)}</tr></thead>
              <tbody>{data.slice(0, 5).map((r, ri) => <tr key={ri}>{r.map((c, i) => <td key={i} class={map[i] ? '' : 'dim'}>{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {custom.length > 0 && <div class="dim small">Cột khác lưu thành trường tuỳ chỉnh: {custom.map((c) => c.h).join(', ')} (dùng được trong phân nhóm và {'{{ten_truong}}'} trong email).</div>}
          <Field label="Gắn tag cho cả lần nhập" hint="ví dụ: nhap-thang-10, khach-cu"><TextInput value={tags} onCommit={setTags} onInput={setTags} /></Field>
          <Toggle checked={welcome} onChange={setWelcome} label="Chạy chuỗi chào mừng cho người mới" sub="Tắt nếu đây là khách cũ đã nhận email từ trước" />
          <Toggle checked={attest} onChange={setAttest} label="Tôi xác nhận những người này đã đồng ý nhận email từ chúng tôi" sub="Bắt buộc. Không nhập danh sách mua, thu thập hay chia sẻ lại: dễ bị báo spam và khoá kênh gửi." />
        </div>
      )}
    </Modal>
  );
}
