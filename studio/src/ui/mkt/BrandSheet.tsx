// The brand book as a premium brand-guideline document, dressed in the brand's own colours and fonts: cover, essence,
// audience, voice, messaging, logo (on light / brand / dark, clear space), colour (big swatches, HEX/RGB, contrast),
// typography (specimen + scale), imagery (moodboard from the client's real pictures), applications (post, story, card).
import { useMemo } from 'preact/hooks';
import type { JSX } from 'preact';
import { assets } from '../../storage/assets';
import { bookTheme, contrast, grade, rgbText } from '../../mkt/brandTheme';
import { clientImages } from '../../mkt/designs';
import { toast } from '../../store';
import type { BrandBook, Client } from '../../mkt/types';
import type { BBLabels } from './BrandTab';

const PHOTO_RANK: Record<string, number> = { reference: 0, upload: 1, paste: 1, web: 2, ai: 3 };
const RANK = (k?: string) => PHOTO_RANK[k || ''] ?? 4;
const EN: Record<string, string> = {
  guide: 'Brand guidelines', contents: 'Contents', essence: 'Brand essence', applications: 'Applications', clearSpace: 'Clear space', onBrand: 'On brand colour',
  proportion: 'Colour proportion', usage: 'Usage', scale: 'Type scale', display: 'Display', h1: 'Heading 1', h2: 'Heading 2', bodyT: 'Body', caption: 'Caption',
  moodboard: 'Moodboard', post: 'Social post', story: 'Story', card: 'Business card', buttons: 'Buttons', kit: 'Hashtags & CTAs', primaryBtn: 'Primary', secondaryBtn: 'Secondary', learnMore: 'Learn more',
  voiceIs: 'We sound', why: 'Why us', vs: 'vs.', noImages: 'Add pictures to the client library (website, Drive, uploads) to fill this moodboard.',
};
const VI: Record<string, string> = {
  guide: 'Cẩm nang thương hiệu', contents: 'Mục lục', essence: 'Cốt lõi thương hiệu', applications: 'Ứng dụng', clearSpace: 'Vùng an toàn', onBrand: 'Trên màu thương hiệu',
  proportion: 'Tỉ lệ màu', usage: 'Cách dùng', scale: 'Thang chữ', display: 'Tiêu đề lớn', h1: 'Tiêu đề 1', h2: 'Tiêu đề 2', bodyT: 'Nội dung', caption: 'Chú thích',
  moodboard: 'Moodboard', post: 'Bài đăng', story: 'Story', card: 'Danh thiếp', buttons: 'Nút', kit: 'Hashtag & CTA', primaryBtn: 'Chính', secondaryBtn: 'Phụ', learnMore: 'Xem thêm',
  voiceIs: 'Giọng của chúng tôi', why: 'Vì sao chọn chúng tôi', vs: 'so với', noImages: 'Thêm ảnh vào kho của khách (website, Drive, tải lên) để có moodboard.',
};

export function BrandSheet({ client, book, L, logoUrl }: { client: Client; book: BrandBook; L: BBLabels; logoUrl?: string }) {
  const T = !client.language || client.language === 'vi' ? VI : EN;
  const th = useMemo(() => bookTheme(book), [book]);
  const logo = logoUrl || client.logo || '';
  const light = book.logo.light ? assets.url(book.logo.light) : '';
  const photos = useMemo(() => clientImages(client.id).filter((a) => a.src?.kind !== 'logo' && a.id !== book.logo.main && a.id !== book.logo.light && Math.min(a.w, a.h) >= 300).sort((a, b) => RANK(a.src?.kind) - RANK(b.src?.kind)).slice(0, 7), [client.id, book]);
  const hero = photos[0] ? assets.url(photos[0].id) : '';
  const headline = book.messages[0] || book.tagline || client.name;
  const cta = book.kit.ctas[0] || T.learnMore;
  const site = (client.website || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const date = new Date().toLocaleDateString(T === VI ? 'vi-VN' : 'en-US', { month: 'long', year: 'numeric' });
  const vars = {
    '--p': th.primary, '--a': th.accent, '--ink': th.ink, '--paper': th.paper, '--onp': th.onPrimary, '--ona': th.onAccent, '--tint': th.tint, '--tinta': th.tintAccent, '--muted': th.muted, '--line': th.line,
    '--hf': `'${book.fonts.heading}', 'Be Vietnam Pro', sans-serif`, '--bf': `'${book.fonts.body}', 'Inter', sans-serif`,
  } as JSX.CSSProperties;
  const LogoImg = ({ src, alt }: { src: string; alt: string }) => (src ? <img src={src} alt={alt} /> : <span class="bs-wordmark">{client.name}</span>);
  const sections = [L.s1, L.s2, L.s3, L.s4, L.s5, L.s6, L.s7, L.s8, T.applications];
  const copy = (hex: string) => { void navigator.clipboard?.writeText(hex).then(() => toast(`Đã copy ${hex}`, 'ok')); };

  return (
    <article class="bs" style={vars}>
      {/* ---------- cover ---------- */}
      <header class="bs-cover">
        <div class="bs-cover-glow" />
        {hero && <div class="bs-cover-photo" style={{ backgroundImage: `url(${hero})` }} />}
        <div class="bs-cover-in">
          <div class="bs-cover-logo">{light ? <img class="naked" src={light} alt={client.name} /> : <span class="card"><LogoImg src={logo} alt={client.name} /></span>}</div>
          <span class="bs-kicker">{T.guide} · v{book.version} · {date}</span>
          <h1>{client.name}</h1>
          {book.tagline && <p class="bs-tag">{book.tagline}</p>}
          <div class="bs-cover-chips">{book.palette.slice(0, 6).map((c) => <i key={c.hex} style={{ background: c.hex }} title={c.hex} />)}</div>
        </div>
        <ol class="bs-toc"><span>{T.contents}</span>{sections.map((x, i) => <li key={x}><b>{String(i + 1).padStart(2, '0')}</b>{x}</li>)}</ol>
      </header>

      {/* ---------- 01 essence ---------- */}
      <Section n={1} title={L.s1} tone="paper">
        {book.tagline && <blockquote class="bs-quote">“{book.tagline}”</blockquote>}
        <div class="bs-2">
          <div class="bs-statement"><span class="bs-label">{L.mission}</span><p>{book.mission}</p></div>
          <div class="bs-statement alt"><span class="bs-label">{L.vision}</span><p>{book.vision}</p></div>
        </div>
        <span class="bs-label">{L.values}</span>
        <div class="bs-values">{book.values.map((v, i) => { const [h, ...rest] = v.split(/:\s+/); return <div key={i} class="bs-value"><b>{String(i + 1).padStart(2, '0')}</b><h4>{rest.length ? h : v}</h4>{rest.length ? <p>{rest.join(': ')}</p> : null}</div>; })}</div>
      </Section>

      {/* ---------- 02 audience ---------- */}
      <Section n={2} title={L.s2} tone="tint">
        <div class="bs-personas">
          {book.personas.map((p, i) => (
            <div key={i} class="bs-persona">
              <div class="bs-persona-h"><span class="av">{p.name.trim().slice(0, 1).toUpperCase()}</span><div><h4>{p.name}</h4><span>{[p.age, p.job].filter(Boolean).join(' · ')}</span></div></div>
              {p.goals && <div class="row2"><span class="bs-label">{L.goals}</span><p>{p.goals}</p></div>}
              {p.pains && <div class="row2"><span class="bs-label">{L.pains}</span><p>{p.pains}</p></div>}
              {p.channels && <div class="bs-tags">{p.channels.split(/[,;]\s*/).filter(Boolean).slice(0, 6).map((c) => <span key={c}>{c.replace(/\(.*?\)/g, '').trim()}</span>)}</div>}
            </div>
          ))}
        </div>
      </Section>

      {/* ---------- 03 voice ---------- */}
      <Section n={3} title={L.s3} tone="ink">
        <span class="bs-label">{T.voiceIs}</span>
        <div class="bs-traits">{book.voice.traits.map((t) => <span key={t}>{t}</span>)}</div>
        <div class="bs-2">
          <div class="bs-dodont do"><h4>✓ {L.do}</h4><ul>{book.voice.do.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div class="bs-dodont dont"><h4>✕ {L.dont}</h4><ul>{book.voice.dont.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        </div>
      </Section>

      {/* ---------- 04 messaging ---------- */}
      <Section n={4} title={L.s4} tone="paper">
        <div class="bs-messages">{book.messages.map((m, i) => <p key={i} class={i === 0 ? 'lead' : ''}>{m}</p>)}</div>
        <span class="bs-label">{T.why}</span>
        <div class="bs-usp">{book.usp.map((u, i) => <div key={i}><b>{String(i + 1).padStart(2, '0')}</b><p>{u}</p></div>)}</div>
        {book.competitors.length > 0 && <>
          <span class="bs-label">{L.competitors}</span>
          <div class="bs-comp">{book.competitors.map((c, i) => <div key={i}><b>{c.name}</b><p>{c.note}</p></div>)}</div>
        </>}
      </Section>

      {/* ---------- 05 logo ---------- */}
      <Section n={5} title={L.s5} tone="tint">
        <div class="bs-logos">
          <figure class="bs-logo on-paper"><div class="clear"><LogoImg src={logo} alt={L.light} /></div><figcaption>{L.light}</figcaption></figure>
          <figure class="bs-logo on-brand"><div><LogoImg src={light || logo} alt={T.onBrand} /></div><figcaption>{T.onBrand}</figcaption></figure>
          <figure class="bs-logo on-ink"><div><LogoImg src={light || logo} alt={L.dark} /></div><figcaption>{L.dark}</figcaption></figure>
        </div>
        <div class="bs-2 tight">
          <div class="bs-clearspace"><div class="box"><LogoImg src={logo} alt="" /></div><span>{T.clearSpace}</span></div>
          <ul class="bs-rules">{book.logo.rules.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      </Section>

      {/* ---------- 06 colour ---------- */}
      <Section n={6} title={L.s6} tone="paper">
        <div class="bs-palette">
          {book.palette.map((c, i) => {
            const onW = contrast('#FFFFFF', c.hex), onI = contrast(th.ink, c.hex);
            const text = onW >= onI ? '#FFFFFF' : th.ink;
            return (
              <button key={i} class={`bs-swatch ${c.role}`} style={{ background: c.hex, color: text }} onClick={() => copy(c.hex)} title="Bấm để copy mã màu">
                <span class="top"><span class="role">{c.role === 'primary' ? L.primary : c.role === 'accent' ? L.accent : L.neutral} · {c.ratio}%</span><span class="aa"><em>Aa</em> {grade(Math.max(onW, onI))}</span></span>
                <b>{c.name}</b>
                <span class="codes">{c.hex}<br />RGB {rgbText(c.hex)}</span>
              </button>
            );
          })}
        </div>
        <span class="bs-label">{T.proportion}</span>
        <div class="bs-proportion">{book.palette.map((c) => <i key={c.hex} style={{ background: c.hex, flex: Math.max(2, c.ratio) }}><span style={{ color: contrast('#FFFFFF', c.hex) >= 3 ? '#fff' : th.ink }}>{c.ratio}%</span></i>)}</div>
      </Section>

      {/* ---------- 07 typography ---------- */}
      <Section n={7} title={L.s7} tone="ink">
        <div class="bs-type">
          <div class="bs-specimen"><span class="aa h">Aa</span><b>{book.fonts.heading}</b><span class="bs-label">{L.heading}</span><span class="glyphs h">ABCDEFGHIJKLM<br />abcdefghijklm 0123456789<br />ă â đ ê ô ơ ư · ạ ậ ể ữ ỹ</span></div>
          <div class="bs-specimen"><span class="aa b">Aa</span><b>{book.fonts.body}</b><span class="bs-label">{L.body}</span><span class="glyphs b">ABCDEFGHIJKLM<br />abcdefghijklm 0123456789<br />ă â đ ê ô ơ ư · ạ ậ ể ữ ỹ</span></div>
        </div>
        <span class="bs-label">{T.scale}</span>
        <div class="bs-scale">
          <div><span>{T.display} · 64</span><p class="h" style={{ fontSize: 'clamp(34px, 5vw, 64px)' }}>{book.tagline || client.name}</p></div>
          <div><span>{T.h1} · 40</span><p class="h" style={{ fontSize: 'clamp(26px, 3.4vw, 40px)' }}>{headline}</p></div>
          <div><span>{T.h2} · 28</span><p class="h" style={{ fontSize: 'clamp(20px, 2.4vw, 28px)' }}>{book.usp[0] || headline}</p></div>
          <div><span>{T.bodyT} · 16</span><p class="b" style={{ fontSize: 16 }}>{book.mission}</p></div>
          <div><span>{T.caption} · 12</span><p class="b" style={{ fontSize: 12, letterSpacing: 0.4 }}>{book.kit.hashtags.slice(0, 4).join('  ')}</p></div>
        </div>
        {book.fonts.note && <p class="bs-note">{book.fonts.note}</p>}
      </Section>

      {/* ---------- 08 imagery ---------- */}
      <Section n={8} title={L.s8} tone="paper">
        {photos.length ? <div class={`bs-mood n${Math.min(photos.length, 7)}`}>{photos.map((a) => <div key={a.id} style={{ backgroundImage: `url(${assets.url(a.id)})` }} />)}</div> : <p class="bs-note">{T.noImages}</p>}
        <div class="bs-2">
          <div><span class="bs-label">{L.imagery}</span><ul class="bs-list">{book.imagery.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div><span class="bs-label">{L.layout}</span><ul class="bs-list">{book.layout.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        </div>
        <div class="bs-2">
          <div class="bs-dodont do light"><h4>✓ {L.exDo}</h4><ul>{book.examples.do.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
          <div class="bs-dodont dont light"><h4>✕ {L.exDont}</h4><ul>{book.examples.dont.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        </div>
      </Section>

      {/* ---------- 09 applications ---------- */}
      <Section n={9} title={T.applications} tone="tint">
        <div class="bs-apps">
          <figure class="bs-app">
            <div class="bs-post">
              <div class="img" style={hero ? { backgroundImage: `url(${hero})` } : undefined} />
              <div class="body"><span class="logo"><LogoImg src={light || logo} alt="" /></span><h5>{headline}</h5><span class="btn">{cta} →</span></div>
            </div>
            <figcaption>{T.post} · 1080×1350</figcaption>
          </figure>
          <figure class="bs-app">
            <div class="bs-story" style={hero ? { backgroundImage: `url(${photos[1] ? assets.url(photos[1].id) : hero})` } : undefined}>
              <span class="logo"><LogoImg src={light || logo} alt="" /></span>
              <div class="body"><h5>{book.tagline || headline}</h5><span class="btn">{cta}</span></div>
            </div>
            <figcaption>{T.story} · 1080×1920</figcaption>
          </figure>
          <figure class="bs-app">
            <div class="bs-cards">
              <div class="bs-card front"><span class="logo"><LogoImg src={logo} alt="" /></span><span class="site">{site}</span></div>
              <div class="bs-card back"><span class="logo"><LogoImg src={light || logo} alt="" /></span><span>{book.tagline}</span></div>
            </div>
            <figcaption>{T.card}</figcaption>
          </figure>
        </div>
        <div class="bs-2 tight">
          <div><span class="bs-label">{T.buttons}</span><div class="bs-buttons"><span class="btn p">{cta}</span><span class="btn a">{book.kit.ctas[1] || T.learnMore}</span><span class="btn o">{book.kit.ctas[2] || T.learnMore}</span></div></div>
          <div><span class="bs-label">{T.kit}</span><div class="bs-tags big">{book.kit.hashtags.map((h) => <span key={h}>{h}</span>)}</div></div>
        </div>
      </Section>
      <footer class="bs-foot"><span>{client.name} · {T.guide}</span><span>v{book.version} · {date}</span></footer>
    </article>
  );
}

function Section({ n, title, tone, children }: { n: number; title: string; tone: 'paper' | 'tint' | 'ink'; children: preact.ComponentChildren }) {
  return (
    <section class={`bs-sec ${tone}`}>
      <div class="bs-sec-h"><span class="bs-num">{String(n).padStart(2, "0")}</span><h2>{title}</h2></div>
      {children}
    </section>
  );
}
