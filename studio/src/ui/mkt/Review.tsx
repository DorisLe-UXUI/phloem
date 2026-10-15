// Public review page (#/review/<token>): the client opens a link, no account, sees one brand book or plan of their own
// workspace, approves or asks for changes per row or overall, comments. Built phone-first: clients review on Zalo.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { openShare, sendReview, type SharedItem } from '../../mkt/data';
import { FORMATS, channelOf, type BrandBook, type Plan, type Review } from '../../mkt/types';
import { Btn } from '../components';
import { Icon, LogoMark } from '../icons';

type Decision = 'approved' | 'changes';

export function ReviewPage({ token }: { token: string }) {
  const [it, setIt] = useState<SharedItem | null>(null);
  const [err, setErr] = useState('');
  const [name, setName] = useState(() => { try { return localStorage.getItem('phloem.review.name') || ''; } catch { return ''; } });
  const [dec, setDec] = useState<Record<string, Decision>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<string>('');
  useEffect(() => { document.title = 'Duyệt nội dung · Phloem'; openShare(token).then(setIt).catch((e) => setErr((e as Error).message)); }, [token]);
  const review = it?.review as Review | undefined;

  const submit = async (overall?: Decision) => {
    if (!name.trim()) { setErr('Nhập tên của bạn trước khi gửi.'); document.getElementById('rv-name')?.focus(); return; }
    setSending(true); setErr('');
    try { localStorage.setItem('phloem.review.name', name.trim()); } catch { /* private mode */ }
    try {
      const comments = [...Object.entries(notes).filter(([, t]) => t.trim()).map(([row, text]) => ({ row, text })), ...(general.trim() ? [{ row: null, text: general.trim() }] : [])];
      const rv = await sendReview(token, { name: name.trim(), rows: dec, comments, ...(overall ? { overall } : {}) });
      setIt((x) => (x ? { ...x, review: rv } : x));
      setDec({}); setNotes({}); setGeneral('');
      setSent(overall === 'approved' ? 'Cảm ơn! Agency đã nhận: bạn duyệt toàn bộ.' : overall === 'changes' ? 'Đã gửi yêu cầu sửa. Agency sẽ cập nhật và gửi lại.' : 'Đã gửi phản hồi. Cảm ơn bạn!');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setErr((e as Error).message); }
    finally { setSending(false); }
  };

  if (err && !it) return <div class="rv"><RvTop /><div class="rv-msg err"><Icon name="warn" size={22} /><b>Không mở được link</b><p>{err}</p></div></div>;
  if (!it) return <div class="rv"><RvTop /><div class="rv-msg"><div class="mk-spin" /><p>Đang mở nội dung… (lần đầu có thể mất tới 1 phút)</p></div></div>;
  const pending = Object.keys(dec).length + Object.values(notes).filter((t) => t.trim()).length + (general.trim() ? 1 : 0);

  return (
    <div class="rv">
      <RvTop client={it.client} />
      <div class="rv-body">
        <div class="rv-hero">
          <span class="mk-eyebrow">{it.kind === 'plan' ? 'Kế hoạch marketing' : 'Brand book'} chờ bạn duyệt</span>
          <h1>{it.kind === 'plan' ? (it.data as Plan).title : (it.data as BrandBook).title}</h1>
          <p class="muted">Bấm <b>Duyệt</b> hoặc <b>Cần sửa</b>{it.kind === 'plan' ? ' cho từng bài' : ''}, ghi chú nếu cần, rồi bấm Gửi. Link hết hạn {new Date(it.expiresAt).toLocaleDateString('vi-VN')}.</p>
          {review?.overall && <div class={`claim ${review.overall.status === 'changes' ? 'err' : ''}`}><Icon name={review.overall.status === 'approved' ? 'check' : 'warn'} /><span>{review.overall.by} đã {review.overall.status === 'approved' ? 'duyệt toàn bộ' : 'yêu cầu sửa'} lúc {new Date(review.overall.at).toLocaleString('vi-VN')}</span></div>}
          {sent && <div class="claim"><Icon name="check" /><span>{sent}</span></div>}
        </div>
        {it.kind === 'plan' ? <PlanReview plan={it.data as Plan} review={review} dec={dec} setDec={setDec} notes={notes} setNotes={setNotes} /> : <BrandReview book={it.data as BrandBook} />}
        {review?.comments?.length ? <section class="rv-card"><b>Bình luận trước đó</b>{review.comments.slice(-12).map((c, i) => <div key={i} class="rv-cmt"><b>{c.by}</b> <span class="dim small">{new Date(c.at).toLocaleString('vi-VN')}</span><p>{c.text}</p></div>)}</section> : null}
      </div>
      <div class="rv-bar">
        <input id="rv-name" class="in" placeholder="Tên của bạn" value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label="Tên của bạn" />
        <textarea class="in" rows={1} placeholder="Góp ý chung (không bắt buộc)" value={general} onInput={(e) => setGeneral((e.target as HTMLTextAreaElement).value)} aria-label="Góp ý chung" />
        {err && <span class="rv-err">{err}</span>}
        <div class="row">
          <Btn kind="ghost" disabled={sending} onClick={() => void submit('changes')}>Cần sửa</Btn>
          {pending > 0 && <Btn disabled={sending} onClick={() => void submit()}>Gửi {pending} phản hồi</Btn>}
          <Btn kind="primary" icon="check" disabled={sending} onClick={() => void submit('approved')}>{sending ? 'Đang gửi…' : 'Duyệt toàn bộ'}</Btn>
        </div>
      </div>
    </div>
  );
}

function RvTop({ client }: { client?: SharedItem['client'] }) {
  return <div class="rv-top">{client?.logo ? <img src={client.logo} alt="" /> : <LogoMark size={18} />}<b>{client?.name || 'Phloem'}</b><span class="grow" /><span class="dim small mono">qua Phloem MKT</span></div>;
}

function PlanReview({ plan, review, dec, setDec, notes, setNotes }: { plan: Plan; review?: Review; dec: Record<string, Decision>; setDec: (d: Record<string, Decision>) => void; notes: Record<string, string>; setNotes: (n: Record<string, string>) => void }) {
  const [month, setMonth] = useState('');
  const months = useMemo(() => [...new Set(plan.rows.map((r) => r.date.slice(0, 7)))], [plan]);
  const rows = plan.rows.filter((r) => !month || r.date.startsWith(month));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <section class="rv-card">
        <b>Chiến lược</b><p>{plan.strategy}</p>
        <div class="bb-chips">{plan.pillars.map((p) => <span key={p.name}>{p.name} · {p.share}%</span>)}</div>
        <div class="rv-months">{plan.months.map((m) => <div key={m.month}><span class="mono small">T{Number(m.month.slice(5))}/{m.month.slice(0, 4)}</span><b>{m.theme}</b><span class="dim small">{m.campaigns.map((c) => c.name).join(' · ')}</span></div>)}</div>
      </section>
      <div class="row wrap rv-filter">
        <div class="seg"><button class={!month ? 'on' : ''} onClick={() => setMonth('')}>Tất cả</button>{months.map((m) => <button key={m} class={month === m ? 'on' : ''} onClick={() => setMonth(m)}>T{Number(m.slice(5))}</button>)}</div>
        <span class="dim small">{rows.length} bài</span>
      </div>
      <div class="rv-rows">
        {rows.map((r) => {
          const prev = review?.rows?.[r.id]; const d = dec[r.id] || (prev?.status as Decision | undefined);
          const c = channelOf(r.channel);
          return (
            <div key={r.id} class={`rv-row ${d || ''}`} style={{ borderLeftColor: c.color }}>
              <div class="rv-row-h" onClick={() => setOpen(open === r.id ? null : r.id)}>
                <span class="mono small">{r.date.slice(8, 10)}/{r.date.slice(5, 7)} {r.time}</span>
                <span class="mk-chcell"><i style={{ background: c.color }} />{c.label}</span>
                <span class="dim small">{FORMATS.find((f) => f.id === r.format)?.label}</span>
                <b class="grow">{r.topic}</b>
                <Icon name="chevron" size={13} class={open === r.id ? 'rot' : ''} />
              </div>
              {open === r.id && <div class="rv-row-b">
                {r.hook && <p><span class="dim small">Hook</span><br />{r.hook}</p>}
                {r.caption && <p class="rv-cap">{r.caption}</p>}
                <p class="small">{r.cta && <b>{r.cta}</b>} <span class="dim">{r.hashtags}</span></p>
                {r.visual && <p class="small muted"><Icon name="image" size={12} /> {r.visual}</p>}
                <textarea class="in" rows={2} placeholder="Ghi chú cho bài này" value={notes[r.id] || ''} onInput={(e) => setNotes({ ...notes, [r.id]: (e.target as HTMLTextAreaElement).value })} aria-label={`Ghi chú cho ${r.topic}`} />
              </div>}
              <div class="rv-row-a">
                {prev && !dec[r.id] && <span class="dim small">{prev.by}: {prev.status === 'approved' ? 'đã duyệt' : 'cần sửa'}</span>}
                <span class="grow" />
                <button class={`rv-btn ${d === 'changes' ? 'on err' : ''}`} onClick={() => setDec({ ...dec, [r.id]: 'changes' })}>Cần sửa</button>
                <button class={`rv-btn ${d === 'approved' ? 'on ok' : ''}`} onClick={() => setDec({ ...dec, [r.id]: 'approved' })}><Icon name="check" size={13} /> Duyệt</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function BrandReview({ book }: { book: BrandBook }) {
  return (
    <section class="rv-card rv-brand">
      {book.tagline && <h2>{book.tagline}</h2>}
      <div class="bb-strip">{book.palette.map((c) => <i key={c.hex} style={{ background: c.hex, flex: Math.max(4, c.ratio) }} />)}</div>
      <p><b>Sứ mệnh.</b> {book.mission}</p>
      {book.vision && <p><b>Tầm nhìn.</b> {book.vision}</p>}
      <div class="bb-chips">{book.values.map((v) => <span key={v}>{v}</span>)}</div>
      <b>Khách hàng mục tiêu</b>
      <div class="bb-personas">{book.personas.map((p) => <div key={p.name} class="bb-persona"><b>{p.name}</b><p class="small">{[p.age, p.job].filter(Boolean).join(' · ')}</p><p class="small"><span class="dim">Muốn:</span> {p.goals}</p><p class="small"><span class="dim">Ngại:</span> {p.pains}</p></div>)}</div>
      <b>Giọng nói: {book.voice.traits.join(', ')}</b>
      <div class="bb-2"><ul class="bb-ul ok">{book.voice.do.map((x) => <li key={x}>{x}</li>)}</ul><ul class="bb-ul err">{book.voice.dont.map((x) => <li key={x}>{x}</li>)}</ul></div>
      <b>Thông điệp chính</b><ul class="bb-ul">{book.messages.map((x) => <li key={x}>{x}</li>)}</ul>
      <b>Bảng màu</b>
      <div class="bb-palette">{book.palette.map((c) => <div key={c.hex} class="bb-sw"><div class="bb-sw-c" style={{ background: c.hex }} /><b>{c.name}</b><span class="mono">{c.hex}</span></div>)}</div>
      <b>Chữ</b><p>{book.fonts.heading} (tiêu đề) · {book.fonts.body} (nội dung)</p>
      <b>Hashtag và CTA</b><div class="bb-chips">{[...book.kit.hashtags, ...book.kit.ctas].map((x) => <span key={x}>{x}</span>)}</div>
    </section>
  );
}
