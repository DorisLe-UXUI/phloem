// Left panel → "Thiết kế": a Canva-style element library. Click to drop at the centre of the view, or drag onto the email.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { get, toast, useStore } from '../store';
import * as A from '../pipeline/actions';
import { assets } from '../storage/assets';
import { ANIM_PRESETS, ELEMENTS, ICONS, ICON_STYLES, STICKERS, colorChoices, iconLayer, type ElCat } from '../design/elements';
import { ICON_SETS, iconUrl, searchIcons } from '../design/vector';
import { relayAuth } from '../ai/client';
import { Btn, Eyebrow } from './components';
import { Icon } from './icons';

type Cat = 'all' | 'shape' | 'graphic' | 'icon' | 'sticker' | 'text' | 'photo' | 'anim';
const CATS: { v: Cat; label: string }[] = [
  { v: 'all', label: 'Tất cả' }, { v: 'shape', label: 'Hình khối' }, { v: 'graphic', label: 'Đồ hoạ' }, { v: 'sticker', label: 'Sticker 3D' },
  { v: 'icon', label: 'Icon' }, { v: 'text', label: 'Chữ' }, { v: 'photo', label: 'Ảnh' }, { v: 'anim', label: 'Hoạt ảnh' },
];

/** What a tile inserts; also the drag payload (text/phloem-el). */
export type Spec = { kind: 'el'; id: string; color?: string } | { kind: 'icon'; id: string; color?: string } | { kind: 'sticker'; id: string } | { kind: 'photo'; photo: Photo };
interface Photo { id: string; title: string; url: string; thumb: string; creator: string; license: string; page: string; w: number; h: number }

let lastColor = '';
/** Drop/insert one library item at `at` (doc coords) or the view centre. Used by tiles and by canvas drops. */
export async function insertSpec(spec: Spec, at?: { x: number; y: number }) {
  const p = get().project; if (!p) return;
  const d = A.doc();
  const pt = at ?? A.viewCenter();
  const color = ('color' in spec && spec.color) || lastColor || p.brand.primary;
  try {
    if (spec.kind === 'el') {
      const def = ELEMENTS.find((e) => e.id === spec.id); if (!def) return;
      A.insertLayers(await def.make({ brand: p.brand, color, at: pt, docW: d.width }));
    } else if (spec.kind === 'icon') A.insertLayers([await iconLayer(spec.id, pt, 64, color)]);
    else if (spec.kind === 'sticker') A.insertLayers([await iconLayer(`fluent-emoji:${spec.id}`, pt, 110, null)]);
    else if (spec.kind === 'photo') {
      toast('Đang tải ảnh…', 'info');
      const blob = await fetchPhoto(spec.photo);
      const a = await assets.add(blob, spec.photo.title || 'Ảnh', { src: { kind: 'stock', url: spec.photo.page, credit: `${spec.photo.title || 'Ảnh'} · ${spec.photo.creator || 'không rõ tác giả'} · ${spec.photo.license}` } });
      A.placeAsset(a.id, pt);
      if (/by/i.test(spec.photo.license)) toast(`Ảnh giấy phép ${spec.photo.license.toUpperCase()}: nên ghi nguồn "${spec.photo.creator}" ở footer.`, 'info');
    }
  } catch (e) { toast(`Không chèn được: ${(e as Error).message}`, 'err'); }
}

async function fetchPhoto(ph: Photo): Promise<Blob> {
  const relay = (get().settings.relayUrl || '').replace(/\/$/, '');
  const tries: (() => Promise<Response>)[] = [];
  if (relay) tries.push(() => fetch(`${relay}/image?url=${encodeURIComponent(ph.url)}`, { headers: relayAuth() }));
  tries.push(() => fetch(ph.url, { mode: 'cors' }));
  tries.push(() => fetch(ph.thumb, { mode: 'cors' }));
  for (const t of tries) { try { const r = await t(); if (r.ok) { const b = await r.blob(); if (b.type.startsWith('image/') && b.size > 2000) return b; } } catch { /* next */ } }
  throw new Error('nguồn ảnh không cho tải (thử ảnh khác)');
}

async function searchPhotos(q: string, page = 1): Promise<Photo[]> {
  const r = await fetch(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=20&page=${page}&license_type=commercial,modification&mature=false`);
  if (!r.ok) throw new Error(`Openverse HTTP ${r.status}`);
  const j = (await r.json()) as { results?: { id: string; title?: string; url: string; thumbnail?: string; creator?: string; license: string; license_version?: string; foreign_landing_url?: string; width?: number; height?: number }[] };
  return (j.results || []).map((x) => ({ id: x.id, title: x.title || '', url: x.url, thumb: x.thumbnail || `https://api.openverse.org/v1/images/${x.id}/thumb/`, creator: x.creator || '', license: `${x.license} ${x.license_version || ''}`.trim(), page: x.foreign_landing_url || '', w: x.width || 0, h: x.height || 0 }));
}

/** Openverse searches English best: Vietnamese topic chips map to English queries. */
const PHOTO_TOPICS: { label: string; q: string }[] = [
  { label: 'Phong cách sống', q: 'lifestyle' }, { label: 'Cà phê', q: 'coffee' }, { label: 'Đồ ăn', q: 'food' }, { label: 'Thời trang', q: 'fashion' },
  { label: 'Mỹ phẩm', q: 'cosmetics' }, { label: 'Nội thất', q: 'interior' }, { label: 'Thiên nhiên', q: 'nature landscape' }, { label: 'Du lịch', q: 'travel' },
  { label: 'Văn phòng', q: 'office work' }, { label: 'Công nghệ', q: 'technology' }, { label: 'Thể thao', q: 'sport fitness' }, { label: 'Lễ hội', q: 'celebration party' },
  { label: 'Gốm', q: 'ceramic pottery' }, { label: 'Hoa', q: 'flowers' }, { label: 'Thú cưng', q: 'pet dog cat' }, { label: 'Kết cấu', q: 'texture background' },
];

const drag = (spec: Spec) => (e: DragEvent) => { e.dataTransfer?.setData('text/phloem-el', JSON.stringify(spec)); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; };

export function DesignPanel() {
  const s = useStore();
  const b = s.project?.brand;
  const [cat, setCat] = useState<Cat>('all');
  const [color, setColor0] = useState<string>(() => lastColor || b?.primary || '#111111');
  const setColor = (c: string) => { lastColor = c; setColor0(c); };
  const [q, setQ] = useState('');
  const [style, setStyle] = useState<string>('-duotone');
  const [found, setFound] = useState<{ icons: string[]; stickers: string[] }>({ icons: [], stickers: [] });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoQ, setPhotoQ] = useState('');
  const [loading, setLoading] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const tm = useRef<number | undefined>(undefined);
  const choices = useMemo(() => (b ? colorChoices(b) : []), [b?.primary, b?.accent, b?.ink, b?.muted, b?.soft]);

  // search icons + stickers as you type (debounced); photos on Enter
  useEffect(() => {
    clearTimeout(tm.current);
    if (!q.trim() || cat === 'photo') { setFound({ icons: [], stickers: [] }); return; }
    tm.current = window.setTimeout(async () => {
      setLoading('Đang tìm…');
      try {
        const [icons, stickers] = await Promise.all([searchIcons(q, ICON_SETS, 96).catch(() => []), searchIcons(q, ['fluent-emoji'], 48).catch(() => [])]);
        setFound({ icons: icons.filter((x) => !/-(thin|light)$/.test(x)), stickers: stickers.filter((x) => !/-(light|medium|dark|medium-light|medium-dark)$/.test(x)) });
      } finally { setLoading(''); }
    }, 350);
    return () => clearTimeout(tm.current);
  }, [q, cat]);
  const runPhotos = async (term: string) => {
    const t = term.trim() || 'lifestyle'; setPhotoQ(t); setLoading('Đang tìm ảnh…');
    try { setPhotos(await searchPhotos(t)); } catch (e) { toast((e as Error).message, 'err'); } finally { setLoading(''); }
  };
  useEffect(() => { if (cat === 'photo' && !photos.length) void runPhotos(q || 'lifestyle'); }, [cat]);

  const put = async (spec: Spec, label: string) => { setBusy(label); try { await insertSpec(spec.kind === 'el' || spec.kind === 'icon' ? { ...spec, color } : spec); } finally { setBusy(null); } };
  const els = (c: ElCat | ElCat[], max?: number) => ELEMENTS.filter((e) => (Array.isArray(c) ? c.includes(e.cat) : e.cat === c)).slice(0, max);
  const tile = (e: (typeof ELEMENTS)[number]) => (
    <button key={e.id} class={`el-tile ${busy === e.id ? 'busy' : ''}`} title={`${e.label} · bấm để chèn, hoặc kéo vào email`} draggable onDragStart={drag({ kind: 'el', id: e.id, color })} onClick={() => void put({ kind: 'el', id: e.id }, e.id)}>
      {e.cat === 'text' ? <span class={`el-text t-${e.id}`} style={{ color: e.id === 't-body' ? undefined : color }}>{e.label}</span> : <span class="el-svg" style={{ color }} dangerouslySetInnerHTML={{ __html: e.preview }} />}
      {e.cat !== 'text' && <span class="el-lb">{e.label}</span>}
    </button>
  );
  const iconTile = (id: string) => (
    <button key={id} class="ic-tile" title={`${id} · bấm để chèn`} draggable onDragStart={drag({ kind: 'icon', id, color })} onClick={() => void put({ kind: 'icon', id }, id)}>
      <img src={iconUrl(id, color)} alt="" loading="lazy" />
    </button>
  );
  const stickerTile = (name: string) => (
    <button key={name} class="ic-tile st" title={`${name} · sticker 3D`} draggable onDragStart={drag({ kind: 'sticker', id: name })} onClick={() => void put({ kind: 'sticker', id: name }, name)}>
      <img src={iconUrl(`fluent-emoji:${name}`)} alt="" loading="lazy" />
    </button>
  );
  const head = (label: string, to: Cat) => <Eyebrow action={cat === 'all' ? { label: 'Xem tất cả', onClick: () => setCat(to) } : undefined}>{label}</Eyebrow>;
  const sel = s.selection.length;

  if (!s.project) return null;
  return (
    <div class="section design-panel">
      <div class="dp-search">
        <Icon name="search" size={13} />
        <input value={q} placeholder={cat === 'photo' ? 'Tìm ảnh miễn phí (Enter)…' : 'Tìm icon, sticker… (vd: quà, cà phê, sale)'} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && cat === 'photo') void runPhotos(q); }} />
        {q && <button class="x" onClick={() => setQ('')}>×</button>}
      </div>
      <div class="dp-cats">{CATS.map((c) => <button key={c.v} class={`chip ${cat === c.v ? 'on' : ''}`} onClick={() => setCat(c.v)}>{c.label}</button>)}</div>
      {cat !== 'photo' && cat !== 'anim' && (
        <div class="dp-colors" title="Màu cho hình, icon, chữ mới chèn">
          {choices.map((c) => <button key={c.c} class={`sw ${color.toUpperCase() === c.c.toUpperCase() ? 'on' : ''}`} style={{ background: c.c }} title={c.label} onClick={() => setColor(c.c)} />)}
          <label class="sw pick" title="Chọn màu khác"><input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'} onInput={(e) => setColor((e.target as HTMLInputElement).value.toUpperCase())} /></label>
        </div>
      )}
      {loading && <div class="dim small">{loading}</div>}

      {q.trim() && cat !== 'photo' && cat !== 'anim' ? (
        <>
          {found.stickers.length > 0 && <><Eyebrow>Sticker 3D · {found.stickers.length}</Eyebrow><div class="ic-grid">{found.stickers.map((id) => stickerTile(id.split(':')[1]))}</div></>}
          {found.icons.length > 0 && <><Eyebrow>Icon · {found.icons.length}</Eyebrow><div class="ic-grid">{found.icons.map(iconTile)}</div></>}
          {!loading && !found.icons.length && !found.stickers.length && <div class="dim small">Không thấy "{q}". Thử từ tiếng Anh (gift, coffee, star…).</div>}
        </>
      ) : (
        <>
          {(cat === 'all' || cat === 'shape') && <>{head('Hình khối', 'shape')}<div class="el-grid">{els(['shape', 'svg'], cat === 'all' ? 8 : undefined).map(tile)}</div></>}
          {(cat === 'all' || cat === 'graphic') && <>{head('Đồ hoạ dựng sẵn', 'graphic')}<div class="el-grid">{els('graphic', cat === 'all' ? 8 : undefined).map(tile)}</div></>}
          {(cat === 'all' || cat === 'sticker') && <>{head('Sticker 3D', 'sticker')}<div class="ic-grid">{(cat === 'all' ? STICKERS.slice(0, 16) : STICKERS).map(stickerTile)}</div></>}
          {(cat === 'all' || cat === 'icon') && (
            <>
              {head('Icon', 'icon')}
              {cat === 'icon' && <div class="dp-cats">{ICON_STYLES.map((st) => <button key={st.v} class={`chip ${style === st.v ? 'on' : ''}`} onClick={() => setStyle(st.v)}>{st.label}</button>)}</div>}
              <div class="ic-grid">{(cat === 'all' ? ICONS.slice(0, 16) : ICONS).map((n) => iconTile(`ph:${n}${style}`))}</div>
            </>
          )}
          {(cat === 'all' || cat === 'text') && <>{head('Chữ', 'text')}<div class="el-grid text">{els('text', cat === 'all' ? 4 : undefined).map(tile)}</div></>}
          {cat === 'photo' && (
            <>
              <div class="dp-cats">{PHOTO_TOPICS.map((t) => <button key={t.q} class={`chip ${photoQ === t.q ? 'on' : ''}`} onClick={() => { setQ(''); void runPhotos(t.q); }}>{t.label}</button>)}</div>
              <Eyebrow>Ảnh miễn phí{photoQ ? ` · "${photoQ}"` : ''}</Eyebrow>
              {!loading && photoQ && !photos.length && <div class="dim small">Không có ảnh cho "{photoQ}". Thử từ tiếng Anh, ví dụ coffee, sneaker, beach.</div>}
              <div class="photo-grid">
                {photos.map((ph) => (
                  <button key={ph.id} class="ph-tile" title={`${ph.title} · ${ph.creator} · ${ph.license}`} draggable onDragStart={drag({ kind: 'photo', photo: ph })} onClick={() => void put({ kind: 'photo', photo: ph }, ph.id)}>
                    <img src={ph.thumb} alt="" loading="lazy" referrerpolicy="no-referrer" />
                    <span class="lic">{ph.license.toUpperCase()}</span>
                  </button>
                ))}
              </div>
              <div class="dim small">Ảnh từ Openverse, giấy phép cho phép dùng thương mại. Ảnh CC BY cần ghi tên tác giả (Phloem lưu nguồn trong tên ảnh).</div>
            </>
          )}
          {(cat === 'all' || cat === 'anim') && (
            <>
              {head('Hoạt ảnh', 'anim')}
              <div class="dim small">{sel ? `Áp cho ${sel} layer đang chọn. Xuất ra GIF động.` : 'Chọn một layer trên email rồi bấm hiệu ứng.'}</div>
              <div class="anim-grid">
                {ANIM_PRESETS.map((a) => (
                  <button key={a.kind} class={`anim-tile ${!sel ? 'off' : ''}`} disabled={!sel} onClick={() => { const n = A.animateSelection(a.kind); toast(n ? (a.kind === 'none' ? `Đã bỏ hoạt ảnh của ${n} layer.` : `${a.label} cho ${n} layer. Bấm ▶ để xem.`) : 'Hiệu ứng này chỉ dành cho chữ.', n ? 'ok' : 'info'); }}>
                    <span class={`demo k-${a.kind}`}><i /></span>
                    <span class="el-lb">{a.label}{a.loop ? ' ∞' : ''}</span>
                  </button>
                ))}
              </div>
              {cat === 'anim' && <Btn sm icon="sparkle" onClick={() => { const ch = A.animateDoc(); toast(ch.length ? `Đã làm động: ${ch.slice(0, 3).join(', ')}` : 'Không có gì để làm động.', 'ok'); }}>Tự làm động cả email</Btn>}
            </>
          )}
        </>
      )}
    </div>
  );
}
