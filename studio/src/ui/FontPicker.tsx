// Canva-style font picker: Phloem's curated fonts plus every Google Font that draws Vietnamese (~500), searchable, filtered
// by kind, each name previewed in its own face (only the glyphs of the name are fetched until the font is picked).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { FONTS } from '../model/types';
import { ensureFont, loadFontCatalog, previewFont, type GFont } from '../render/fonts';
import { Icon } from './icons';

type Kind = 'all' | 'sans' | 'serif' | 'display' | 'script' | 'mono';
const KINDS: { v: Kind; label: string }[] = [{ v: 'all', label: 'Tất cả' }, { v: 'display', label: 'Tiêu đề' }, { v: 'sans', label: 'Không chân' }, { v: 'serif', label: 'Có chân' }, { v: 'script', label: 'Viết tay' }, { v: 'mono', label: 'Mono' }];
const CUR_KIND: Record<string, Kind> = { sans: 'sans', display: 'display', serif: 'serif', rounded: 'sans', script: 'script', mono: 'mono', system: 'sans' };

export function FontPicker({ value, onChange, extra = [] }: { value: string; onChange: (family: string) => void; extra?: { v: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [cat, setCat] = useState<GFont[]>([]);
  const [n, setN] = useState(60);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && !cat.length) void loadFontCatalog().then(setCat); }, [open]);
  useEffect(() => { if (!open) return; const h = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }; window.addEventListener('mousedown', h); return () => window.removeEventListener('mousedown', h); }, [open]);
  useEffect(() => setN(60), [q, kind]);
  const all = useMemo(() => {
    const curated = FONTS.filter((f) => f.vi).map((f) => ({ f: f.family, c: CUR_KIND[f.cat] || 'sans', star: true }));
    const seen = new Set(curated.map((x) => x.f));
    return [...curated, ...cat.filter((g) => !seen.has(g.f)).map((g) => ({ f: g.f, c: g.c, star: false }))];
  }, [cat]);
  const list = all.filter((x) => (kind === 'all' || x.c === kind) && (!q.trim() || x.f.toLowerCase().includes(q.trim().toLowerCase())));
  const label = extra.find((e) => e.v === value)?.label || value;
  return (
    <div class="fontpick" ref={box}>
      <button class="fp-btn" onClick={() => setOpen(!open)} style={{ fontFamily: extra.some((e) => e.v === value) ? undefined : `'${value}'` }} title="Chọn font (hơn 500 font có tiếng Việt)">
        <span class="grow">{label}</span><Icon name="chevron" size={12} />
      </button>
      {open && (
        <div class="fp-pop" onKeyDown={(e) => e.stopPropagation()}>
          <input class="in" autoFocus placeholder={`Tìm trong ${all.length} font có tiếng Việt…`} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <div class="fp-kinds">{KINDS.map((k) => <button key={k.v} class={`chip ${kind === k.v ? 'on' : ''}`} onClick={() => setKind(k.v)}>{k.label}</button>)}</div>
          <div class="fp-list" onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 200 && n < list.length) setN(n + 60); }}>
            {!q && kind === 'all' && extra.map((e) => <button key={e.v} class={`fp-item ${value === e.v ? 'on' : ''}`} onClick={() => { onChange(e.v); setOpen(false); }}><span>{e.label}</span><em>thương hiệu</em></button>)}
            {list.slice(0, n).map((x) => <FontRow key={x.f} family={x.f} star={x.star} on={value === x.f} pick={() => { ensureFont(x.f); onChange(x.f); setOpen(false); }} />)}
            {!list.length && <div class="dim small" style={{ padding: 10 }}>{cat.length ? 'Không có font nào khớp.' : 'Đang tải danh sách font…'}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function FontRow({ family, star, on, pick }: { family: string; star: boolean; on: boolean; pick: () => void }) {
  const el = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const b = el.current; if (!b) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { previewFont(family); io.disconnect(); } });
    io.observe(b); return () => io.disconnect();
  }, [family]);
  return <button ref={el} class={`fp-item ${on ? 'on' : ''}`} onClick={pick} style={{ fontFamily: `'${family}', system-ui` }}><span>{family}</span>{star && <em>★</em>}</button>;
}
