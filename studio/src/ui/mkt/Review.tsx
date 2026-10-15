// Public review page (#/review/<token>): the client opens a link, no account, sees one brand book or plan of their own
// workspace, approves or asks for changes per row or overall, comments. Built phone-first: clients review on Zalo.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { openShare, sendReview, type SharedItem } from '../../mkt/data';
import { FORMATS, channelOf, type BrandBook, type Plan, type Review } from '../../mkt/types';
import { Btn } from '../components';
import { Icon, LogoMark } from '../icons';
import { bbLabels } from './BrandTab';

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
  useEffect(() => { openShare(token).then((x) => { setIt(x); document.title = `${(x.client.language && x.client.language !== 'vi' ? RV_EN : RV_VI).docTitle} · ${x.client.name}`; }).catch((e) => setErr((e as Error).message)); }, [token]);
  const T = rvText(it?.client.language);
  const loc = T === RV_VI ? 'vi-VN' : 'en-US';
  const review = it?.review as Review | undefined;

  const submit = async (overall?: Decision) => {
    if (!name.trim()) { setErr(T.needName); document.getElementById('rv-name')?.focus(); return; }
    setSending(true); setErr('');
    try { localStorage.setItem('phloem.review.name', name.trim()); } catch { /* private mode */ }
    try {
      const comments = [...Object.entries(notes).filter(([, t]) => t.trim()).map(([row, text]) => ({ row, text })), ...(general.trim() ? [{ row: null, text: general.trim() }] : [])];
      const rv = await sendReview(token, { name: name.trim(), rows: dec, comments, ...(overall ? { overall } : {}) });
      setIt((x) => (x ? { ...x, review: rv } : x));
      setDec({}); setNotes({}); setGeneral('');
      setSent(overall === 'approved' ? T.sentApproved : overall === 'changes' ? T.sentChanges : T.sentNotes);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setErr((e as Error).message); }
    finally { setSending(false); }
  };

  if (err && !it) return <div class="rv"><RvTop /><div class="rv-msg err"><Icon name="warn" size={22} /><b>{T.cannotOpen}</b><p>{err}</p></div></div>;
  if (!it) return <div class="rv"><RvTop /><div class="rv-msg"><div class="mk-spin" /><p>{T.loading}</p></div></div>;
  const pending = Object.keys(dec).length + Object.values(notes).filter((t) => t.trim()).length + (general.trim() ? 1 : 0);

  return (
    <div class="rv">
      <RvTop client={it.client} />
      <div class="rv-body">
        <div class="rv-hero">
          <span class="mk-eyebrow">{it.kind === 'plan' ? T.planWaiting : T.brandWaiting}</span>
          <h1>{it.kind === 'plan' ? (it.data as Plan).title : (it.data as BrandBook).title}</h1>
          <p class="muted">{T.intro(it.kind === 'plan', new Date(it.expiresAt).toLocaleDateString(loc))}</p>
          {review?.overall && <div class={`claim ${review.overall.status === 'changes' ? 'err' : ''}`}><Icon name={review.overall.status === 'approved' ? 'check' : 'warn'} /><span>{T.overallBy(review.overall.by, review.overall.status === 'approved', new Date(review.overall.at).toLocaleString(loc))}</span></div>}
          {sent && <div class="claim"><Icon name="check" /><span>{sent}</span></div>}
        </div>
        {it.kind === 'plan' ? <PlanReview T={T} plan={it.data as Plan} review={review} dec={dec} setDec={setDec} notes={notes} setNotes={setNotes} /> : <BrandReview T={T} book={it.data as BrandBook} />}
        {review?.comments?.length ? <section class="rv-card"><b>{T.earlier}</b>{review.comments.slice(-12).map((c, i) => <div key={i} class="rv-cmt"><b>{c.by}</b> <span class="dim small">{new Date(c.at).toLocaleString(loc)}</span><p>{c.text}</p></div>)}</section> : null}
      </div>
      <div class="rv-bar">
        <input id="rv-name" class="in" placeholder={T.yourName} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} aria-label={T.yourName} />
        <textarea class="in" rows={1} placeholder={T.general} value={general} onInput={(e) => setGeneral((e.target as HTMLTextAreaElement).value)} aria-label={T.general} />
        {err && <span class="rv-err">{err}</span>}
        <div class="row">
          <Btn kind="ghost" disabled={sending} onClick={() => void submit('changes')}>{T.changes}</Btn>
          {pending > 0 && <Btn disabled={sending} onClick={() => void submit()}>{T.sendN(pending)}</Btn>}
          <Btn kind="primary" icon="check" disabled={sending} onClick={() => void submit('approved')}>{sending ? T.sending : T.approveAll}</Btn>
        </div>
      </div>
    </div>
  );
}

function RvTop({ client }: { client?: SharedItem['client'] }) {
  return <div class="rv-top">{client?.logo ? <img src={client.logo} alt="" /> : <LogoMark size={18} />}<b>{client?.name || 'Phloem'}</b><span class="grow" /><span class="dim small mono">Phloem MKT</span></div>;
}

function PlanReview({ T, plan, review, dec, setDec, notes, setNotes }: { T: RvText; plan: Plan; review?: Review; dec: Record<string, Decision>; setDec: (d: Record<string, Decision>) => void; notes: Record<string, string>; setNotes: (n: Record<string, string>) => void }) {
  const [month, setMonth] = useState('');
  const months = useMemo(() => [...new Set(plan.rows.map((r) => r.date.slice(0, 7)))], [plan]);
  const rows = plan.rows.filter((r) => !month || r.date.startsWith(month));
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <section class="rv-card">
        <b>{T.strategy}</b><p>{plan.strategy}</p>
        <div class="bb-chips">{plan.pillars.map((p) => <span key={p.name}>{p.name} · {p.share}%</span>)}</div>
        <div class="rv-months">{plan.months.map((m) => <div key={m.month}><span class="mono small">{T.month(m.month)}</span><b>{m.theme}</b><span class="dim small">{m.campaigns.map((c) => c.name).join(' · ')}</span></div>)}</div>
      </section>
      <div class="row wrap rv-filter">
        <div class="seg"><button class={!month ? 'on' : ''} onClick={() => setMonth('')}>{T.all}</button>{months.map((m) => <button key={m} class={month === m ? 'on' : ''} onClick={() => setMonth(m)}>{T.monthShort(m)}</button>)}</div>
        <span class="dim small">{T.posts(rows.length)}</span>
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
                <span class="dim small">{T.format(r.format)}</span>
                <b class="grow">{r.topic}</b>
                <Icon name="chevron" size={13} class={open === r.id ? 'rot' : ''} />
              </div>
              {open === r.id && <div class="rv-row-b">
                {r.hook && <p><span class="dim small">Hook</span><br />{r.hook}</p>}
                {r.caption && <p class="rv-cap">{r.caption}</p>}
                <p class="small">{r.cta && <b>{r.cta}</b>} <span class="dim">{r.hashtags}</span></p>
                {r.visual && <p class="small muted"><Icon name="image" size={12} /> {r.visual}</p>}
                <textarea class="in" rows={2} placeholder={T.rowNote} value={notes[r.id] || ''} onInput={(e) => setNotes({ ...notes, [r.id]: (e.target as HTMLTextAreaElement).value })} aria-label={`${T.rowNote}: ${r.topic}`} />
              </div>}
              <div class="rv-row-a">
                {prev && !dec[r.id] && <span class="dim small">{prev.by}: {prev.status === 'approved' ? T.wasApproved : T.wasChanges}</span>}
                <span class="grow" />
                <button class={`rv-btn ${d === 'changes' ? 'on err' : ''}`} onClick={() => setDec({ ...dec, [r.id]: 'changes' })}>{T.changes}</button>
                <button class={`rv-btn ${d === 'approved' ? 'on ok' : ''}`} onClick={() => setDec({ ...dec, [r.id]: 'approved' })}><Icon name="check" size={13} /> {T.approve}</button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function BrandReview({ T, book }: { T: RvText; book: BrandBook }) {
  const L = bbLabels(T === RV_VI ? 'vi' : 'en');
  return (
    <section class="rv-card rv-brand">
      {book.tagline && <h2>{book.tagline}</h2>}
      <div class="bb-strip">{book.palette.map((c) => <i key={c.hex} style={{ background: c.hex, flex: Math.max(4, c.ratio) }} />)}</div>
      <p><b>{L.mission}.</b> {book.mission}</p>
      {book.vision && <p><b>{L.vision}.</b> {book.vision}</p>}
      <div class="bb-chips">{book.values.map((v) => <span key={v}>{v}</span>)}</div>
      <b>{L.s2}</b>
      <div class="bb-personas">{book.personas.map((p) => <div key={p.name} class="bb-persona"><b>{p.name}</b><p class="small">{[p.age, p.job].filter(Boolean).join(' · ')}</p><p class="small"><span class="dim">{L.goals}:</span> {p.goals}</p><p class="small"><span class="dim">{L.pains}:</span> {p.pains}</p></div>)}</div>
      <b>{L.s3}: {book.voice.traits.join(', ')}</b>
      <div class="bb-2"><ul class="bb-ul ok">{book.voice.do.map((x) => <li key={x}>{x}</li>)}</ul><ul class="bb-ul err">{book.voice.dont.map((x) => <li key={x}>{x}</li>)}</ul></div>
      <b>{L.messages}</b><ul class="bb-ul">{book.messages.map((x) => <li key={x}>{x}</li>)}</ul>
      <b>{L.s6}</b>
      <div class="bb-palette">{book.palette.map((c) => <div key={c.hex} class="bb-sw"><div class="bb-sw-c" style={{ background: c.hex }} /><b>{c.name}</b><span class="mono">{c.hex}</span></div>)}</div>
      <b>{L.s7}</b><p>{book.fonts.heading} ({L.heading}) · {book.fonts.body} ({L.body})</p>
      <b>Hashtag · CTA</b><div class="bb-chips">{[...book.kit.hashtags, ...book.kit.ctas].map((x) => <span key={x}>{x}</span>)}</div>
    </section>
  );
}

/** The review page speaks the client's language (Vietnamese or English; other languages fall back to English). */
type RvText = typeof RV_VI;
const RV_VI = {
  docTitle: 'Duyệt nội dung', needName: 'Nhập tên của bạn trước khi gửi.', sentApproved: 'Cảm ơn! Agency đã nhận: bạn duyệt toàn bộ.', sentChanges: 'Đã gửi yêu cầu sửa. Agency sẽ cập nhật và gửi lại.', sentNotes: 'Đã gửi phản hồi. Cảm ơn bạn!',
  cannotOpen: 'Không mở được link', loading: 'Đang mở nội dung… (lần đầu có thể mất tới 1 phút)', planWaiting: 'Kế hoạch marketing chờ bạn duyệt', brandWaiting: 'Brand book chờ bạn duyệt',
  intro: (plan: boolean, exp: string) => `Bấm Duyệt hoặc Cần sửa${plan ? ' cho từng bài' : ''}, ghi chú nếu cần, rồi bấm Gửi. Link hết hạn ${exp}.`,
  overallBy: (by: string, ok: boolean, at: string) => `${by} đã ${ok ? 'duyệt toàn bộ' : 'yêu cầu sửa'} lúc ${at}`,
  earlier: 'Bình luận trước đó', yourName: 'Tên của bạn', general: 'Góp ý chung (không bắt buộc)', changes: 'Cần sửa', approve: 'Duyệt', approveAll: 'Duyệt toàn bộ', sending: 'Đang gửi…',
  month: (m: string) => `T${Number(m.slice(5))}/${m.slice(0, 4)}`, monthShort: (m: string) => `T${Number(m.slice(5))}`, format: (f: string) => FORMATS.find((x) => x.id === f)?.label || f,
  sendN: (n: number) => `Gửi ${n} phản hồi`, strategy: 'Chiến lược', all: 'Tất cả', posts: (n: number) => `${n} bài`, rowNote: 'Ghi chú cho bài này', wasApproved: 'đã duyệt', wasChanges: 'cần sửa',
};
const RV_EN: RvText = {
  docTitle: 'Review', needName: 'Please enter your name before sending.', sentApproved: 'Thank you! The agency got your approval of everything.', sentChanges: 'Change request sent. The agency will update it and send it back.', sentNotes: 'Feedback sent. Thank you!',
  cannotOpen: 'This link cannot be opened', loading: 'Opening… (the first visit can take up to a minute)', planWaiting: 'Marketing plan for your review', brandWaiting: 'Brand book for your review',
  intro: (plan: boolean, exp: string) => `Press Approve or Request changes${plan ? ' on each post' : ''}, add notes if needed, then send. This link expires ${exp}.`,
  overallBy: (by: string, ok: boolean, at: string) => `${by} ${ok ? 'approved everything' : 'requested changes'} on ${at}`,
  earlier: 'Earlier comments', yourName: 'Your name', general: 'General feedback (optional)', changes: 'Request changes', approve: 'Approve', approveAll: 'Approve all', sending: 'Sending…',
  month: (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), monthShort: (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'short' }), format: (f: string) => ({ image: 'Image', carousel: 'Carousel', reel: 'Reel', video: 'Video', story: 'Story', article: 'Article', ad: 'Ad' } as Record<string, string>)[f] || f,
  sendN: (n: number) => `Send ${n} ${n === 1 ? 'note' : 'notes'}`, strategy: 'Strategy', all: 'All', posts: (n: number) => `${n} posts`, rowNote: 'Note on this post', wasApproved: 'approved', wasChanges: 'changes requested',
};
const rvText = (lang?: string): RvText => (!lang || lang === 'vi' ? RV_VI : RV_EN);
