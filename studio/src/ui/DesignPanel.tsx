// Left panel → "Thiết kế": a Canva-style element library (thousands of pieces). Click to drop at the centre of the view,
// or drag onto the email. Libraries: native shapes, SVG shapes, ready-made graphics, procedural backgrounds/patterns/
// 3D shapes (endless: generator × palette × variant), Fluent 3D objects (~1,600 renders), colour stickers (Fluent,
// Noto, flat), icons (Iconify, 5 styles), brand logos, text styles, free photos (Openverse), motion presets.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { get, toast, useStore } from '../store';
import * as A from '../pipeline/actions';
import { assets } from '../storage/assets';
import type { ImageNode } from '../model/types';
import { uid } from '../model/types';
import { ANIM_PRESETS, ELEMENTS, ICONS, ICON_STYLES, colorChoices, iconLayer, type ElCat } from '../design/elements';
import { COLOR_SETS, ICON_BROWSE, ICON_SETS, iconCollection, iconTileSvg, searchIcons, vectorAsset } from '../design/vector';
import { GENERATORS, GEN_GROUPS, GEN_PALETTES, genSvg, svgDataUrl, type GenGroup } from '../design/generators';
import { CAT_VI, fluent3dLayer, fluent3dUrl, loadFluent3d, searchFluent3d, type Fluent3d } from '../design/library';
import { relayAuth } from '../ai/client';
import { PEOPLE_STYLES, peopleLayer, peopleSeeds, peopleUrl } from '../design/people';
import { Btn, Eyebrow } from './components';
import { Icon } from './icons';

type Cat = 'all' | 'shape' | 'graphic' | 'elem' | 'bg' | '3d' | 'people' | 'sticker' | 'icon' | 'logo' | 'text' | 'photo' | 'anim';
const CATS: { v: Cat; label: string }[] = [
  { v: 'all', label: 'Tất cả' }, { v: '3d', label: 'Vật thể 3D' }, { v: 'people', label: 'Người & nhân vật' }, { v: 'bg', label: 'Nền & hoạ tiết' }, { v: 'shape', label: 'Hình khối' }, { v: 'graphic', label: 'Đồ hoạ' }, { v: 'elem', label: 'Phần tử' },
  { v: 'sticker', label: 'Sticker' }, { v: 'icon', label: 'Icon' }, { v: 'logo', label: 'Logo' }, { v: 'text', label: 'Chữ' }, { v: 'photo', label: 'Ảnh' }, { v: 'anim', label: 'Hoạt ảnh' },
];
const STICKER_SETS = COLOR_SETS;
/** Generated pieces that are objects (drawn whole on a transparent tile), not full backgrounds or patterns. */
const OBJ = (g: GenGroup) => g !== 'bg' && g !== 'pattern';
const ELEM_GROUPS = GEN_GROUPS.filter((g) => ['ribbon', 'badge', 'bubble', 'line', 'frame', 'spark', 'deco'].includes(g.v));

/** What a tile inserts; also the drag payload (text/phloem-el). */
export type Spec =
  | { kind: 'el'; id: string; color?: string }
  | { kind: 'icon'; id: string; color?: string }
  | { kind: 'sticker'; id: string }
  | { kind: '3d'; id: string }
  | { kind: 'people'; style: string; seed: string }
  | { kind: 'gen'; id: string; seed: number; palette: string[] }
  | { kind: 'photo'; photo: Photo };
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
    else if (spec.kind === 'sticker') A.insertLayers([await iconLayer(spec.id.includes(':') ? spec.id : `fluent-emoji:${spec.id}`, pt, 110, null)]);
    else if (spec.kind === '3d') A.insertLayers([await fluent3dLayer(spec.id, pt, 128)]);
    else if (spec.kind === 'people') A.insertLayers([await peopleLayer(spec.style, spec.seed, pt, 180)]);
    else if (spec.kind === 'gen') {
      const g = GENERATORS.find((x) => x.id === spec.id); if (!g) return;
      const full = g.group === 'bg' || g.group === 'pattern';
      const w = full ? d.width : g.w, h = full ? Math.round(g.h * (d.width / g.w)) : g.h;
      const svg = genSvg(g.id, spec.palette, spec.seed, w, h)!;
      const a = await vectorAsset(svg, w, h, g.label, null);
      const n: ImageNode = { id: uid('n'), type: 'image', name: g.label, x: full ? 0 : Math.round(pt.x - w / 2), y: Math.round(pt.y - h / 2), w, h, visible: true, locked: false, opacity: 1, link: null, alt: '', assetId: a.id, fit: 'fill', radius: 0, fill: null, overlay: null, decor: true, vector: { svg, color: null, kind: 'graphic', gen: { id: g.id, seed: spec.seed, palette: spec.palette } } };
      A.insertLayers([n]);
      if (full) toast('Nền đã chèn. Bấm ⌘[ để đưa xuống dưới nội dung.', 'info');
    } else if (spec.kind === 'photo') {
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
const POPULAR_LOGOS = ['facebook', 'instagram-icon', 'tiktok-icon', 'youtube-icon', 'messenger', 'whatsapp-icon', 'telegram', 'google-icon', 'apple', 'twitter', 'linkedin-icon', 'pinterest', 'shopify', 'visa', 'mastercard', 'paypal', 'stripe', 'spotify-icon', 'netflix-icon', 'discord-icon', 'slack-icon', 'figma', 'chrome', 'app-store-ios', 'google-play-icon', 'gmail', 'zoom-icon', 'notion-icon'];

const drag = (spec: Spec) => (e: DragEvent) => { e.dataTransfer?.setData('text/phloem-el', JSON.stringify(spec)); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'; };

/** An icon tile rendered inline from batched icon data (one request per icon set for the whole grid). */
function IconSvg({ id, color }: { id: string; color?: string | null }) {
  const [svg, setSvg] = useState('');
  useEffect(() => { let alive = true; void iconTileSvg(id, color).then((x) => { if (alive) setSvg(x); }); return () => { alive = false; }; }, [id, color]);
  return svg ? <span class="ic-svg" dangerouslySetInnerHTML={{ __html: svg }} /> : <span class="ic-wait" />;
}

export function DesignPanel() {
  const s = useStore();
  const b = s.project?.brand;
  const [cat, setCat] = useState<Cat>('all');
  const [color, setColor0] = useState<string>(() => lastColor || b?.primary || '#111111');
  const setColor = (c: string) => { lastColor = c; setColor0(c); };
  const [q, setQ] = useState('');
  const [style, setStyle] = useState<string>('-duotone');
  const [found, setFound] = useState<{ icons: string[]; stickers: string[]; d3: string[] }>({ icons: [], stickers: [], d3: [] });
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoQ, setPhotoQ] = useState('');
  const [loading, setLoading] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [f3, setF3] = useState<Fluent3d | null>(null);
  const [f3cat, setF3cat] = useState('Objects');
  const [stSet, setStSet] = useState('fluent-emoji');
  const [stCats, setStCats] = useState<[string, string[]][]>([]);
  const [stCat, setStCat] = useState('');
  const [icSet, setIcSet] = useState('ph');
  const [icCats, setIcCats] = useState<[string, string[]][]>([]);
  const [icCat, setIcCat] = useState('');
  const [pStyle, setPStyle] = useState('open-peeps');
  const [pRound, setPRound] = useState(1);
  const [genGroup, setGenGroup] = useState<GenGroup>('bg');
  const [elGroup, setElGroup] = useState<GenGroup>('ribbon');
  const [palIdx, setPalIdx] = useState(-1); // -1 = brand
  const [seed, setSeed] = useState(1);
  const [more, setMore] = useState(1);
  const tm = useRef<number | undefined>(undefined);
  const choices = useMemo(() => (b ? colorChoices(b) : []), [b?.primary, b?.accent, b?.ink, b?.muted, b?.soft]);
  const brandPal = b ? [b.bg, b.primary, b.accent, b.soft, b.ink] : GEN_PALETTES[0].p;
  const palette = palIdx < 0 ? brandPal : GEN_PALETTES[palIdx].p;

  useEffect(() => { setMore(1); }, [cat, f3cat, stCat, stSet, icSet, icCat, pStyle, pRound]);
  // 3D library on demand
  useEffect(() => { if ((cat === '3d' || cat === 'all' || q.trim()) && !f3) void loadFluent3d().then(setF3).catch((e) => toast((e as Error).message, 'err')); }, [cat, q]);
  // sticker set categories on demand
  useEffect(() => { if (cat !== 'icon' || icSet === 'ph') return; setIcCats([]); void iconCollection(icSet).then((c) => { setIcCats(c.cats.length ? c.cats : [['Tất cả', c.all]]); setIcCat((c.cats[0] || ['Tất cả'])[0]); }).catch(() => setIcCats([])); }, [cat, icSet]);
  useEffect(() => { if (cat !== 'sticker') return; setStCats([]); void iconCollection(stSet).then((c) => { setStCats(c.cats.length ? c.cats : [['Tất cả', c.all]]); setStCat((c.cats[0] || ['Tất cả'])[0]); }).catch(() => setStCats([])); }, [cat, stSet]);
  // search icons + stickers + 3D as you type (debounced); photos on Enter
  useEffect(() => {
    clearTimeout(tm.current);
    if (!q.trim() || cat === 'photo') { setFound({ icons: [], stickers: [], d3: [] }); return; }
    tm.current = window.setTimeout(async () => {
      setLoading('Đang tìm…');
      try {
        const sets = cat === 'logo' ? ['logos', 'simple-icons'] : ICON_SETS;
        const [icons, stickers] = await Promise.all([searchIcons(q, sets as readonly string[], 96).catch(() => []), cat === 'logo' ? Promise.resolve([] as string[]) : searchIcons(q, COLOR_SETS.map((x) => x.v), 96).catch(() => [])]);
        const idx = f3 || (await loadFluent3d().catch(() => null));
        setFound({ icons: icons.filter((x) => !/-(thin|light)$/.test(x)), stickers: stickers.filter((x) => !/-(light|medium|dark|medium-light|medium-dark)$/.test(x)), d3: idx && cat !== 'logo' ? searchFluent3d(idx, q) : [] });
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
  const iconTile = (id: string, mono = true) => (
    <button key={id} class={`ic-tile ${mono ? '' : 'st'}`} title={`${id} · bấm để chèn`} draggable onDragStart={drag(mono ? { kind: 'icon', id, color } : { kind: 'sticker', id })} onClick={() => void put(mono ? { kind: 'icon', id } : { kind: 'sticker', id }, id)}>
      <IconSvg id={id} color={mono ? color : null} />
    </button>
  );
  const d3Tile = (id: string) => {
    const u = f3 ? fluent3dUrl(f3, id) : null;
    return (
      <button key={id} class={`ic-tile st d3 ${busy === id ? 'busy' : ''}`} title={`${id.replace(/-/g, ' ')} · vật thể 3D`} draggable onDragStart={drag({ kind: '3d', id })} onClick={() => void put({ kind: '3d', id }, id)}>
        {u ? <img src={u} alt="" loading="lazy" /> : null}
      </button>
    );
  };
  const peopleTile = (style: string, seed: string) => (
    <button key={`${style}-${seed}`} class={`ic-tile st pp ${busy === `${style}-${seed}` ? 'busy' : ''}`} title={`${PEOPLE_STYLES.find((x) => x.v === style)?.label || style} · bấm để chèn`} draggable onDragStart={drag({ kind: 'people', style, seed })} onClick={() => void put({ kind: 'people', style, seed }, `${style}-${seed}`)}>
      <img src={peopleUrl(style, seed)} alt="" loading="lazy" />
    </button>
  );
  const genTile = (gid: string, sd: number) => {
    const g = GENERATORS.find((x) => x.id === gid)!;
    const svg = genSvg(gid, palette, sd, OBJ(g.group) ? g.w : 300, OBJ(g.group) ? g.h : Math.round(300 * (g.h / g.w)))!;
    return (
      <button key={`${gid}-${sd}`} class={`gen-tile g-${g.group} ${busy === `${gid}-${sd}` ? 'busy' : ''}`} title={`${g.label} · biến thể ${sd}`} draggable onDragStart={drag({ kind: 'gen', id: gid, seed: sd, palette })} onClick={() => void put({ kind: 'gen', id: gid, seed: sd, palette }, `${gid}-${sd}`)}>
        <img src={svgDataUrl(svg)} alt="" />
        <span class="el-lb">{g.label}</span>
      </button>
    );
  };
  const head = (label: string, to: Cat) => <Eyebrow action={cat === 'all' ? { label: 'Xem tất cả', onClick: () => setCat(to) } : undefined}>{label}</Eyebrow>;
  const page = (list: string[], n = 72) => list.slice(0, n * more);
  const moreBtn = (list: string[], n = 72) => (list.length > n * more ? <Btn sm kind="ghost" onClick={() => setMore((m) => m + 1)}>Xem thêm ({list.length - n * more})</Btn> : null);
  const sel = s.selection.length;
  const f3list = f3 ? (f3.cats.find(([c]) => c === f3cat)?.[1] || []) : [];
  const stList = stCats.find(([c]) => c === stCat)?.[1] || [];

  if (!s.project) return null;
  return (
    <div class="section design-panel">
      <div class="dp-search">
        <Icon name="search" size={13} />
        <input value={q} placeholder={cat === 'photo' ? 'Tìm ảnh miễn phí (Enter)…' : cat === 'logo' ? 'Tìm logo thương hiệu…' : 'Tìm 3D, sticker, icon… (vd: quà, cà phê, rocket)'} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && cat === 'photo') void runPhotos(q); }} />
        {q && <button class="x" onClick={() => setQ('')}>×</button>}
      </div>
      <div class="dp-cats">{CATS.map((c) => <button key={c.v} class={`chip ${cat === c.v ? 'on' : ''}`} onClick={() => setCat(c.v)}>{c.label}</button>)}</div>
      {!['photo', 'anim', '3d', 'bg', 'sticker'].includes(cat) && (
        <div class="dp-colors" title="Màu cho hình, icon, chữ mới chèn">
          {choices.map((c) => <button key={c.c} class={`sw ${color.toUpperCase() === c.c.toUpperCase() ? 'on' : ''}`} style={{ background: c.c }} title={c.label} onClick={() => setColor(c.c)} />)}
          <label class="sw pick" title="Chọn màu khác"><input type="color" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#000000'} onInput={(e) => setColor((e.target as HTMLInputElement).value.toUpperCase())} /></label>
        </div>
      )}
      {loading && <div class="dim small">{loading}</div>}

      {q.trim() && cat !== 'photo' && cat !== 'anim' ? (
        <>
          {found.d3.length > 0 && <><Eyebrow>Vật thể 3D · {found.d3.length}</Eyebrow><div class="ic-grid d3">{found.d3.map(d3Tile)}</div></>}
          {found.stickers.length > 0 && <><Eyebrow>Sticker · {found.stickers.length}</Eyebrow><div class="ic-grid">{found.stickers.map((id) => iconTile(id, false))}</div></>}
          {found.icons.length > 0 && <><Eyebrow>{cat === 'logo' ? 'Logo' : 'Icon'} · {found.icons.length}</Eyebrow><div class="ic-grid">{found.icons.map((id) => iconTile(id, !id.startsWith('logos:')))}</div></>}
          {!loading && !found.icons.length && !found.stickers.length && !found.d3.length && <div class="dim small">Không thấy "{q}". Thử từ tiếng Anh (gift, coffee, star…).</div>}
        </>
      ) : (
        <>
          {cat === 'all' && <div class="dp-count">Hơn 100.000 đồ hoạ: 1.600 vật thể 3D, nhân vật &amp; người minh hoạ không giới hạn (23 phong cách), 32.000+ sticker, minh hoạ &amp; icon màu, 70.000 icon, 4.000 hình game, 2.000 logo, nền &amp; hoạ tiết sinh vô hạn theo màu thương hiệu. <a href="https://github.com/DorisLe-UXUI/phloem/blob/main/docs/CREDITS.md" target="_blank" rel="noopener">Nguồn &amp; giấy phép</a></div>}
          {(cat === 'all' || cat === '3d') && (
            <>
              {head('Vật thể 3D', '3d')}
              {cat === '3d' && f3 && <div class="dp-cats">{f3.cats.map(([c, ids]) => <button key={c} class={`chip ${f3cat === c ? 'on' : ''}`} onClick={() => setF3cat(c)}>{CAT_VI[c] || c} · {ids.length}</button>)}</div>}
              {!f3 ? <div class="dim small">Đang tải thư viện 3D…</div> : <div class="ic-grid d3">{(cat === 'all' ? ['rocket', 'wrapped-gift', 'fire', 'party-popper', 'sparkles', 'crown', 'money-bag', 'shopping-bags', 'red-heart', 'trophy', 'light-bulb', 'hot-beverage'].filter((id) => f3.paths[id]) : page(f3list, 60)).map(d3Tile)}</div>}
              {cat === '3d' && moreBtn(f3list, 60)}
              {cat === '3d' && <div class="dim small">Microsoft Fluent Emoji 3D · giấy phép MIT · dùng thương mại thoải mái.</div>}
            </>
          )}
          {(cat === 'all' || cat === 'bg') && (
            <>
              {head('Nền & hoạ tiết', 'bg')}
              {cat === 'bg' && <div class="dp-cats">{GEN_GROUPS.filter((g) => !ELEM_GROUPS.includes(g)).map((g) => <button key={g.v} class={`chip ${genGroup === g.v ? 'on' : ''}`} onClick={() => setGenGroup(g.v)}>{g.label}</button>)}</div>}
              <div class="dp-pals">
                <button class={`pal ${palIdx < 0 ? 'on' : ''}`} title="Màu thương hiệu" onClick={() => setPalIdx(-1)}>{brandPal.slice(0, 4).map((c, i) => <i key={i} style={{ background: c }} />)}</button>
                {GEN_PALETTES.map((p, i) => <button key={p.name} class={`pal ${palIdx === i ? 'on' : ''}`} title={p.name} onClick={() => setPalIdx(i)}>{p.p.slice(0, 4).map((c, k) => <i key={k} style={{ background: c }} />)}</button>)}
                <button class="pal shuffle" title="Biến thể khác" onClick={() => setSeed((x) => x + 7)}>↻</button>
              </div>
              <div class={`gen-grid g-${cat === 'all' ? 'bg' : genGroup}`}>
                {(cat === 'all' ? ['waves', 'blur', 'blobs', 'sunburst', 'sphere', 'memphis'] : GENERATORS.filter((g) => g.group === genGroup).map((g) => g.id)).flatMap((gid) => (cat === 'all' ? [genTile(gid, seed)] : [0, 1].map((k) => genTile(gid, seed + k * 101))))}
              </div>
            </>
          )}
          {(cat === 'all' || cat === 'elem') && (
            <>
              {head('Phần tử: ruy băng, huy hiệu, bong bóng, khung…', 'elem')}
              {cat === 'elem' && <div class="dp-cats">{ELEM_GROUPS.map((g) => <button key={g.v} class={`chip ${elGroup === g.v ? 'on' : ''}`} onClick={() => setElGroup(g.v)}>{g.label}</button>)}</div>}
              {cat === 'elem' && <div class="dp-pals">
                <button class={`pal ${palIdx < 0 ? 'on' : ''}`} title="Màu thương hiệu" onClick={() => setPalIdx(-1)}>{brandPal.slice(0, 4).map((c, i) => <i key={i} style={{ background: c }} />)}</button>
                {GEN_PALETTES.map((p, i) => <button key={p.name} class={`pal ${palIdx === i ? 'on' : ''}`} title={p.name} onClick={() => setPalIdx(i)}>{p.p.slice(0, 4).map((c, k) => <i key={k} style={{ background: c }} />)}</button>)}
                <button class="pal shuffle" title="Biến thể khác" onClick={() => setSeed((x) => x + 7)}>↻</button>
              </div>}
              <div class="gen-grid g-deco">
                {(cat === 'all' ? ['title-plate', 'ribbon-fold', 'seal', 'bubble-round', 'arrow-curve', 'sparkle-cluster'] : GENERATORS.filter((g) => g.group === elGroup).map((g) => g.id)).flatMap((gid) => (cat === 'all' ? [genTile(gid, seed)] : [0, 1, 2].map((k) => genTile(gid, seed + k * 101))))}
              </div>
              {cat === 'elem' && <div class="dim small">Mọi phần tử đổi màu theo thương hiệu hoặc bảng màu chọn ở trên; bấm ↻ để ra biến thể mới. Chèn xong vẫn đổi màu, kích thước, xoay được.</div>}
            </>
          )}
          {(cat === 'all' || cat === 'shape') && <>{head('Hình khối', 'shape')}<div class="el-grid">{els(['shape', 'svg'], cat === 'all' ? 8 : undefined).map(tile)}</div></>}
          {(cat === 'all' || cat === 'graphic') && <>{head('Đồ hoạ dựng sẵn', 'graphic')}<div class="el-grid">{els('graphic', cat === 'all' ? 8 : undefined).map(tile)}</div></>}
          {(cat === 'all' || cat === 'people') && (
            <>
              {head('Người & nhân vật', 'people')}
              {cat === 'people' && <div class="dp-cats">{PEOPLE_STYLES.map((x) => <button key={x.v} class={`chip ${pStyle === x.v ? 'on' : ''}`} onClick={() => setPStyle(x.v)}>{x.label}</button>)}</div>}
              <div class="ic-grid">{(cat === 'all' ? peopleSeeds(pRound, 8).map((sd, i) => peopleTile(['open-peeps', 'micah', 'personas', 'notionists', 'adventurer', 'clay', 'toon-head', 'dylan'][i], sd)) : peopleSeeds(pRound, 36 * more).map((sd) => peopleTile(pStyle, sd)))}</div>
              {cat === 'people' && <div class="row" style={{ gap: 6 }}><Btn sm kind="ghost" icon="sparkle" onClick={() => setPRound((r) => r + 1)}>Đổi mẫu khác</Btn><Btn sm kind="ghost" onClick={() => setMore((m) => m + 1)}>Xem thêm 36</Btn></div>}
              {cat === 'people' && <div class="dim small">Mỗi lần đổi là một bộ nhân vật mới, không giới hạn. Tranh của {PEOPLE_STYLES.find((x) => x.v === pStyle)?.by} · {PEOPLE_STYLES.find((x) => x.v === pStyle)?.lic} · qua DiceBear.</div>}
            </>
          )}
          {(cat === 'all' || cat === 'sticker') && (
            <>
              {head('Sticker', 'sticker')}
              {cat === 'sticker' && <div class="dp-cats">{STICKER_SETS.map((x) => <button key={x.v} class={`chip ${stSet === x.v ? 'on' : ''}`} onClick={() => setStSet(x.v)}>{x.label}</button>)}</div>}
              {cat === 'sticker' && stCats.length > 1 && <div class="dp-cats">{stCats.map(([c, ids]) => <button key={c} class={`chip ${stCat === c ? 'on' : ''}`} onClick={() => setStCat(c)}>{c} · {ids.length}</button>)}</div>}
              <div class="ic-grid">{(cat === 'all' ? ['fire', 'sparkles', 'party-popper', 'wrapped-gift', 'red-heart', 'star', 'high-voltage', 'hundred-points', 'rocket', 'crown', 'gem-stone', 'shopping-bags'].map((n) => `fluent-emoji:${n}`) : page(stList.filter((x) => !/-(light|medium|dark|medium-light|medium-dark)$/.test(x))).map((n) => `${stSet}:${n}`)).map((id) => iconTile(id, false))}</div>
              {cat === 'sticker' && moreBtn(stList)}
            </>
          )}
          {(cat === 'all' || cat === 'icon') && (
            <>
              {head('Icon', 'icon')}
              {cat === 'icon' && <div class="dp-cats">{ICON_BROWSE.map((x) => <button key={x.v} class={`chip ${icSet === x.v ? 'on' : ''}`} onClick={() => setIcSet(x.v)}>{x.label}</button>)}</div>}
              {cat === 'icon' && icSet === 'ph' && <div class="dp-cats">{ICON_STYLES.map((st) => <button key={st.v} class={`chip ${style === st.v ? 'on' : ''}`} onClick={() => setStyle(st.v)}>{st.label}</button>)}</div>}
              {cat === 'icon' && icSet !== 'ph' && icCats.length > 1 && <div class="dp-cats">{icCats.map(([c, ids]) => <button key={c} class={`chip ${icCat === c ? 'on' : ''}`} onClick={() => setIcCat(c)}>{c} · {ids.length}</button>)}</div>}
              {cat === 'icon' && icSet !== 'ph'
                ? <>{!icCats.length ? <div class="dim small">Đang tải bộ icon…</div> : <div class="ic-grid">{page(icCats.find(([c]) => c === icCat)?.[1] || []).map((n) => iconTile(`${icSet}:${n}`))}</div>}{moreBtn(icCats.find(([c]) => c === icCat)?.[1] || [])}</>
                : <div class="ic-grid">{(cat === 'all' ? ICONS.slice(0, 12) : ICONS).map((n) => iconTile(`ph:${n}${style}`))}</div>}
              {cat === 'icon' && <div class="dim small">Gõ vào ô tìm kiếm để tìm trong hơn 70.000 icon của 18 bộ (Phosphor, Fluent, Solar, Huge, MingCute, Material…).</div>}
            </>
          )}
          {cat === 'logo' && (
            <>
              <Eyebrow>Logo thương hiệu</Eyebrow>
              <div class="ic-grid">{POPULAR_LOGOS.map((n) => iconTile(`logos:${n}`, false))}</div>
              <div class="dim small">Gõ tên để tìm trong gần 2.000 logo (CC0). Logo là thương hiệu của chủ sở hữu: chỉ dùng để dẫn link đúng thương hiệu đó.</div>
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
