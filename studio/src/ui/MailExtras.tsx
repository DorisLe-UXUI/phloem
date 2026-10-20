// The relay side of "Gửi bằng email thường": hosted images / tracking status, sending accounts + server queue
// (Resend, Brevo, Amazon SES with schedule, daily cap and A/B subject), campaign stats, the suppression list.
import { useEffect, useState } from 'preact/hooks';
import type { Project } from '../model/types';
import { getSession } from '../auth/core';
import { set, toast } from '../store';
import { audLists, previewRules, segments as audSegments, type AudList, type Segment } from '../pipeline/audience';
import { HOSTED_PREF, loadQueue, parseRecipients, startServerQueue } from '../pipeline/mailSend';
import {
  addSuppressions, campaignStats, deleteSender, forgetCampaign, hiddenCampaigns, listSenders, listSuppressions, mailHealth, mailHealthCached, mailSignedIn, myCampaigns,
  backfillRecipients, registerCampaign, rememberCampaign, removeSuppression, saveSender, serverCampaigns, serverSendControl, testSender, unhideCampaigns, type CampaignRef, type CampaignStats, type ProviderInfo, type Sender,
} from '../pipeline/mailServer';
import { Btn, Field, Num, Seg, Select, TextArea, TextInput, Toggle, Progress } from './components';
import { Icon } from './icons';
import { ask } from './confirm';

const ls = (k: string, d = '') => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const nf = (n: number) => n.toLocaleString('vi-VN');
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : '–');

/** Which relay extras this browser gets, with the hosted-images switch. */
export function MailRelayBar() {
  const [h, setH] = useState(mailHealthCached());
  const [hosted, setHosted] = useState(ls(HOSTED_PREF, '1') !== '0');
  useEffect(() => { void mailHealth().then(setH); }, []);
  if (!mailSignedIn()) return <div class="dim small"><Icon name="info" size={12} /> Đăng nhập tài khoản Phloem để có: ảnh lưu trên host (email nhẹ), link huỷ đăng ký thật, thống kê mở/click và gửi qua máy chủ.</div>;
  if (!h) return <div class="dim small">Relay này chưa có hạ tầng gửi mail (cần bản relay mới).</div>;
  return (
    <div class="row small" style={{ flexWrap: 'wrap', gap: 6 }}>
      <span class={`chip ${h.img && hosted ? 'on' : ''}`} title={h.img ? '' : 'Relay chưa cấu hình kho ảnh'}>Ảnh trên host{h.img ? '' : ' (chưa có)'}</span>
      <span class={`chip ${h.tracking ? 'on' : ''}`}>Huỷ đăng ký 1 chạm</span>
      <span class={`chip ${h.tracking ? 'on' : ''}`}>Thống kê mở/click</span>
      <span class="grow" />
      {h.img && <label class="row dim" style={{ gap: 4, cursor: 'pointer' }}><input type="checkbox" checked={hosted} onChange={(e) => { const v = (e.target as HTMLInputElement).checked; setHosted(v); keep(HOSTED_PREF, v ? '1' : '0'); }} />lưu ảnh trên host</label>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
/** Sending accounts + "Lên lịch gửi" through the relay. */
export function ServerSend({ p, to, skip, onSource }: { p: Project; to: string; skip: string; onSource?: (src: 'list' | 'paste') => void }) {
  const [src, setSrc] = useState<'list' | 'paste'>(() => (ls('phloem.mail.src') === 'paste' ? 'paste' : 'list'));
  const [aud, setAud] = useState<{ lists: AudList[]; segs: Segment[] } | null>(null);
  const [listId, setListId] = useState(''); const [segId, setSegId] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const client = p.clientId || null;
  useEffect(() => { onSource?.(src); }, [src]);
  useEffect(() => { if (!mailSignedIn()) return; void Promise.all([audLists(client), audSegments(client)]).then(([l, sg]) => { setAud({ lists: l.lists, segs: sg.segments }); if (l.lists[0] && !listId) setListId(l.lists[0].id); }).catch(() => setAud({ lists: [], segs: [] })); }, [client]);
  const curList = aud?.lists.find((l) => l.id === listId) || null;
  const curSeg = aud?.segs.find((x) => x.id === segId && x.list === listId) || null;
  const curGroup = segId.startsWith('tag:') ? curList?.groups?.find((g) => g.tag === segId.slice(4)) || null : null;
  useEffect(() => {
    if (!curList) { setCount(null); return; }
    const rules = curGroup ? [{ field: 'tag', op: 'has', value: curGroup.tag }] : curSeg?.rules;
    if (!rules) { setCount(curList.counts.subscribed); return; }
    void previewRules(client, curList.id, curSeg?.match || 'all', rules).then((r) => setCount(r.count)).catch(() => setCount(null));
  }, [listId, segId, aud]);
  const audience = src === 'list' && curList ? { client, list: curList.id, segment: curSeg?.id || null, tags: curGroup ? [curGroup.tag] : undefined, label: `${curList.name}${curSeg ? ` · ${curSeg.name}` : curGroup ? ` · nhóm ${curGroup.name}` : ''}`, count: count ?? 0 } : null;
  const [senders, setSenders] = useState<Sender[] | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [sel, setSel] = useState(ls('phloem.mail.sender'));
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [when, setWhen] = useState('');
  const [perDay, setPerDay] = useState(0);
  const [abOn, setAbOn] = useState(false);
  const [subjectB, setSubjectB] = useState('');
  const [split, setSplit] = useState(20);
  const [metric, setMetric] = useState<'opens' | 'clicks'>('opens');
  const [wait, setWait] = useState(4);
  const load = async () => { try { const r = await listSenders(); setSenders(r.senders); setProviders(r.providers); if (!r.senders.some((x) => x.id === sel) && r.senders[0]) setSel(r.senders[0].id); if (!r.senders.length) setAdding(true); } catch (e) { setErr((e as Error).message); setSenders([]); } };
  useEffect(() => { if (mailSignedIn()) void load(); }, []);
  if (!mailSignedIn()) return <div class="dim small">Đăng nhập tài khoản Phloem để gửi qua máy chủ.</div>;
  const run = async (fn: () => Promise<unknown>) => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); } };
  const s = senders?.find((x) => x.id === sel) || null;
  const skipSet = new Set(parseRecipients(skip));
  const n = src === 'list' ? count || 0 : parseRecipients(to).filter((e) => !skipSet.has(e)).length;
  const cap = Math.min(perDay || s?.perDay || 100, s?.perDay || 100);
  return (
    <div class="col" style={{ gap: 8 }}>
      <div class="small muted">Máy chủ gửi thay bạn qua hộp mail công ty (Titan, Google Workspace, Zoho, Outlook…), Resend, Brevo hoặc Amazon SES: hẹn giờ, chia theo hạn mức mỗi ngày, A/B tiêu đề. Đóng tab vẫn chạy.</div>
      <Seg block value={src} options={[{ v: 'list', label: 'Danh sách Khán giả' }, { v: 'paste', label: 'Dán email' }]} onChange={(v) => { setSrc(v); keep('phloem.mail.src', v); }} />
      {src === 'list' && (aud === null ? <div class="dim small">Đang tải danh sách…</div> : !aud.lists.length ? (
        <div class="dim small">Chưa có danh sách{client ? ' cho khách hàng này' : ''}. <a href="#" onClick={(e) => { e.preventDefault(); set({ route: { name: 'audience' }, clientFilter: client }); }}>Mở Khán giả</a> để nhập CSV hoặc tạo form đăng ký.</div>
      ) : (
        <div class="grid2">
          <Field label="Danh sách"><select class="in" value={listId} onChange={(e) => { setListId((e.target as HTMLSelectElement).value); setSegId(''); }}>{aud.lists.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.counts.subscribed.toLocaleString('vi-VN')}</option>)}</select></Field>
          <Field label="Nhóm / phân nhóm"><select class="in" value={segId} onChange={(e) => setSegId((e.target as HTMLSelectElement).value)}><option value="">Cả danh sách</option>{(curList?.groups || []).map((g) => <option key={g.tag} value={`tag:${g.tag}`}>Nhóm: {g.name}</option>)}{aud.segs.filter((x) => x.list === listId).map((x) => <option key={x.id} value={x.id}>⚡ {x.name}</option>)}</select></Field>
        </div>
      ))}
      {src === 'list' && curList && <div class="dim small">{count === null ? 'Đang đếm…' : `${count.toLocaleString('vi-VN')} người đang nhận`} · tự bỏ qua người đã huỷ, thư dội, báo spam · {'{{first_name|bạn}}'} chèn tên từng người{curList.company?.address ? '' : ' · nên điền địa chỉ công ty (Khán giả → Gửi & tên miền)'}</div>}
      {senders === null ? <div class="dim small">Đang tải kênh gửi…</div> : (
        <>
          {senders.length > 0 && (
            <div class="row" style={{ gap: 6 }}>
              <div class="grow"><Select value={sel} options={senders.map((x) => ({ v: x.id, label: `${x.label} · ${x.fromName ? `${x.fromName} <${x.fromEmail}>` : x.fromEmail}` }))} onChange={(v) => { setSel(v); keep('phloem.mail.sender', v); }} /></div>
              <Btn xs kind="ghost" icon="plus" onClick={() => setAdding(!adding)} title="Thêm kênh gửi" />
            </div>
          )}
          {s && !adding && (
            <div class="row small dim" style={{ gap: 6 }}>
              <span class="grow">≤ {nf(s.perDay)} thư/ngày</span>
              <Btn xs kind="ghost" disabled={busy} onClick={() => void run(async () => { const r = await testSender(s.id, getSession()?.user.email || ''); toast(`Đã gửi thư kiểm tra tới ${r.to}.`, 'ok'); })}>Gửi kiểm tra</Btn>
              <Btn xs kind="ghost" onClick={async () => { if (await ask(`Xoá kênh gửi ${s.fromEmail}? Khoá API trên relay bị xoá theo.`, 'Xoá', true)) void run(async () => { await deleteSender(s.id); await load(); }); }}>Xoá</Btn>
            </div>
          )}
          {adding && <SenderForm providers={providers} onSaved={(x) => { setAdding(false); setSel(x.id); keep('phloem.mail.sender', x.id); void load(); }} onCancel={senders.length ? () => setAdding(false) : undefined} />}
        </>
      )}
      {s && !adding && (
        <>
          <div class="grid2">
            <Field label="Bắt đầu gửi" hint="trống = ngay"><TextInput type="datetime-local" value={when} onCommit={setWhen} onInput={setWhen} /></Field>
            <Num label="Thư mỗi ngày" value={cap} min={1} max={s.perDay} onChange={(v) => setPerDay(Math.round(v))} />
          </div>
          <Toggle checked={abOn} onChange={setAbOn} label="A/B tiêu đề" sub="gửi 2 tiêu đề cho một nhóm nhỏ, tiêu đề thắng gửi cho số còn lại" />
          {abOn && (
            <div class="card" style={{ background: 'var(--panel)', gap: 8 }}>
              <Field label="Tiêu đề A"><div class="small mono">{p.fields.subject || '(điền Subject ở tab Email)'}</div></Field>
              <Field label="Tiêu đề B"><TextInput value={subjectB} onCommit={setSubjectB} onInput={setSubjectB} placeholder="Một cách viết khác" /></Field>
              <div class="grid2">
                <Num label="Nhóm thử" value={split} min={5} max={50} suffix="%" onChange={(v) => setSplit(Math.round(v))} />
                <Num label="Chờ" value={wait} min={1} max={72} suffix="giờ" onChange={(v) => setWait(Math.round(v))} />
              </div>
              <Seg block value={metric} options={[{ v: 'opens', label: 'Thắng theo lượt mở' }, { v: 'clicks', label: 'Thắng theo click' }]} onChange={setMetric} />
            </div>
          )}
          <Btn sm kind="primary" icon="send" disabled={busy || !n || (abOn && !subjectB.trim())} onClick={() => void run(() => startServerQueue(p, s, to, skip, { sendAt: when || undefined, perDay: cap, ab: abOn ? { subjectB: subjectB.trim(), split: split / 100, metric, waitHours: wait } : null, audience }))}>
            {n ? `${when ? 'Hẹn gửi' : 'Gửi'} tới ${nf(n)} người${n > cap ? ` · ${Math.ceil(n / cap)} ngày` : ''}` : src === 'list' ? 'Danh sách chưa có ai đang nhận' : 'Thêm người nhận ở trên'}
          </Btn>
        </>
      )}
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
    </div>
  );
}

/** Mailboxes over SMTP (mirrors server/src/smtp.mjs SMTP_PRESETS). */
const SMTP: Record<string, { label: string; host: string; port: number; secure: 'ssl' | 'starttls'; perDay: number; how: string }> = {
  titan: { label: 'Titan Mail', host: 'smtp.titan.email', port: 465, secure: 'ssl', perDay: 500, how: 'Dùng mật khẩu đăng nhập hộp mail Titan (Hostinger → Emails, hoặc app.titan.email).' },
  google: { label: 'Google Workspace / Gmail', host: 'smtp.gmail.com', port: 465, secure: 'ssl', perDay: 1800, how: 'Cần mật khẩu ứng dụng: bật Xác minh 2 bước → myaccount.google.com/apppasswords → tạo mật khẩu 16 ký tự (không dùng mật khẩu Google thường).' },
  zoho: { label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, secure: 'ssl', perDay: 500, how: 'Bật 2FA thì tạo mật khẩu ứng dụng ở Zoho → Bảo mật. Tài khoản ở EU/India dùng smtp.zoho.eu / smtp.zoho.in.' },
  outlook: { label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, secure: 'starttls', perDay: 1000, how: 'Quản trị M365 phải bật "Authenticated SMTP" cho hộp mail; có MFA thì dùng mật khẩu ứng dụng.' },
  hostinger: { label: 'Hostinger Email', host: 'smtp.hostinger.com', port: 465, secure: 'ssl', perDay: 500, how: 'Dùng mật khẩu hộp mail Hostinger.' },
  custom: { label: 'Hộp mail khác', host: '', port: 465, secure: 'ssl', perDay: 300, how: 'Lấy máy chủ SMTP, cổng và kiểu bảo mật trong hướng dẫn của nhà cung cấp email (cPanel, Yandex, GoDaddy…).' },
};
const HELP: Record<string, { key: string; how: string }> = {
  smtp: { key: 'Mật khẩu', how: 'Gửi từ chính hộp mail công ty (Titan, Google Workspace, Zoho, Outlook…) qua SMTP. Mỗi hộp mail là một kênh gửi; thêm bao nhiêu cũng được rồi chọn khi gửi.' },
  resend: { key: 'API key (re_…)', how: 'resend.com → Domains: thêm tên miền gửi (3 bản ghi DNS) → API Keys: tạo key quyền Sending.' },
  brevo: { key: 'API key (xkeysib-…)', how: 'brevo.com → Senders & Domains: xác thực tên miền → SMTP & API → API Keys: tạo key.' },
  ses: { key: '', how: 'AWS → SES: xác thực tên miền (DKIM) và xin thoát sandbox → IAM: user chỉ quyền ses:SendEmail → Access key.' },
};
export function SenderForm({ providers, onSaved, onCancel }: { providers: ProviderInfo[]; onSaved: (s: Sender) => void; onCancel?: () => void }) {
  const [prov, setProv] = useState<Sender['provider']>('smtp');
  const [fromEmail, setFromEmail] = useState(''); const [fromName, setFromName] = useState('');
  const [preset, setPreset0] = useState('titan'); const [host, setHost] = useState(SMTP.titan.host); const [port, setPort] = useState(SMTP.titan.port); const [secure, setSecure] = useState<'ssl' | 'starttls'>('ssl');
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const setPreset = (k: string) => { const x = SMTP[k] || SMTP.custom; setPreset0(k); setHost(x.host); setPort(x.port); setSecure(x.secure); setPerDay(x.perDay); };
  const [apiKey, setApiKey] = useState(''); const [accessKeyId, setAccessKeyId] = useState(''); const [secret, setSecret] = useState(''); const [region, setRegion] = useState('ap-southeast-1');
  const [perDay, setPerDay] = useState(0);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const info = providers.find((x) => x.id === prov);
  const save = async () => {
    setErr(''); setBusy(true);
    try { const r = await saveSender({ provider: prov, fromEmail: fromEmail.trim(), fromName: fromName.trim(), perDay: perDay || (prov === 'smtp' ? SMTP[preset]?.perDay : info?.perDay), ...(prov === 'smtp' ? { preset, host: host.trim(), port, secure, username: (username || fromEmail).trim(), password } : prov === 'ses' ? { accessKeyId, secret, region } : { apiKey }) }); toast('Đã lưu kênh gửi (khoá được mã hoá trên relay).', 'ok'); onSaved(r.sender); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div class="card" style={{ background: 'var(--panel)', gap: 8 }}>
      <div class="row small"><b class="grow">Thêm kênh gửi</b>{onCancel && <Btn xs kind="ghost" onClick={onCancel}>Đóng</Btn>}</div>
      <Seg block value={prov} options={(['smtp', 'resend', 'brevo', 'ses'] as Sender['provider'][]).filter((id) => !providers.length || providers.some((x) => x.id === id)).map((id) => ({ v: id, label: ({ smtp: 'Hộp mail (SMTP)', resend: 'Resend', brevo: 'Brevo', ses: 'Amazon SES' } as Record<string, string>)[id] }))} onChange={(v) => setProv(v)} />
      <div class="dim small">{HELP[prov].how}</div>
      <div class="grid2">
        <Field label="Email gửi"><TextInput value={fromEmail} onCommit={setFromEmail} onInput={setFromEmail} placeholder="news@tenmien.vn" /></Field>
        <Field label="Tên hiển thị"><TextInput value={fromName} onCommit={setFromName} onInput={setFromName} placeholder="HappyTown" /></Field>
      </div>
      {prov === 'smtp' ? (
        <>
          <Field label="Hộp mail"><Select value={preset} options={Object.entries(SMTP).map(([v, x]) => ({ v, label: x.label }))} onChange={setPreset} /></Field>
          <div class="dim small">{SMTP[preset]?.how}</div>
          <div class="grid2">
            <Field label="Máy chủ SMTP"><TextInput mono value={host} onCommit={setHost} onInput={setHost} placeholder="smtp.tenmien.com" /></Field>
            <div class="grid2">
              <Num label="Cổng" value={port} min={1} max={65535} onChange={(v) => setPort(Math.round(v))} />
              <Field label="Bảo mật"><Select value={secure} options={[{ v: 'ssl', label: 'SSL (465)' }, { v: 'starttls', label: 'STARTTLS (587)' }]} onChange={(v) => setSecure(v as 'ssl' | 'starttls')} /></Field>
            </div>
          </div>
          <div class="grid2">
            <Field label="Tên đăng nhập" hint="thường là chính email"><TextInput mono value={username} onCommit={setUsername} onInput={setUsername} placeholder={fromEmail || 'ban@tenmien.com'} /></Field>
            <Field label={preset === 'google' || preset === 'outlook' ? 'Mật khẩu ứng dụng' : 'Mật khẩu hộp mail'}><TextInput mono type="password" value={password} onCommit={setPassword} onInput={setPassword} /></Field>
          </div>
        </>
      ) : prov === 'ses' ? (
        <>
          <div class="grid2">
            <Field label="Access key ID"><TextInput mono value={accessKeyId} onCommit={setAccessKeyId} onInput={setAccessKeyId} /></Field>
            <Field label="Vùng"><TextInput mono value={region} onCommit={setRegion} onInput={setRegion} /></Field>
          </div>
          <Field label="Secret access key"><TextInput mono type="password" value={secret} onCommit={setSecret} onInput={setSecret} /></Field>
        </>
      ) : <Field label={HELP[prov].key}><TextInput mono type="password" value={apiKey} onCommit={setApiKey} onInput={setApiKey} /></Field>}
      <Num label="Thư tối đa mỗi ngày" value={perDay || (prov === 'smtp' ? SMTP[preset]?.perDay : info?.perDay) || 100} min={1} max={100000} onChange={(v) => setPerDay(Math.round(v))} />
      <div class="dim small">{prov === 'smtp' ? 'Mật khẩu được mã hoá trên relay và không bao giờ gửi ngược lại trình duyệt. Mỗi nhà cung cấp có hạn mức riêng (Titan, Zoho ~500/ngày; Google Workspace ~2.000/ngày): đặt thấp hơn để khỏi bị khoá hộp mail.' : 'Khoá được mã hoá trên relay và không bao giờ gửi ngược lại trình duyệt. Email gửi phải thuộc tên miền đã xác thực ở nhà cung cấp.'}</div>
      <Btn sm kind="primary" disabled={busy || !fromEmail.trim() || (prov === 'smtp' ? !(host.trim() && password) : prov === 'ses' ? !(accessKeyId && secret) : !apiKey)} onClick={() => void save()}>Lưu kênh gửi</Btn>
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
const STATUS: Record<string, string> = { scheduled: 'đã lên lịch', sending: 'đang gửi', waiting: 'chờ (hạn mức / A-B)', paused: 'tạm dừng', cancelled: 'đã huỷ', done: 'xong', error: 'lỗi' };
/** Campaigns sent from this email (this browser's, the relay's, and the Gmail queue's), with live numbers. Hidden ones
 *  stay one click away. */
export function CampaignStatsList({ projectId }: { projectId: string }) {
  const [, force] = useState(0);
  const [remote, setRemote] = useState<CampaignRef[]>([]);
  const [legacy, setLegacy] = useState<CampaignRef[]>([]);
  const [peek, setPeek] = useState(false);
  const [peekOld, setPeekOld] = useState(false);
  const load = () => serverCampaigns().then((r) => {
    setRemote(r.campaigns.filter((c) => c.project === projectId).map(({ project: _p, ...c }) => ({ ...c, projectId })));
    // sent before campaigns remembered their email: offer them here so nothing is ever out of reach
    const known = new Set(myCampaigns().map((c) => c.id));
    setLegacy(r.campaigns.filter((c) => !c.project && !known.has(c.id)).map(({ project: _p, ...c }) => ({ ...c, projectId })));
  }).catch(() => {});
  useEffect(() => { if (mailSignedIn()) void load(); }, [projectId]);
  const adopt = async (c: CampaignRef) => { try { await registerCampaign(c.id, { subject: c.subject, from: '', fromName: '', links: undefined as unknown as string[], project: projectId }); rememberCampaign(c); unhideCampaigns([c.id]); await load(); force((x) => x + 1); } catch (e) { toast((e as Error).message, 'err'); } };
  if (!mailSignedIn()) return null;
  const byId = new Map<string, CampaignRef>();
  for (const c of [...myCampaigns(projectId), ...remote]) if (!byId.has(c.id)) byId.set(c.id, c);
  const q = loadQueue(projectId);
  if (q?.tracked && !byId.has(q.id)) byId.set(q.id, { id: q.id, projectId, subject: q.subject, via: 'gmail', at: q.createdAt, recipients: q.recipients.length });
  const all = [...byId.values()].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  if (!all.length && !legacy.length) return null;
  const hidden = new Set(hiddenCampaigns());
  const shown = all.filter((c) => !hidden.has(c.id)), hid = all.filter((c) => hidden.has(c.id));
  const unhide = (ids: string[]) => { unhideCampaigns(ids); force((x) => x + 1); };
  return (
    <details class="small" open>
      <summary class="dim">Thống kê chiến dịch ({shown.length})</summary>
      <div class="col" style={{ gap: 6, marginTop: 6 }}>
        {shown.slice(0, 8).map((c) => <CampaignRow key={c.id} id={c.id} subject={c.subject} via={c.via} at={c.at} recipients={c.recipients} projectId={projectId} onForget={() => { forgetCampaign(c.id); force((x) => x + 1); }} />)}
        {hid.length > 0 && (
          <div class="row dim" style={{ gap: 6 }}>
            <span class="grow">{hid.length} chiến dịch đã ẩn</span>
            <Btn xs kind="ghost" onClick={() => setPeek(!peek)}>{peek ? 'Thu lại' : 'Xem'}</Btn>
            <Btn xs onClick={() => unhide(hid.map((c) => c.id))}>Hiện lại tất cả</Btn>
          </div>
        )}
        {legacy.length > 0 && (
          <div class="row dim" style={{ gap: 6 }}>
            <span class="grow">{legacy.length} chiến dịch cũ chưa gắn với email nào</span>
            <Btn xs kind="ghost" onClick={() => setPeekOld(!peekOld)}>{peekOld ? 'Thu lại' : 'Xem'}</Btn>
          </div>
        )}
        {peekOld && legacy.map((c) => (
          <div key={c.id} class="row" style={{ gap: 6 }}>
            <span class="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.subject}>{c.subject || c.id}</span>
            <span class="dim">{c.recipients ? `${c.recipients} người · ` : ''}{new Date(c.at).toLocaleDateString('vi-VN')}</span>
            <Btn xs onClick={() => void adopt(c)}>Gắn vào đây</Btn>
            <Btn xs kind="ghost" title="Ai mở · ai bấm · ai mua" onClick={() => set({ modal: 'people', peopleOf: c.id })}>Xem</Btn>
          </div>
        ))}
        {peek && hid.map((c) => (
          <div key={c.id} class="row" style={{ gap: 6 }}>
            <span class="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.subject}</span>
            <span class="dim">{new Date(c.at).toLocaleDateString('vi-VN')}</span>
            <Btn xs onClick={() => unhide([c.id])}>Hiện lại</Btn>
          </div>
        ))}
      </div>
    </details>
  );
}
function CampaignRow({ id, subject, via, at, recipients, projectId, onForget }: { id: string; subject: string; via: 'gmail' | 'server'; at: string; recipients: number; projectId: string; onForget: () => void }) {
  const [st, setSt] = useState<CampaignStats | null>(null);
  const [err, setErr] = useState('');
  const load = async () => { try { setSt(await campaignStats(id)); setErr(''); } catch (e) { setErr((e as Error).message); } };
  useEffect(() => { // a Gmail send from this browser: hand its recipient list to the relay so the report names people
    const q0 = via === 'gmail' ? loadQueue(projectId) : null;
    if (q0 && q0.id === id && q0.tracked && q0.recipients.length) void backfillRecipients(id, q0.recipients.slice(0, q0.cursor || q0.recipients.length), q0.createdAt).catch(() => {});
  }, [id]);
  useEffect(() => {
    void load();
    const live = () => st?.send && ['scheduled', 'sending', 'waiting'].includes(st.send.status);
    const t = setInterval(() => { if (document.visibilityState === 'visible' && (via === 'gmail' || live())) void load(); }, 20_000);
    return () => clearInterval(t);
  }, [id]);
  const q = via === 'gmail' ? loadQueue(projectId) : null;
  const sent = via === 'server' ? st?.queue.sent || 0 : q && q.id === id ? q.sent : recipients;
  const ctl = async (a: 'pause' | 'resume' | 'cancel') => { if (a === 'cancel' && !(await ask('Huỷ phần chưa gửi của chiến dịch này?', 'Huỷ gửi', true))) return; try { await serverSendControl(id, a); await load(); } catch (e) { setErr((e as Error).message); } };
  const send = st?.send;
  const total = st ? Object.values(st.queue).reduce((a, b) => a + b, 0) : 0;
  return (
    <div class="card" style={{ background: 'var(--panel)', gap: 6 }}>
      <div class="row"><b class="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject}</b><span class="chip">{via === 'server' ? 'máy chủ' : 'Gmail'}</span>{send && <span class={`chip ${send.status === 'done' ? 'on' : send.status === 'error' ? 'warn' : ''}`}>{STATUS[send.status] || send.status}</span>}</div>
      <div class="dim">{new Date(at).toLocaleString('vi-VN')}{send?.sendAt && send.status === 'scheduled' ? ` · gửi lúc ${new Date(send.sendAt).toLocaleString('vi-VN')}` : ''}</div>
      {st ? (
        <>
          <div class="grid2" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
            <Stat label="Đã gửi" v={nf(sent)} />
            <Stat label="Mở" v={nf(st.opens)} sub={pct(st.opens, sent)} />
            <Stat label="Click" v={nf(st.clicks)} sub={pct(st.clicks, sent)} />
            <Stat label="Huỷ ĐK" v={nf(st.unsubscribes)} sub={pct(st.unsubscribes, sent)} />
          </div>
          <div class="row camp-buy" title="Đơn hàng / đặt dịch vụ mà mã theo dõi trên website khớp với mail này">
            <div class="grow"><div class="dim" style={{ fontSize: 11 }}>Đã mua</div><b>{nf(st.buyers || 0)}</b> <span class="dim">người · {nf(st.orders || 0)} đơn</span></div><b class={st.revenue ? 'neon' : 'dim'} style={{ fontSize: 15 }}>{st.revenue ? `${Math.round(st.revenue).toLocaleString('vi-VN')}₫` : '0₫'}</b>
          </div>
          <Btn sm kind="primary" icon="search" onClick={() => set({ modal: 'people', peopleOf: id })}>Ai mở · ai bấm · ai mua</Btn>
          {via === 'server' && total > 0 && <Progress done={(st.queue.sent || 0) + (st.queue.failed || 0) + (st.queue.skipped || 0)} total={total - (st.queue.cancelled || 0)} />}
          {via === 'server' && total > 0 && <div class="dim">{nf(st.queue.queued || 0)} chờ · {nf(st.queue.failed || 0)} lỗi · {nf(st.queue.skipped || 0)} bỏ qua (đã huỷ ĐK){send?.lastError ? ` · ${send.lastError}` : ''}</div>}
          {send?.ab && <div class="dim">A/B: A {st.byVariant.A ? `${nf(st.byVariant.A.opens)} mở · ${nf(st.byVariant.A.clicks)} click` : '–'} | B {st.byVariant.B ? `${nf(st.byVariant.B.opens)} mở · ${nf(st.byVariant.B.clicks)} click` : '–'}{send.ab.winner ? ` → thắng: ${send.ab.winner === 'B' ? `B "${send.ab.subjectB}"` : 'A'}` : send.ab.phase === 'wait' ? ' · đang chờ kết quả' : ''}</div>}
          {st.links.length > 0 && <details><summary class="dim">Click theo link</summary>{st.links.sort((a, b) => b.clicks - a.clicks).map((l) => <div key={l.url} class="row dim"><span class="grow mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.url}</span><b>{nf(l.clicks)}</b></div>)}</details>}
        </>
      ) : !err && <div class="dim">Đang tải…</div>}
      <div class="row" style={{ gap: 6 }}>
        <Btn xs kind="ghost" onClick={() => void load()}>Làm mới</Btn>
        {via === 'server' && send && ['scheduled', 'sending', 'waiting'].includes(send.status) && <Btn xs onClick={() => void ctl('pause')}>Tạm dừng</Btn>}
        {via === 'server' && send && ['paused', 'error'].includes(send.status) && <Btn xs kind="primary" onClick={() => void ctl('resume')}>Tiếp tục</Btn>}
        {via === 'server' && send && !['done', 'cancelled'].includes(send.status) && <Btn xs kind="ghost" onClick={() => void ctl('cancel')}>Huỷ</Btn>}
        <span class="grow" />
        <Btn xs kind="ghost" onClick={onForget} title="Ẩn khỏi danh sách: số liệu vẫn còn, bấm Hiện lại ở cuối danh sách">Ẩn</Btn>
      </div>
      {err && (/không có chiến dịch/i.test(err)
        ? <div class="check warn"><span class="lv">MẤT SỐ LIỆU</span><span class="m">Máy chủ không còn chiến dịch này: lần gửi trùng lúc máy chủ cập nhật nên phần đăng ký theo dõi bị mất. Mail vẫn đã tới người nhận; chỉ số mở/click của lần này không xem được. Bấm Ẩn để dọn khỏi danh sách.</span></div>
        : <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>)}
    </div>
  );
}
const Stat = ({ label, v, sub }: { label: string; v: string; sub?: string }) => <div><div class="dim" style={{ fontSize: 11 }}>{label}</div><b style={{ fontSize: 15 }}>{v}</b>{sub && <span class="dim"> {sub}</span>}</div>;

// ---------------------------------------------------------------------------------------------------------------
/** The account-wide suppression list on the relay (unsubscribes land here automatically). */
export function SuppressionList({ localSkip }: { localSkip: string }) {
  const [rows, setRows] = useState<{ email: string; at: string; source: string }[] | null>(null);
  const [add, setAdd] = useState(''); const [err, setErr] = useState(''); const [q, setQ] = useState('');
  const load = async () => { try { setRows((await listSuppressions()).suppressions); } catch (e) { setErr((e as Error).message); } };
  if (!mailSignedIn()) return null;
  const local = parseRecipients(localSkip);
  const shown = (rows || []).filter((r) => !q || r.email.includes(q.toLowerCase())).slice(0, 100);
  return (
    <details class="small" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !rows) void load(); }}>
      <summary class="dim">Danh sách huỷ đăng ký trên relay{rows ? ` (${nf(rows.length)})` : ''}</summary>
      <div class="col" style={{ gap: 6, marginTop: 6 }}>
        <div class="dim">Ai bấm "Huỷ đăng ký" trong email (hoặc nút Unsubscribe của Gmail) tự vào đây và không bao giờ nhận thư nữa, ở mọi chiến dịch.</div>
        {local.length > 0 && <Btn xs onClick={() => void (async () => { try { const r = await addSuppressions(local, 'import'); toast(`Đã đưa ${nf(r.added)} email vào danh sách huỷ trên relay.`, 'ok'); await load(); } catch (e) { setErr((e as Error).message); } })()}>Đưa {nf(local.length)} email huỷ ở trên lên relay</Btn>}
        <TextArea value={add} rows={2} placeholder="Thêm email huỷ (mỗi dòng một email)" onInput={setAdd} onCommit={setAdd} />
        <div class="row" style={{ gap: 6 }}>
          <Btn xs disabled={!parseRecipients(add).length} onClick={() => void (async () => { try { const r = await addSuppressions(parseRecipients(add)); setAdd(''); toast(`Đã thêm ${nf(r.added)}.`, 'ok'); await load(); } catch (e) { setErr((e as Error).message); } })()}>Thêm</Btn>
          <span class="grow" />
          {rows && rows.length > 10 && <div style={{ width: 160 }}><TextInput value={q} onCommit={setQ} onInput={setQ} placeholder="Tìm email" /></div>}
        </div>
        {shown.map((r) => (
          <div key={r.email} class="row dim"><span class="grow mono">{r.email}</span><span>{r.source === 'unsubscribe' ? 'tự huỷ' : r.source}</span>
            <Btn xs kind="ghost" title="Cho phép gửi lại (chỉ khi người này đồng ý lại)" onClick={async () => { if (await ask(`Bỏ ${r.email} khỏi danh sách huỷ? Chỉ làm khi người này đã đồng ý nhận lại.`, 'Bỏ khỏi danh sách', true)) { try { await removeSuppression(r.email); await load(); } catch (e) { setErr((e as Error).message); } } }}>×</Btn>
          </div>
        ))}
        {rows && rows.length > shown.length && <div class="dim">… và {nf(rows.length - shown.length)} email khác</div>}
        {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span></div>}
      </div>
    </details>
  );
}
