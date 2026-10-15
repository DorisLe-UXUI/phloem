// Module Thương hiệu: sources (website, Google Sheet, Drive, files) → AI brand book → edit → client review → brand kit.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { get, toast, useStore } from '../../store';
import { assets } from '../../storage/assets';
import { buildBrandBook, type BrandProgress } from '../../mkt/brandAi';
import { cachedItems, isRelay, putItem, saveClient } from '../../mkt/data';
import { canWrite, type BrandBook, type Client, type PaletteColor, type Persona, type Review } from '../../mkt/types';
import { ensureFonts } from '../../render/fonts';
import { Btn, Field } from '../components';
import { Icon } from '../icons';
import { ask } from '../confirm';
import { Empty, PageHead, StatusChip, fmtTime } from './bits';
import { ShareButton } from './Workspace';

export function BrandTab({ client }: { client: Client }) {
  const s = useStore();
  const item = useMemo(() => cachedItems(client.id)?.find((i) => i.kind === 'brand' && i.id === 'main'), [client.id, s.clientsAt]);
  const review = useMemo(() => cachedItems(client.id)?.find((i) => i.kind === 'review' && i.id === 'brand-main')?.data as Review | undefined, [client.id, s.clientsAt]);
  const book = item?.data as BrandBook | undefined;
  const [redo, setRedo] = useState(false);
  const write = canWrite(client.role);
  if (!book || redo) return <BrandIntake client={client} existing={book} onCancel={book ? () => setRedo(false) : undefined} onDone={() => setRedo(false)} />;
  return <BrandBookView client={client} book={book} review={review} write={write} onRedo={() => setRedo(true)} />;
}

// ---------- intake ----------
function BrandIntake({ client, existing, onCancel, onDone }: { client: Client; existing?: BrandBook; onCancel?: () => void; onDone: () => void }) {
  const [website, setWebsite] = useState(existing?.sources.website || client.website || '');
  const [sheet, setSheet] = useState(existing?.sources.sheet || '');
  const [drive, setDrive] = useState(existing?.sources.drive || '');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [prog, setProg] = useState<BrandProgress | null>(null);
  const [started, setStarted] = useState(0);
  const [, tick] = useState(0);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { if (!prog) return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, [!!prog]);
  const write = canWrite(client.role);

  const run = async () => {
    if (!website.trim() && !sheet.trim() && !files.length && !notes.trim()) { toast('Cần ít nhất một nguồn: website, Sheet, file hoặc ghi chú.', 'err'); return; }
    abort.current = new AbortController();
    const t0 = Date.now();
    setStarted(t0); setProg({ step: 0, total: 4, label: 'Bắt đầu…' });
    try {
      const { book, logo, notes: warn, industry } = await buildBrandBook(client, { website, sheet, drive, notes, files }, setProg, abort.current.signal);
      const by = get().user?.name || 'Bạn';
      const version = (existing?.version || 0) + 1;
      book.version = version;
      book.versions = [...(existing?.versions || []), { version, at: new Date().toISOString(), by, note: existing ? 'AI soạn lại' : 'AI soạn bản đầu' }].slice(-30);
      await putItem(client.id, 'brand', 'main', book);
      // fill what the client form left open: logo, website, and the industry the AI recognised
      const patch: Partial<Client> = {};
      if (logo && !client.logo) patch.logo = logo;
      if (website.trim() && !client.website) patch.website = /^https?:/.test(website) ? website.trim() : `https://${website.trim()}`;
      if (industry && !client.industry) patch.industry = industry;
      if (Object.keys(patch).length) await saveClient({ ...client, ...patch });
      if (patch.industry) toast(`AI nhận diện ngành: ${patch.industry}`, 'info');
      for (const w of warn) toast(w, 'info');
      toast(`Xong brand book sau ${Math.round((Date.now() - t0) / 1000) || 1} giây. Xem lại rồi gửi khách duyệt.`, 'ok');
      onDone();
    } catch (e) { toast((e as Error).message, 'err'); }
    finally { setProg(null); }
  };

  if (prog) {
    const secs = Math.round((Date.now() - started) / 1000);
    return (
      <>
        <PageHead title="Đang lên thương hiệu" sub={`${client.name} · ${secs}s`} />
        <div class="mk-card mk-progress">
          {['Đọc website', 'Đọc Sheet, lấy logo', 'AI viết brand book', 'Kiểm tra và lưu'].map((l, i) => (
            <div key={l} class={`mk-step ${prog.step > i + 1 ? 'done' : prog.step === i + 1 ? 'on' : ''}`}><i>{prog.step > i + 1 ? <Icon name="check" size={12} /> : i + 1}</i><span>{l}</span></div>
          ))}
          <div class="mk-prog-label">{prog.label}{prog.chars ? <span class="mono dim"> · {Math.round(prog.chars / 100) / 10}k ký tự</span> : null}</div>
          <div class="mk-prog-bar"><i style={{ width: `${Math.min(98, (prog.step / prog.total) * 100 - 12 + Math.min(10, (prog.chars || 0) / 800))}%` }} /></div>
          <Btn sm kind="ghost" onClick={() => abort.current?.abort()}>Huỷ</Btn>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHead title={existing ? 'Soạn lại brand book' : 'Lên thương hiệu'} sub="Đưa link website, Google Sheet, thư mục Drive hoặc file hướng dẫn thương hiệu. AI đọc hết rồi viết brand book và brand kit dùng chung cho mọi module."
        actions={<>{onCancel && <Btn kind="ghost" onClick={onCancel}>Huỷ</Btn>}<Btn kind="primary" icon="sparkle" disabled={!write} onClick={() => void run()}>AI soạn brand book</Btn></>} />
      {!write && <div class="claim"><Icon name="lock" /><span class="grow">Vai trò của bạn chỉ được xem.</span></div>}
      <div class="mk-cols">
        <section class="mk-card col" style={{ padding: 14, gap: 12 }}>
          <Field label="Website" hint="đọc màu, font, logo, nội dung, trang con"><input class="in" value={website} placeholder="https://caphegio.vn" onInput={(e) => setWebsite((e.target as HTMLInputElement).value)} /></Field>
          <Field label="Google Sheet" hint="chia sẻ: bất kỳ ai có link"><input class="in" value={sheet} placeholder="https://docs.google.com/spreadsheets/d/…" onInput={(e) => setSheet((e.target as HTMLInputElement).value)} /></Field>
          <Field label="Thư mục Google Drive" hint="lưu làm nguồn; tải file lên bên dưới để AI đọc"><input class="in" value={drive} placeholder="https://drive.google.com/drive/folders/…" onInput={(e) => setDrive((e.target as HTMLInputElement).value)} /></Field>
          <Field label="Ghi chú / brief của khách"><textarea class="in" rows={4} value={notes} placeholder="Khách muốn trẻ trung hơn, nhắm sinh viên, đối thủ là…" onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} /></Field>
        </section>
        <section class="mk-card col" style={{ padding: 14, gap: 10 }}>
          <b>File của khách</b>
          <span class="muted small">PDF brand guideline, ảnh logo, ảnh sản phẩm, bài đăng cũ, file .txt/.md. Tối đa 6 file, mỗi file ≤ 12MB.</span>
          <label class="mk-drop">
            <Icon name="upload" size={20} /><span>Kéo thả hoặc bấm để chọn file</span>
            <input type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp,.txt,.md,.csv" hidden onChange={(e) => { const f = [...((e.target as HTMLInputElement).files || [])]; setFiles((x) => [...x, ...f].slice(0, 6)); (e.target as HTMLInputElement).value = ''; }} />
          </label>
          {files.map((f, i) => <div key={i} class="mk-line static"><Icon name={f.type === 'application/pdf' ? 'text' : 'image'} size={14} /><span class="grow mk-ell">{f.name}</span><span class="dim small mono">{Math.round(f.size / 1024)} KB</span><Btn xs kind="ghost" icon="close" title={`Bỏ ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))} /></div>)}
          <div class="dim small">Thời gian: khoảng 1–3 phút. Website đọc qua relay; Google Drive riêng tư cần kết nối Google (giai đoạn sau), hiện tại tải file trực tiếp lên đây.</div>
        </section>
      </div>
    </>
  );
}

// ---------- the book ----------
function BrandBookView({ client, book, review, write, onRedo }: { client: Client; book: BrandBook; review?: Review; write: boolean; onRedo: () => void }) {
  const s = useStore();
  const [edit, setEdit] = useState(false);
  const [d, setD] = useState<BrandBook>(book);
  useEffect(() => { if (!edit) setD(book); }, [book, edit]);
  useEffect(() => { ensureFonts([book.fonts.heading, book.fonts.body]); }, [book.fonts.heading, book.fonts.body]);
  const logoUrl = book.logo.main ? assets.url(book.logo.main) : undefined;

  const save = async (next: BrandBook, note: string) => {
    const version = (book.version || 1) + 1;
    const nb = { ...next, version, versions: [...(book.versions || []), { version, at: new Date().toISOString(), by: s.user?.name || 'Bạn', note }].slice(-30), updatedBy: s.user?.name };
    try { await putItem(client.id, 'brand', 'main', nb); toast('Đã lưu brand book.', 'ok'); } catch (e) { toast((e as Error).message, 'err'); }
  };
  const setStatus = (st: BrandBook['status']) => void save({ ...book, status: st }, st === 'approved' ? 'Đánh dấu đã duyệt' : st === 'pending' ? 'Gửi duyệt' : 'Về nháp');
  const comments = (review?.comments || []).slice(-10).reverse();

  return (
    <div class="mk-bb-wrap">
      <PageHead title={book.title} chips={<><StatusChip s={book.status} /><span class="chip mono">v{book.version}</span></>}
        sub={book.updatedBy ? `Sửa lần cuối bởi ${book.updatedBy}` : 'Brand kit này dùng cho mọi module: thiết kế, kế hoạch, email.'}
        actions={write ? (edit ? <><Btn kind="ghost" onClick={() => { setEdit(false); setD(book); }}>Huỷ</Btn><Btn kind="primary" icon="check" onClick={() => { void save(d, 'Sửa tay').then(() => setEdit(false)); }}>Lưu bản mới</Btn></>
          : <>
            <Btn kind="ghost" icon="sparkle" onClick={async () => { if (await ask('Soạn lại brand book bằng AI? Bản hiện tại vẫn nằm trong lịch sử phiên bản.', 'Soạn lại', false)) onRedo(); }}>Soạn lại</Btn>
            <Btn icon="text" onClick={() => setEdit(true)}>Sửa</Btn>
            {isRelay() ? <ShareButton client={client} kind="brand" itemId="main" onShared={() => { if (book.status === 'draft') setStatus('pending'); }} /> : null}
            {book.status !== 'approved' ? <Btn kind="primary" icon="check" onClick={() => setStatus('approved')}>Duyệt thương hiệu</Btn> : <Btn kind="ghost" onClick={() => setStatus('draft')}>Mở lại để sửa</Btn>}
          </>) : undefined} />

      {review?.overall && <div class={`claim ${review.overall.status === 'changes' ? 'err' : ''}`}><Icon name={review.overall.status === 'approved' ? 'check' : 'warn'} /><span class="grow"><b>{review.overall.by}</b> {review.overall.status === 'approved' ? 'đã duyệt brand book' : 'muốn sửa brand book'} · {fmtTime(review.overall.at)}</span>{review.overall.status === 'approved' && book.status !== 'approved' && write && <Btn sm kind="primary" onClick={() => setStatus('approved')}>Áp dụng: Đã duyệt</Btn>}</div>}
      {comments.length > 0 && <section class="mk-card"><div class="mk-card-h"><b>Bình luận của khách</b></div>{comments.map((c, i) => <div key={i} class="mk-line static"><b>{c.by}</b><span class="grow">{c.text}</span><span class="dim small mono">{fmtTime(c.at)}</span></div>)}</section>}

      <article class="mk-bb" style={{ ['--bb-h' as string]: `'${book.fonts.heading}', serif`, ['--bb-b' as string]: `'${book.fonts.body}', sans-serif`, ['--bb-p' as string]: book.palette.find((c) => c.role === 'primary')?.hex || '#39ff14', ['--bb-a' as string]: book.palette.find((c) => c.role === 'accent')?.hex || '#ffc53d' }}>
        <header class="bb-cover">
          {client.logo ? <img src={client.logo} alt={`Logo ${client.name}`} /> : logoUrl ? <img src={logoUrl} alt={`Logo ${client.name}`} /> : null}
          <h2>{client.name}</h2>
          {edit ? <input class="in" value={d.tagline} onInput={(e) => setD({ ...d, tagline: (e.target as HTMLInputElement).value })} aria-label="Tagline" /> : <p>{book.tagline}</p>}
          <div class="bb-strip">{book.palette.map((c) => <i key={c.hex} style={{ background: c.hex, flex: Math.max(4, c.ratio) }} />)}</div>
        </header>

        <Sec n="01" title="Sứ mệnh, tầm nhìn, giá trị">
          <div class="bb-2">
            <Txt label="Sứ mệnh" v={d.mission} edit={edit} on={(v) => setD({ ...d, mission: v })} />
            <Txt label="Tầm nhìn" v={d.vision} edit={edit} on={(v) => setD({ ...d, vision: v })} />
          </div>
          <Lst label="Giá trị cốt lõi" v={d.values} edit={edit} on={(v) => setD({ ...d, values: v })} chips />
        </Sec>

        <Sec n="02" title="Khách hàng mục tiêu">
          <div class="bb-personas">
            {d.personas.map((p, i) => <PersonaCard key={i} p={p} edit={edit} on={(np) => setD({ ...d, personas: d.personas.map((x, j) => (j === i ? np : x)) })} onDel={() => setD({ ...d, personas: d.personas.filter((_, j) => j !== i) })} />)}
            {edit && d.personas.length < 4 && <button class="bb-add" onClick={() => setD({ ...d, personas: [...d.personas, { name: 'Persona mới', age: '', job: '', goals: '', pains: '', channels: '' }] })}><Icon name="plus" /> Thêm persona</button>}
          </div>
        </Sec>

        <Sec n="03" title="Giọng nói">
          <Lst label="Tính cách" v={d.voice.traits} edit={edit} on={(v) => setD({ ...d, voice: { ...d.voice, traits: v } })} chips />
          <div class="bb-2">
            <Lst label="Nên" v={d.voice.do} edit={edit} on={(v) => setD({ ...d, voice: { ...d.voice, do: v } })} tone="ok" />
            <Lst label="Không nên" v={d.voice.dont} edit={edit} on={(v) => setD({ ...d, voice: { ...d.voice, dont: v } })} tone="err" />
          </div>
        </Sec>

        <Sec n="04" title="Thông điệp, USP, đối thủ">
          <div class="bb-2">
            <Lst label="Thông điệp chính" v={d.messages} edit={edit} on={(v) => setD({ ...d, messages: v })} />
            <Lst label="Điểm khác biệt (USP)" v={d.usp} edit={edit} on={(v) => setD({ ...d, usp: v })} />
          </div>
          <Lst label="Đối thủ" v={d.competitors.map((c) => `${c.name}: ${c.note}`)} edit={edit} on={(v) => setD({ ...d, competitors: v.map((x) => { const [n, ...r] = x.split(':'); return { name: n.trim(), note: r.join(':').trim() }; }) })} />
        </Sec>

        <Sec n="05" title="Logo">
          <div class="bb-logos">
            <div class="bb-logo light">{logoUrl || client.logo ? <img src={logoUrl || client.logo} alt="Logo trên nền sáng" /> : <span class="dim">Chưa có logo</span>}<span>Nền sáng</span></div>
            <div class="bb-logo dark">{book.logo.light ? <img src={assets.url(book.logo.light)} alt="Logo trên nền tối" /> : logoUrl || client.logo ? <img src={logoUrl || client.logo} alt="Logo trên nền tối" /> : <span class="dim">Chưa có logo</span>}<span>Nền tối</span></div>
          </div>
          <Lst label="Quy tắc dùng logo" v={d.logo.rules} edit={edit} on={(v) => setD({ ...d, logo: { ...d.logo, rules: v } })} />
        </Sec>

        <Sec n="06" title="Bảng màu">
          <div class="bb-palette">
            {d.palette.map((c, i) => <Swatch key={i} c={c} edit={edit} on={(nc) => setD({ ...d, palette: d.palette.map((x, j) => (j === i ? nc : x)) })} onDel={() => setD({ ...d, palette: d.palette.filter((_, j) => j !== i) })} />)}
            {edit && d.palette.length < 10 && <button class="bb-add" onClick={() => setD({ ...d, palette: [...d.palette, { name: 'Màu mới', hex: '#888888', role: 'neutral', ratio: 5 }] })}><Icon name="plus" /> Thêm màu</button>}
          </div>
        </Sec>

        <Sec n="07" title="Chữ">
          <div class="bb-type">
            <div><span class="bb-l">Tiêu đề · {d.fonts.heading}</span>{edit ? <input class="in" value={d.fonts.heading} onInput={(e) => setD({ ...d, fonts: { ...d.fonts, heading: (e.target as HTMLInputElement).value } })} /> : <div class="bb-h-demo">{book.tagline || client.name}</div>}</div>
            <div><span class="bb-l">Nội dung · {d.fonts.body}</span>{edit ? <input class="in" value={d.fonts.body} onInput={(e) => setD({ ...d, fonts: { ...d.fonts, body: (e.target as HTMLInputElement).value } })} /> : <div class="bb-b-demo">{book.mission ? book.mission.slice(0, 160) : client.name} · Tiếng Việt có dấu hiển thị đầy đủ: ă â đ ê ô ơ ư ạ ậ ể ữ.</div>}</div>
          </div>
          <Txt label="Cách dùng" v={d.fonts.note} edit={edit} on={(v) => setD({ ...d, fonts: { ...d.fonts, note: v } })} />
        </Sec>

        <Sec n="08" title="Hình ảnh và bố cục">
          <div class="bb-2">
            <Lst label="Phong cách ảnh" v={d.imagery} edit={edit} on={(v) => setD({ ...d, imagery: v })} />
            <Lst label="Quy tắc bố cục" v={d.layout} edit={edit} on={(v) => setD({ ...d, layout: v })} />
          </div>
          <div class="bb-2">
            <Lst label="Ví dụ đúng" v={d.examples.do} edit={edit} on={(v) => setD({ ...d, examples: { ...d.examples, do: v } })} tone="ok" />
            <Lst label="Ví dụ sai" v={d.examples.dont} edit={edit} on={(v) => setD({ ...d, examples: { ...d.examples, dont: v } })} tone="err" />
          </div>
        </Sec>

        <Sec n="09" title="Brand kit">
          <div class="bb-2">
            <Lst label="Hashtag" v={d.kit.hashtags} edit={edit} on={(v) => setD({ ...d, kit: { ...d.kit, hashtags: v } })} chips />
            <Lst label="CTA mặc định" v={d.kit.ctas} edit={edit} on={(v) => setD({ ...d, kit: { ...d.kit, ctas: v } })} chips />
          </div>
          <p class="bb-note">Đổi brand kit thì email và thiết kế mới của {client.name} tự theo màu, font, logo này.</p>
        </Sec>
      </article>

      <section class="mk-card">
        <div class="mk-card-h"><b>Lịch sử phiên bản</b><span class="dim small">nguồn: {[book.sources.website, book.sources.sheet && 'Google Sheet', book.sources.drive && 'Drive', ...(book.sources.files || [])].filter(Boolean).join(' · ') || 'ghi chú'}</span></div>
        {(book.versions || []).slice().reverse().map((v) => <div key={v.version} class="mk-line static"><span class="chip mono">v{v.version}</span><span class="grow">{v.note}</span><span class="dim small">{v.by} · {fmtTime(v.at)}</span></div>)}
      </section>
    </div>
  );
}

function Sec({ n, title, children }: { n: string; title: string; children: preact.ComponentChildren }) {
  return <section class="bb-sec"><div class="bb-sec-h"><span class="bb-n">{n}</span><h3>{title}</h3></div>{children}</section>;
}
function Txt({ label, v, edit, on }: { label: string; v: string; edit: boolean; on: (v: string) => void }) {
  return <div class="bb-txt"><span class="bb-l">{label}</span>{edit ? <textarea class="in" rows={3} value={v} onInput={(e) => on((e.target as HTMLTextAreaElement).value)} aria-label={label} /> : <p>{v || <span class="dim">—</span>}</p>}</div>;
}
function Lst({ label, v, edit, on, chips, tone }: { label: string; v: string[]; edit: boolean; on: (v: string[]) => void; chips?: boolean; tone?: 'ok' | 'err' }) {
  if (edit) return <div class="bb-txt"><span class="bb-l">{label} <span class="dim">· mỗi dòng một ý</span></span><textarea class="in" rows={Math.max(3, v.length + 1)} value={v.join('\n')} onInput={(e) => on((e.target as HTMLTextAreaElement).value.split('\n').map((x) => x.trim()).filter(Boolean))} aria-label={label} /></div>;
  return (
    <div class="bb-txt"><span class="bb-l">{label}</span>
      {!v.length ? <p class="dim">—</p> : chips ? <div class="bb-chips">{v.map((x) => <span key={x}>{x}</span>)}</div> : <ul class={`bb-ul ${tone || ''}`}>{v.map((x, i) => <li key={i}>{x}</li>)}</ul>}
    </div>
  );
}
function PersonaCard({ p, edit, on, onDel }: { p: Persona; edit: boolean; on: (p: Persona) => void; onDel: () => void }) {
  const f = (k: keyof Persona, label: string) => (edit ? <label class="bb-pf"><span>{label}</span><input class="in" value={p[k]} onInput={(e) => on({ ...p, [k]: (e.target as HTMLInputElement).value })} /></label> : p[k] ? <div class="bb-pf"><span>{label}</span><p>{p[k]}</p></div> : null);
  return (
    <div class="bb-persona">
      <div class="row"><span class="bb-pav">{p.name.trim().slice(0, 1).toUpperCase()}</span>{edit ? <input class="in grow" value={p.name} onInput={(e) => on({ ...p, name: (e.target as HTMLInputElement).value })} aria-label="Tên persona" /> : <b class="grow">{p.name}</b>}{edit && <Btn xs kind="ghost" icon="trash" title="Xoá persona" onClick={onDel} />}</div>
      {f('age', 'Tuổi')}{f('job', 'Nghề')}{f('goals', 'Mong muốn')}{f('pains', 'Nỗi đau')}{f('channels', 'Kênh')}
    </div>
  );
}
function Swatch({ c, edit, on, onDel }: { c: PaletteColor; edit: boolean; on: (c: PaletteColor) => void; onDel: () => void }) {
  const copy = () => { void navigator.clipboard?.writeText(c.hex).then(() => toast(`Đã copy ${c.hex}`, 'ok')); };
  return (
    <div class="bb-sw">
      <div class="bb-sw-c" style={{ background: c.hex }} onClick={edit ? undefined : copy} title={edit ? undefined : 'Bấm để copy mã màu'}>{edit && <input type="color" value={c.hex} onInput={(e) => on({ ...c, hex: (e.target as HTMLInputElement).value.toUpperCase() })} aria-label={`Màu ${c.name}`} />}</div>
      {edit ? <>
        <input class="in" value={c.name} onInput={(e) => on({ ...c, name: (e.target as HTMLInputElement).value })} aria-label="Tên màu" />
        <div class="row"><select class="in" value={c.role} onChange={(e) => on({ ...c, role: (e.target as HTMLSelectElement).value as PaletteColor['role'] })} aria-label="Vai trò màu"><option value="primary">Chính</option><option value="accent">Nhấn</option><option value="neutral">Trung tính</option></select><input class="in" style={{ width: 56 }} type="number" min={0} max={100} value={c.ratio} onInput={(e) => on({ ...c, ratio: Number((e.target as HTMLInputElement).value) })} aria-label="Tỉ lệ %" /><Btn xs kind="ghost" icon="trash" title="Xoá màu" onClick={onDel} /></div>
      </> : <><b>{c.name}</b><span class="mono">{c.hex} · {c.role === 'primary' ? 'Chính' : c.role === 'accent' ? 'Nhấn' : 'Trung tính'} · {c.ratio}%</span></>}
    </div>
  );
}

export function NoBrandHint({ client }: { client: Client }) {
  return <Empty icon="palette" title="Chưa có thương hiệu">Lên brand book trước để AI viết đúng giọng của {client.name}.</Empty>;
}
