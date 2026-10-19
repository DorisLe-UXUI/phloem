// "Dựng bằng AI": images + copy in, three rendered variants out, pick one.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND_PRESETS, DEFAULT_BRAND, type Brand } from '../model/types';
import { renderToCanvas, thumbnail } from '../render/renderer';
import { makeMobile } from '../model/ops';
import { assets } from '../storage/assets';
import { get, set, toast, useStore } from '../store';
import * as A from '../pipeline/actions';
import { brandForPalette, brandForVariant, generateVariants, variantToDoc, type GenInput, type Variant } from '../ai/generate';
import { ensureFonts } from '../render/fonts';
import { aiTransport, type AiTransport } from '../ai/client';
import { designEmail, docHash, redrawDirection, TREND_OPTIONS, type DesignVariant } from '../ai/design';
import { houseStyleOf, type HouseStyle } from '../ai/clientStyle';
import { capitalizeSentences, prepareHtml } from '../ai/htmlToDoc';
import * as ops from '../model/ops';
import { analyzeSite, brandFromSite, dominantColors, importSiteImages, lightVersionOf, linksFromSite, type SiteProduct, type SiteProfile } from '../ai/site';
import { Btn, Eyebrow, Field, Modal, Seg, Select, TextArea, TextInput } from './components';
import { groupAssets, pageLabel, usedAssetIds } from '../storage/assetGroups';
import { Icon } from './icons';
import { ask } from './confirm';

const GOALS = [
  { v: 'promo', label: 'Khuyến mãi / sale' }, { v: 'intro', label: 'Giới thiệu dịch vụ / thương hiệu' }, { v: 'newsletter', label: 'Newsletter định kỳ' }, { v: 'launch', label: 'Ra mắt sản phẩm' },
  { v: 'welcome', label: 'Chào mừng người mới' }, { v: 'event', label: 'Mời sự kiện' }, { v: 'cart', label: 'Nhắc giỏ hàng' },
  { v: 'digest', label: 'Bản tin biên tập' }, { v: 'reengagement', label: 'Kéo khách quay lại' }, { v: 'other', label: 'Khác' },
];
const TONES = [{ v: 'thân thiện, gần gũi', label: 'Thân thiện' }, { v: 'sang trọng, tối giản', label: 'Sang trọng' }, { v: 'sôi nổi, thúc giục', label: 'Sôi nổi' }, { v: 'chuyên nghiệp, rõ ràng', label: 'Chuyên nghiệp' }];

const LS = 'phloem.ai.form';

/** The last free-form designs survive closing the dialog (reopen "Dựng bằng AI" to pick one); cleared once one is used. */
let keptDesigns: DesignVariant[] = [];

export function AiModal({ onClose: close0 }: { onClose: () => void }) {
  const s = useStore();
  const [form, setForm] = useState<GenInput>(() => {
    const base: GenInput = { goal: 'promo', brandName: '', brief: '', content: '', tone: TONES[0].v, imageIds: [], palette: 'auto', website: '', site: null, webBrand: null, logoAssetId: null, logoLightAssetId: null, language: 'auto', products: [] };
    try { const saved = JSON.parse(localStorage.getItem(LS) || '{}') as Partial<GenInput>; return { ...base, ...saved, imageIds: [], site: null, logoAssetId: null, logoLightAssetId: null, products: [], palette: saved.palette === 'Web' ? 'auto' : (saved.palette ?? 'auto') }; } catch { return base; }
  });
  const [transport, setTransport] = useState<AiTransport | 'checking'>('checking');
  // "Thiết kế tự do": Claude designs in HTML/CSS → layers (default). "Block": the older block composer.
  const [mode, setMode] = useState<'design' | 'blocks'>(() => { try { return localStorage.getItem('phloem.ai.mode') === 'blocks' ? 'blocks' : 'design'; } catch { return 'design'; } });
  const pickMode = (m: 'design' | 'blocks') => { setMode(m); try { localStorage.setItem('phloem.ai.mode', m); } catch { /* ignore */ } };
  const [review, setReview] = useState(true);
  const [designs, setDesigns0] = useState<DesignVariant[]>(() => keptDesigns);
  const setDesigns = (v: DesignVariant[]) => { keptDesigns = v; setDesigns0(v); };
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const [busy, setBusy] = useState(false);
  /** Closing while the AI draws would throw the work away: ask first (a stray click outside the dialog used to do it). */
  const onClose = async () => {
    const drawing = busy || designs.some((d) => ['queued', 'drawing', 'converting', 'reviewing'].includes(d.stage));
    if (drawing && !(await ask('AI đang vẽ email. Đóng bây giờ sẽ dừng các phương án chưa xong (phương án đã xong vẫn được giữ, mở lại Dựng bằng AI để dùng). Đóng?', 'Đóng', true))) return;
    abort.current?.abort(); close0();
  };
  const [redrawing, setRedrawing] = useState<number | null>(null);
  /** Progress, results and errors live at the bottom of a long form: bring them into view (they were easy to miss). */
  const resultsRef = useRef<HTMLDivElement>(null);
  const showResults = () => setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  /** Draw again only the direction that failed, keeping the other two. */
  const redraw = async (i: number) => {
    const v = designs[i]; if (!v) return;
    const ac = new AbortController(); abort.current = ac; setRedrawing(i);
    let list = designs;
    try { await redrawDirection(v.dir, i, { onUpdate: (k, patch) => { list = list.map((x, j) => (j === k ? { ...x, ...patch } : x)); setDesigns(list); } }, { review, signal: ac.signal }); }
    catch (e) { toast((e as Error).message, 'err'); }
    finally { setRedrawing(null); }
  };
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stage, setStage] = useState('');
  // Full-size preview of one variant before choosing it.
  const [preview, setPreview] = useState<number | null>(null);
  const [pvMode, setPvMode] = useState<'desktop' | 'mobile'>('desktop');
  const [pvUrl, setPvUrl] = useState('');
  useEffect(() => {
    if (preview !== null && mode === 'design') {
      const dv = designs[preview]; if (!dv || !dv.doc || !dv.brand) { setPvUrl(''); return; }
      let alive = true;
      const draw = () => { try { const doc = pvMode === 'mobile' ? (dv.mobile || makeMobile(dv.doc!)) : dv.doc!; const c = renderToCanvas(doc, dv.brand!, assets, pvMode === 'mobile' ? 2 : 1.5); if (alive) setPvUrl(c.toDataURL('image/jpeg', 0.9)); } catch { /* not ready */ } };
      draw(); const t = setTimeout(draw, 1500); const off = assets.onChange(draw);
      return () => { alive = false; clearTimeout(t); off(); };
    }
    if (preview === null || !variants[preview]) { setPvUrl(''); return; }
    const v = variants[preview];
    const br = brandForVariant(v, baseBrand(), form.webBrand);
    ensureFonts([br.headingFamily, br.fontFamily]);
    let alive = true;
    const draw = () => { try { const d = variantToDoc(v, br); const doc = pvMode === 'mobile' ? makeMobile(d) : d; const c = renderToCanvas(doc, br, assets, pvMode === 'mobile' ? 2 : 1.5); if (alive) setPvUrl(c.toDataURL('image/jpeg', 0.9)); } catch { /* fonts/images not ready */ } };
    draw();
    const t = setTimeout(draw, 1800); // again once web fonts / images are in
    const off = assets.onChange(draw);
    return () => { alive = false; clearTimeout(t); off(); };
  }, [preview, pvMode, variants, designs, mode]);
  useEffect(() => {
    if (preview === null) return;
    const n = mode === 'design' ? designs.length : variants.length;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPreview(null); } if (e.key === 'ArrowRight') setPreview((p) => (p === null ? p : (p + 1) % n)); if (e.key === 'ArrowLeft') setPreview((p) => (p === null ? p : (p + n - 1) % n)); };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [preview, variants.length, designs.length, mode]);
  const [relayUp, setRelayUp] = useState(false);
  useEffect(() => { const u = (get().settings.relayUrl || '').replace(/\/$/, ''); if (!u) return; fetch(u + '/', { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).then((j) => setRelayUp(!!j?.ai && !!j?.auth)).catch(() => setRelayUp(false)); }, [s.settings.relayUrl, s.user?.id]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [err, setErr] = useState('');
  // the client this email is for: its brand book + recent emails steer every direction (switchable)
  const clientId = A.currentClientId();
  const [house, setHouse] = useState<HouseStyle | null | undefined>(undefined);
  const [useHouse, setUseHouse] = useState(true);
  useEffect(() => { setHouse(undefined); void houseStyleOf(clientId, form.language === 'en' ? 'en' : 'vi', s.project?.id).then(setHouse).catch(() => setHouse(null)); }, [clientId]);
  const [, bump] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const logoFile = useRef<HTMLInputElement>(null);
  const [siteBusy, setSiteBusy] = useState('');
  const [siteErr, setSiteErr] = useState('');
  useEffect(() => { void aiTransport().then(setTransport); return assets.onChange(() => bump((n) => n + 1)); }, []);
  // Products handed over from Kho hàng: import their photos, pin them as the email's subject.
  useEffect(() => {
    const seed = get().aiSeed; if (!seed) return;
    set({ aiSeed: null });
    void (async () => {
      setSiteBusy('Đang tải ảnh sản phẩm…');
      try {
        const fake = { images: [], products: seed.products, logo: '', icon: '', ogImage: '' } as unknown as SiteProfile;
        const got = await importSiteImages(fake, 12, (d, t) => setSiteBusy(`Đang tải ảnh ${d}/${t}…`), true);
        upd((f) => ({ products: seed.products, imageIds: [...new Set([...f.imageIds, ...got.imageIds])], goal: seed.goal && GOALS.some((g) => g.v === seed.goal) ? seed.goal : f.goal, brief: seed.brief || f.brief, content: seed.products.map((p) => `${p.name}${p.price ? ` — ${p.price}` : ''}${p.compareAt ? ` (giá cũ ${p.compareAt})` : ''}${p.url ? ` ${p.url}` : ''}`).join('\n') }));
        toast(`${seed.products.length} sản phẩm từ kho đã sẵn sàng.`, 'ok');
      } catch (e) { setSiteErr((e as Error).message); }
      finally { setSiteBusy(''); }
    })();
  }, []);
  const addFiles = async (list: FileList | File[]) => { const ids: string[] = []; for (const f of Array.from(list)) { if (!f.type.startsWith('image/')) continue; try { ids.push((await assets.add(f, undefined, { src: { kind: 'upload' } })).id); } catch { /* skip */ } } if (ids.length) { upd((f) => ({ imageIds: [...f.imageIds, ...ids] })); toast(`Đã thêm ${ids.length} ảnh.`, 'ok'); } };
  /** One clean URL: a link pasted twice ("https://a.com/https://a.com/") or with spaces becomes the last full link. */
  const cleanUrl = (v: string) => { const parts = v.trim().split(/(?=https?:\/\/)/i).map((x) => x.trim()).filter(Boolean); const u = (parts.length ? parts[parts.length - 1] : v.trim()).replace(/\s+/g, ''); return u && !/^https?:\/\//i.test(u) ? `https://${u}` : u; };
  useEffect(() => {
    const h = (e: ClipboardEvent) => { const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; const files = Array.from(e.clipboardData?.files || []); if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); void addFiles(files); } };
    window.addEventListener('paste', h); return () => window.removeEventListener('paste', h);
  }, []);
  const upd = (patch: Partial<GenInput> | ((f: GenInput) => Partial<GenInput>)) => setForm((f) => { const n = { ...f, ...(typeof patch === 'function' ? patch(f) : patch) }; try { localStorage.setItem(LS, JSON.stringify({ ...n, imageIds: [], site: null, logoAssetId: null, logoLightAssetId: null, products: [] })); } catch { /* ignore */ } return n; });
  const baseBrand = (): Brand => ({ ...DEFAULT_BRAND, ...(form.webBrand || {}), name: form.brandName || form.webBrand?.name || DEFAULT_BRAND.name, logoAssetId: form.logoAssetId ?? null, logoLightAssetId: form.logoLightAssetId ?? null, links: form.site ? linksFromSite(form.site) : null });
  /** Read the website, import its images, update the form. Returns the updated form (or null on error). */
  const analyzeNow = async (): Promise<GenInput | null> => {
    setSiteErr(''); setSiteBusy('AI đang đọc trang…');
    try {
      const site = cleanUrl(form.website || '');
      if (site !== form.website) upd({ website: site });
      const p: SiteProfile = await analyzeSite(site, (m) => setSiteBusy(m));
      setSiteBusy('Đang tải logo và ảnh…');
      const got = await importSiteImages(p, 80, (d, t) => setSiteBusy(`Đang tải ảnh ${d}/${t}…`), !!form.logoAssetId);
      // the logo's own colours beat CSS frequency when the site has no named brand tokens
      const logoId = form.logoAssetId ?? got.logoId ?? null;
      const logoColors = logoId ? await dominantColors(logoId) : [];
      const wb = brandFromSite(p, { logoColors });
      let next: GenInput | null = null;
      upd((f) => { next = { ...f, site: p, webBrand: wb, brandName: f.brandName || wb.name || '', logoAssetId: f.logoAssetId ?? got.logoId ?? null, logoLightAssetId: f.logoAssetId ? f.logoLightAssetId ?? null : got.logoLightId ?? null, imageIds: [...new Set([...f.imageIds, ...got.suggested])], palette: 'Web' }; return next; });
      const pagesN = (p.pages || []).length + 1;
      toast(`Đã đọc ${p.siteName || p.title} (${pagesN} trang): ${p.colors.length} màu, ${p.fonts.length} font, ${got.imageIds.length} ảnh vào thư viện (${got.suggested.length} ảnh được chọn sẵn cho AI)${got.logoId ? ', logo' : ''}${p.products?.length ? `, ${p.products.length} sản phẩm` : ''}.`, 'ok');
      return next;
    } catch (e) { setSiteErr((e as Error).message); return null; }
    finally { setSiteBusy(''); }
  };
  const analyze = () => { void analyzeNow(); };
  const pickLogo = async (f: File) => { try { const a = await assets.add(f, f.name || 'logo'); const light = await lightVersionOf(f); const l = light ? await assets.add(light, 'logo-light.png') : null; upd({ logoAssetId: a.id, logoLightAssetId: l ? l.id : null }); } catch (e) { toast((e as Error).message, 'err'); } };
  const toggleImg = (id: string) => upd({ imageIds: form.imageIds.includes(id) ? form.imageIds.filter((x) => x !== id) : [...form.imageIds, id] });

  const run = async () => {
    setBusy(true); setErr(''); setVariants([]); setThumbs([]); setDesigns([]); showResults();
    abort.current?.abort(); const ac = new AbortController(); abort.current = ac;
    try {
      let input = form;
      if ((form.website || '').trim() && !form.site) { // typed a website but never pressed "AI đọc web": read it first
        const r = await analyzeNow(); if (r) input = r;
      }
      input = { ...input, house: useHouse ? house || null : null };
      await document.fonts.ready;
      if (mode === 'design') {
        let list: DesignVariant[] = [];
        await designEmail(input, baseBrand(), {
          onStage: setStage,
          onPlan: (v) => { list = v; setDesigns(v); },
          onUpdate: (i, patch) => { list = list.map((x, j) => (j === i ? { ...x, ...patch } : x)); setDesigns(list); },
        }, { review, signal: ac.signal });
        if (list.every((x) => x.stage === 'error')) throw new Error(list[0]?.error || 'Không vẽ được phương án nào.');
        return;
      }
      const vs = await generateVariants(input, setStage);
      setVariants(vs);
      ensureFonts(vs.flatMap((v) => [v.headingFont || '', v.bodyFont || '']).filter(Boolean));
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
      const render = () => vs.map((v) => { const br = brandForVariant(v, baseBrand(), form.webBrand); try { return thumbnail(variantToDoc(v, br), br, assets, 480, 2.1); } catch { return ''; } });
      setThumbs(render());
      setTimeout(() => setThumbs(render()), 2500); // once web fonts are in
    } catch (e) { setErr((e as Error).message); toast(`AI chưa vẽ được: ${(e as Error).message}`.slice(0, 220), 'err'); }
    finally { setBusy(false); setStage(''); showResults(); }
  };

  const use = async (v: Variant) => {
    const brand: Brand = brandForVariant(v, baseBrand(), form.webBrand);
    ensureFonts([brand.headingFamily, brand.fontFamily]);
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    let doc;
    try { doc = variantToDoc(v, brand); } catch (e) { toast(`Không dựng được phương án "${v.name}": ${(e as Error).message}. Bấm "Dựng lại".`, 'err'); return; }
    if (s.project) {
      if (!(await ask(`Thay toàn bộ nội dung "${s.project.name}" bằng phương án "${v.name}"? Có thể hoàn tác bằng ⌘Z.`, 'Thay', false))) return;
      if (get().variant !== 'desktop') A.setVariant('desktop');
      A.commit(doc);
      A.patchProject({ brand, fields: v.fields, mobile: null });
      set({ selection: [], modal: null });
      tagForProject(s.project.id);
      toast(`Đã áp dụng "${v.name}". Chỉnh tiếp trên canvas.`, 'ok');
    } else {
      close0();
      await A.newProject('blank', brand, v.fields.campaignName || v.name);
      A.commit(doc, false);
      A.patchProject({ fields: v.fields });
      const pid = get().project?.id; if (pid) tagForProject(pid);
      toast(`Đã tạo project từ "${v.name}".`, 'ok');
    }
  };

  /** A free-form design lands as layers; its HTML rides along so "AI tự chỉnh" can revise it while untouched. */
  const useDesign = async (v: DesignVariant) => {
    if (!v.doc || !v.brand) return;
    const brand = v.brand;
    ensureFonts([brand.headingFamily, brand.fontFamily]);
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    const used = [...new Set([...ops.flat(v.doc.nodes), ...(v.mobile ? ops.flat(v.mobile.nodes) : [])].filter((n) => n.type === 'image' && n.assetId).map((n) => (n as { assetId: string }).assetId))];
    const land = async (pid: string) => {
      await assets.persist(used, pid);
      tagForProject(pid);
      const cur = get().project; if (!cur) return;
      A.patchProject({ design: { html: v.html, hash: docHash(cur.desktop), name: v.dir.name, at: new Date().toISOString(), dir: v.dir } });
    };
    if (s.project) {
      if (!(await ask(`Thay toàn bộ nội dung "${s.project.name}" bằng thiết kế "${v.dir.name}"? Có thể hoàn tác bằng ⌘Z.`, 'Thay', false))) return;
      if (get().variant !== 'desktop') A.setVariant('desktop');
      A.commit(v.doc);
      A.patchProject({ brand, fields: v.dir.fields, mobile: v.mobile ?? null });
      set({ selection: [], modal: null });
      await land(s.project.id);
      keptDesigns = [];
      toast(`Đã áp dụng "${v.dir.name}"${v.mobile ? ' (kèm bản mobile 375px)' : ''}. Bấm vào chữ, ảnh, icon để chỉnh.`, 'ok');
    } else {
      keptDesigns = [];
      close0();
      await A.newProject('blank', brand, v.dir.fields.campaignName || v.dir.name);
      A.commit(v.doc, false);
      A.patchProject({ fields: v.dir.fields, mobile: v.mobile ?? null });
      const pid = get().project?.id; if (pid) await land(pid);
      toast(`Đã tạo project từ "${v.dir.name}".`, 'ok');
    }
  };

  /** Images the composer worked with (site import, uploads, logo) belong to the project the variant lands in. */
  const tagForProject = (pid: string) => { const ids = [...form.imageIds, form.logoAssetId, form.logoLightAssetId].filter((x): x is string => !!x).filter((id) => !assets.get(id)?.project); if (ids.length) assets.tag(ids, { project: pid }); };
  const all = assets.all();
  const groups = groupAssets(all, { projectId: s.project?.id ?? null, usedIds: usedAssetIds(s.project), scope: 'all' });
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const PREVIEW = 12; // two rows per group until "+N"
  const groupSel = (ids: string[]) => { const allOn = ids.every((id) => form.imageIds.includes(id)); upd((f) => ({ imageIds: allOn ? f.imageIds.filter((x) => !ids.includes(x)) : [...f.imageIds, ...ids.filter((x) => !f.imageIds.includes(x))] })); };
  return (
    <Modal title="Dựng bằng AI" icon="sparkle" onClose={onClose} wide
      footer={<>
        {err && !busy && <span class="small" style={{ color: 'var(--err, #ff6b6b)', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={err}>Lỗi: {err}</span>}
        <span class="grow small muted">{transport === 'checking' ? 'Đang kiểm tra AI…' : transport === 'key' ? 'Dùng API key của bạn' : transport === 'relay' ? 'Dùng qua relay' : transport === 'sample' ? 'Dùng Claude của claude.ai' : (relayUp ? 'Relay có AI nhưng bạn chưa đăng nhập' : 'Chưa có AI: vào Cài đặt → AI')}</span>
        {transport === null ? <>{relayUp && <Btn kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập relay để dùng AI</Btn>}<a class="btn sm" href="https://claude.ai/artifact/9SNPduXknZra6ckgXh3WCG" target="_blank" rel="noopener">Mở bản claude.ai (AI sẵn)</a><Btn kind="ghost" onClick={() => set({ modal: 'settings' })}>Dán API key</Btn></> : null}
        {busy && mode === 'design' && <Btn kind="ghost" onClick={() => { abort.current?.abort(); }}>Dừng</Btn>}
        <Btn kind="primary" icon="sparkle" disabled={busy || transport === 'checking' || transport === null} onClick={run}>{busy ? (mode === 'design' ? 'Đang thiết kế…' : 'Đang dựng 3 phương án…') : (variants.length || designs.length) ? 'Làm lại' : mode === 'design' ? 'Thiết kế 3 phương án' : 'Dựng 3 phương án'}</Btn>
      </>}>
      <div class="ai-mode">
        <button class={`ai-mode-opt ${mode === 'design' ? 'on' : ''}`} onClick={() => pickMode('design')}>
          <b><Icon name="sparkle" size={13} /> Thiết kế tự do <span class="chip on">mới</span></b>
          <span>Claude thiết kế như một art director: bố cục riêng, chữ lớn, gradient, đồ hoạ SVG, icon, sticker, hoạt ảnh. Bạn xem email được vẽ trực tiếp, rồi creative director AI soát lại trên bản render. Mọi thứ thành layer chỉnh được.</span>
        </button>
        <button class={`ai-mode-opt ${mode === 'blocks' ? 'on' : ''}`} onClick={() => pickMode('blocks')}>
          <b><Icon name="blocks" size={13} /> Ghép block Phloem</b>
          <span>Nhanh hơn, ít tốn hơn: AI chọn và điền các block mẫu có sẵn.</span>
        </button>
      </div>
      {mode === 'design' && <label class="row small" style={{ gap: 8, cursor: 'pointer' }}><input type="checkbox" checked={review} onChange={(e) => setReview((e.target as HTMLInputElement).checked)} /><span>Creative director soát và làm đẹp thêm một vòng trên bản render <span class="muted">(đẹp hơn: khoảng 8–10 phút cho 3 phương án, tắt thì khoảng 5 phút)</span></span></label>}
      {clientId && <HouseCard house={house} on={useHouse} onToggle={setUseHouse} />}
      <div class="small muted">Dán link website: AI tự vào xem, lấy logo, màu, font, ảnh thật và giọng văn. Thêm ảnh và nội dung thô nếu có.</div>
      <div class="card glow">
        <div class="row"><Icon name="external" style={{ color: 'var(--neon)' }} /><b class="grow">Website thương hiệu</b>{form.site && <span class="chip on">đã đọc {form.site.siteName || form.site.title}</span>}</div>
        <div class="row">
          <div class="grow"><TextInput value={form.website || ''} mono placeholder="https://tenmien.com" onInput={(v) => upd({ website: v })} onCommit={(v) => upd({ website: v })} /></div>
          <Btn kind="primary" sm icon="sparkle" disabled={!!siteBusy || !(form.website || '').trim()} onClick={analyze}>{siteBusy || 'AI đọc web'}</Btn>
        </div>
        {siteErr && <div class="check err"><span class="lv">LỖI</span><span class="m">{siteErr}</span>{/đăng nhập/i.test(siteErr) && <Btn sm kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập</Btn>}</div>}
        {form.site && (
          <div class="row wrap" style={{ alignItems: 'center', gap: 10 }}>
            {form.logoAssetId && assets.url(form.logoAssetId) ? <img src={assets.url(form.logoAssetId)} alt="" style={{ height: 28, maxWidth: 120, objectFit: 'contain', background: '#fff', borderRadius: 6, padding: '2px 6px' }} /> : null}
            <span class="row" style={{ gap: 4 }} title={`Primary ${form.webBrand?.primary} · Accent ${form.webBrand?.accent} (từ token CSS / logo / theme-color / nút) · các màu khác trong CSS`}>
              {form.webBrand?.primary && <i title={`Primary ${form.webBrand.primary}`} style={{ width: 22, height: 22, borderRadius: '50%', background: form.webBrand.primary, border: '2px solid var(--neon)', display: 'inline-block' }} />}
              {form.webBrand?.accent && <i title={`Accent ${form.webBrand.accent}`} style={{ width: 22, height: 22, borderRadius: '50%', background: form.webBrand.accent, border: '2px solid var(--neon-line)', display: 'inline-block' }} />}
              {form.site.colors.filter((c) => c.hex !== form.webBrand?.primary && c.hex !== form.webBrand?.accent).slice(0, 5).map((c) => <i key={c.hex} title={c.hex} style={{ width: 16, height: 16, borderRadius: '50%', background: c.hex, border: '1px solid rgba(255,255,255,.2)', display: 'inline-block', opacity: 0.8 }} />)}
            </span>
            <span class="small muted">{form.site.fonts.map((f) => f.name).slice(0, 3).join(' · ') || 'font mặc định'}</span>
            <span class="small muted">· {form.site.images.length} ảnh · {form.site.headings.length} tiêu đề{form.site.products?.length ? ` · ${form.site.products.length} sản phẩm (${form.site.platform})` : ''}</span>
          </div>
        )}
      </div>
      {form.products && form.products.length > 0 && <div class="check info"><span class="lv">KHO</span><span class="m">{form.products.length} sản phẩm từ kho hàng sẽ là trọng tâm email: {form.products.slice(0, 4).map((p) => p.name).join(', ')}{form.products.length > 4 ? '…' : ''}. <a onClick={() => upd({ products: [] })} style={{ cursor: 'pointer', textDecoration: 'underline' }}>Bỏ</a></span></div>}
      <div class="grid3">
        <Field label="Loại email"><Select value={form.goal} options={GOALS} onChange={(v) => upd({ goal: v })} /></Field>
        <Field label="Thương hiệu"><TextInput value={form.brandName} placeholder="Terra" onCommit={(v) => upd({ brandName: v })} onInput={(v) => upd({ brandName: v })} /></Field>
        <Field label="Logo" hint="PNG nền trong, thay vào nav/footer">
          <div class="row">
            <div style={{ width: 64, height: 28, borderRadius: 6, background: 'repeating-conic-gradient(#1a2a1e 0 25%, #0c120e 0 50%) 0 0 / 10px 10px', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
              {form.logoAssetId && assets.url(form.logoAssetId) ? <img src={assets.url(form.logoAssetId)} alt="" style={{ maxWidth: '90%', maxHeight: '80%', objectFit: 'contain' }} /> : <span class="dim" style={{ fontSize: 10 }}>chữ</span>}
            </div>
            <Btn sm icon="upload" onClick={() => logoFile.current?.click()}>Tải logo</Btn>
            {form.logoAssetId && <Btn sm kind="ghost" onClick={() => upd({ logoAssetId: null, logoLightAssetId: null })}>Bỏ</Btn>}
            <input ref={logoFile} type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp" style={{ display: 'none' }} onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void pickLogo(f); (e.target as HTMLInputElement).value = ''; }} />
          </div>
        </Field>
      </div>
      <div class="grid3">
        <Field label="Giọng điệu"><Select value={form.tone} options={TONES} onChange={(v) => upd({ tone: v })} /></Field>
        <Field label="Ngôn ngữ copy"><Select value={form.language || 'auto'} options={[{ v: 'auto', label: 'Theo website / nội dung' }, { v: 'vi', label: 'Tiếng Việt' }, { v: 'en', label: 'English' }]} onChange={(v) => upd({ language: v as GenInput['language'] })} /></Field>
        <Field label="Xu hướng thiết kế" hint="2026"><Select value={form.trend || ''} options={TREND_OPTIONS.map((t) => ({ v: t.id, label: t.label }))} onChange={(v) => upd({ trend: v })} /></Field>
      </div>
      <Field label="Email này để làm gì? Gửi cho ai?" hint="brief"><TextArea rows={2} value={form.brief} placeholder="Sale cuối tuần 30% cho khách cũ, muốn họ quay lại mua đồ gốm trước Tết…" onCommit={(v) => upd({ brief: v })} onInput={(v) => upd({ brief: v })} /></Field>
      <Field label="Nội dung thô" hint="tiêu đề, sản phẩm, giá, link, ngày, chính sách… dán thoải mái"><TextArea rows={6} value={form.content} placeholder={'Cốc men tro 300ml 245.000₫ → 171.000₫ https://terra.vn/p/coc\nĐĩa ăn 24cm 320.000₫ → 224.000₫\nFreeship toàn quốc, đổi trả 30 ngày\nMã TERRA30 đến hết Chủ nhật 19/10'} onCommit={(v) => upd({ content: v })} onInput={(v) => upd({ content: v })} /></Field>
      <Eyebrow action={{ label: '+ Tải ảnh', onClick: () => file.current?.click() }}>Ảnh ({form.imageIds.length} đã chọn cho AI, tối đa 30 ảnh được xem trước) · dán Ctrl+V hoặc kéo thả vào đây</Eyebrow>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files); }}>
      <input ref={file} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={async (e) => { const fs = Array.from((e.target as HTMLInputElement).files || []); const ids: string[] = []; for (const f of fs) { try { ids.push((await assets.add(f, undefined, { src: { kind: 'upload' } })).id); } catch { /* skip */ } } upd((f) => ({ imageIds: [...f.imageIds, ...ids] })); (e.target as HTMLInputElement).value = ''; }} />
      {all.length ? groups.map((g) => {
        const ids = g.items.map((a) => a.id); const on = ids.filter((id) => form.imageIds.includes(id)).length;
        return (
          <div key={g.key} class="section" style={{ gap: 6 }}>
            <div class="row small"><b class="grow" style={{ color: on ? 'var(--neon)' : 'var(--muted)' }}>{g.label} · {on}/{ids.length} chọn</b><button class="chip" style={{ cursor: 'pointer' }} onClick={() => groupSel(ids)}>{on === ids.length ? 'Bỏ chọn nhóm' : 'Chọn cả nhóm'}</button></div>
            <div class="asset-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
              {(expandedGroups[g.key] ? g.items : g.items.slice(0, PREVIEW)).map((a) => (
                <div key={a.id} class={`asset ${form.imageIds.includes(a.id) ? 'on' : ''}`} style={form.imageIds.includes(a.id) ? { outline: '2px solid var(--neon)', outlineOffset: -2 } : {}} title={`${a.name}${a.src?.page ? ` · ${a.src.page}` : ''} · ${a.w}×${a.h}`} onClick={() => toggleImg(a.id)}>
                  {assets.url(a.id) ? <img src={assets.url(a.id)} alt="" /> : null}
                  {form.imageIds.includes(a.id) && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--neon)', color: 'var(--neon-ink)', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{form.imageIds.indexOf(a.id) + 1}</span>}
                  {pageLabel(a) && <div class="nm">{pageLabel(a)}</div>}
                </div>
              ))}
              {g.items.length > PREVIEW && !expandedGroups[g.key] && <button class="asset more" title="Xem thêm" onClick={() => setExpandedGroups((x) => ({ ...x, [g.key]: true }))}>+{g.items.length - PREVIEW}</button>}
              {g.items.length > PREVIEW && expandedGroups[g.key] && <button class="asset more" title="Thu gọn" onClick={() => setExpandedGroups((x) => ({ ...x, [g.key]: false }))}>−</button>}
            </div>
          </div>
        );
      }) : <div class="dropzone" onClick={() => file.current?.click()}><Icon name="upload" /> <div>Chưa có ảnh. Dán (Ctrl+V), kéo thả, hoặc bấm để tải lên. Bỏ qua cũng được: AI sẽ để placeholder.</div></div>}
      </div>
      <Eyebrow>Bảng màu</Eyebrow>
      <div class="presets">
        <button class={`preset ${form.palette === 'auto' ? 'on' : ''}`} onClick={() => upd({ palette: 'auto' })}><Icon name="sparkle" size={14} />AI chọn</button>
        {form.webBrand && <button class={`preset ${form.palette === 'Web' ? 'on' : ''}`} onClick={() => upd({ palette: 'Web' })} title="Màu lấy từ website"><i style={{ background: form.webBrand.primary, borderColor: form.webBrand.accent }} />Web</button>}
        {BRAND_PRESETS.map((p) => <button key={p.name} class={`preset ${form.palette === p.name ? 'on' : ''}`} onClick={() => upd({ palette: p.name })}><i style={{ background: p.brand.primary, borderColor: p.brand.bg }} />{p.name}</button>)}
      </div>
      <div ref={resultsRef} />
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span>{/đăng nhập/i.test(err) && <Btn sm kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập</Btn>}</div>}
      {busy && mode === 'blocks' && <div class="card"><div class="row"><Icon name="bolt" style={{ color: 'var(--neon)' }} /><b class="grow">{stage === 'refine' ? 'Creative director AI đang duyệt và sửa lại 3 phương án…' : 'AI đang đọc nội dung và ảnh, dựng 3 phương án…'}</b></div><div class="progress"><i class="indet" /></div><div class="dim small">Thường mất 20–60 giây. Kết quả là block Phloem thật, không phải ảnh mockup.</div></div>}
      {busy && mode === 'design' && !designs.length && <div class="card"><div class="row"><Icon name="bolt" style={{ color: 'var(--neon)' }} /><b class="grow">{stage || 'Đang bắt đầu…'}</b></div><div class="progress"><i class="indet" /></div><div class="dim small">Bước lên ý tưởng mất khoảng 20–40 giây, sau đó 3 email được vẽ cùng lúc, bạn xem trực tiếp bên dưới.</div></div>}
      {designs.length > 0 && (
        <>
          <Eyebrow>{designs.filter((d) => d.stage === 'ready').length}/{designs.length} thiết kế xong</Eyebrow>
          <div class="tpl-grid ai-variants">
            {designs.map((v, i) => (
              <div key={i} class={`tpl design-card st-${v.stage}`}>
                <div class="pv">
                  {v.thumb ? <img src={v.thumb} alt="" /> : v.html ? <LiveHtml html={v.html} ids={[...new Set([...form.imageIds, form.logoAssetId, form.logoLightAssetId].filter((x): x is string => !!x))]} /> : <div class="pv-wait"><div class="progress"><i class="indet" /></div></div>}
                  <span class={`stage-chip st-${v.stage}`}>{v.stage === 'queued' ? 'Đang chờ' : v.stage === 'drawing' ? 'Đang vẽ trực tiếp…' : v.stage === 'converting' ? 'Đang tách layer…' : v.stage === 'reviewing' ? 'Creative director đang soát…' : v.stage === 'ready' ? (v.reviewed ? 'Xong · đã soát' : 'Xong') : 'Lỗi'}</span>
                </div>
                <div class="meta">
                  <div class="row"><div class="nm grow">{v.dir.name}</div><span class="chip">{v.dir.aesthetic}</span></div>
                  <div class="row" style={{ gap: 4 }}>{Object.values(v.dir.palette).slice(0, 6).map((c, k) => <i key={k} title={c} style={{ width: 14, height: 14, borderRadius: '50%', background: c, border: '1px solid rgba(255,255,255,.18)', display: 'inline-block' }} />)}<span class="ds mono" style={{ marginLeft: 6 }}>{v.dir.headingFont} + {v.dir.bodyFont}</span></div>
                  <div class="ds">{v.dir.why}</div>
                  {v.error && <div class="check err"><span class="lv">LỖI</span><span class="m">{v.error}</span><Btn sm kind="primary" icon="sparkle" disabled={redrawing !== null || busy} onClick={() => void redraw(i)}>{redrawing === i ? 'Đang vẽ lại…' : 'Vẽ lại phương án này'}</Btn></div>}
                  {v.warnings && v.warnings.length > 0 && <div class="ds muted">{v.warnings.slice(0, 2).join(' · ')}</div>}
                  <div class="row" style={{ marginTop: 8 }}><Btn sm icon="eye" disabled={!v.doc} onClick={() => { setPvMode('desktop'); setPreview(i); }}>Xem thử</Btn><Btn sm kind="primary" block disabled={!v.doc} onClick={() => void useDesign(v)}>{!v.doc ? 'Đang vẽ…' : s.project ? 'Dùng, thay nội dung hiện tại' : 'Tạo project từ thiết kế này'}</Btn></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {variants.length > 0 && (
        <>
          <Eyebrow>3 phương án</Eyebrow>
          <div class="tpl-grid ai-variants">
            {variants.map((v, i) => (
              <div key={i} class="tpl">
                <div class="pv">{thumbs[i] ? <img src={thumbs[i]} alt="" /> : null}</div>
                <div class="meta">
                  <div class="row"><div class="nm grow">{v.name}</div><span class="chip">{v.palette}</span>{v.vibe && <span class="chip on">{v.vibe}</span>}</div>
                  {(v.headingFont || v.bodyFont) && <div class="ds mono">{[v.headingFont, v.bodyFont].filter(Boolean).join(' + ')}</div>}
                  <div class="ds">{v.why}</div>
                  <div class="ds mono" style={{ marginTop: 4 }}>{v.blocks.map((b) => b.kind).join(' · ')}</div>
                  <div class="row" style={{ marginTop: 8 }}><Btn sm icon="eye" onClick={() => { setPvMode('desktop'); setPreview(i); }}>Xem thử</Btn><Btn sm kind="primary" block onClick={() => use(v)}>{s.project ? 'Dùng, thay nội dung hiện tại' : 'Tạo project từ mẫu này'}</Btn></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {preview !== null && mode === 'design' && designs[preview] && (() => { const dv = designs[preview]; return (
        <div class="pv-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div class="pv-panel">
            <div class="pv-head">
              <Btn sm icon="chevron" title="Phương án trước (←)" onClick={() => setPreview((preview + designs.length - 1) % designs.length)} />
              <div class="grow"><b>{dv.dir.name}</b> <span class="chip">{preview + 1}/{designs.length}</span> <span class="chip">{dv.dir.aesthetic}</span><div class="dim small">{dv.dir.concept}</div></div>
              <Seg value={pvMode} options={[{ v: 'desktop', label: 'Desktop 600' }, { v: 'mobile', label: dv.mobile ? 'Mobile 375' : 'Mobile (tự co)' }]} onChange={(v) => setPvMode(v)} />
              <Btn sm icon="chevron" title="Phương án sau (→)" onClick={() => setPreview((preview + 1) % designs.length)} />
              <Btn sm icon="close" title="Đóng (Esc)" onClick={() => setPreview(null)} />
            </div>
            <div class="pv-body">{pvUrl ? <img src={pvUrl} alt="" style={{ width: pvMode === 'mobile' ? 375 : 600 }} /> : <div class="dim">Đang vẽ…</div>}</div>
            <div class="pv-foot">
              <span class="grow small muted">Subject: <b>{dv.dir.fields.subject || '—'}</b>{dv.dir.fields.preheader ? ` · ${dv.dir.fields.preheader}` : ''}</span>
              <Btn onClick={() => setPreview(null)}>Đóng</Btn>
              <Btn kind="primary" icon="check" disabled={!dv.doc} onClick={() => { setPreview(null); void useDesign(dv); }}>{s.project ? 'Dùng, thay nội dung hiện tại' : 'Dùng thiết kế này'}</Btn>
            </div>
          </div>
        </div>); })()}
      {preview !== null && mode === 'blocks' && variants[preview] && (
        <div class="pv-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null); }}>
          <div class="pv-panel">
            <div class="pv-head">
              <Btn sm icon="chevron" title="Phương án trước (←)" onClick={() => setPreview((preview + variants.length - 1) % variants.length)} />
              <div class="grow"><b>{variants[preview].name}</b> <span class="chip">{preview + 1}/{variants.length}</span> <span class="chip">{variants[preview].palette}</span> {variants[preview].vibe && <span class="chip on">{variants[preview].vibe}</span>}<div class="dim small">{variants[preview].why}</div></div>
              <Seg value={pvMode} options={[{ v: 'desktop', label: 'Desktop 600' }, { v: 'mobile', label: 'Mobile 375' }]} onChange={(v) => setPvMode(v)} />
              <Btn sm icon="chevron" title="Phương án sau (→)" onClick={() => setPreview((preview + 1) % variants.length)} />
              <Btn sm icon="close" title="Đóng (Esc)" onClick={() => setPreview(null)} />
            </div>
            <div class="pv-body">{pvUrl ? <img src={pvUrl} alt="" style={{ width: pvMode === 'mobile' ? 375 : 600 }} /> : <div class="dim">Đang vẽ…</div>}</div>
            <div class="pv-foot">
              <span class="grow small muted">Subject: <b>{variants[preview].fields.subject || '—'}</b>{variants[preview].fields.preheader ? ` · ${variants[preview].fields.preheader}` : ''}</span>
              <Btn onClick={() => setPreview(null)}>Đóng</Btn>
              <Btn kind="primary" icon="check" onClick={() => { const v = variants[preview]; setPreview(null); void use(v); }}>{s.project ? 'Dùng, thay nội dung hiện tại' : 'Dùng mẫu này'}</Btn>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/** The HTML being written, rendered live (scaled to the card): the design appears section by section as Claude types. */
function LiveHtml({ html, ids }: { html: string; ids: string[] }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0.4);
  useEffect(() => { const w = wrap.current; if (!w) return; const ro = new ResizeObserver(() => setK(w.clientWidth / 600)); ro.observe(w); return () => ro.disconnect(); }, []);
  useEffect(() => {
    const f = ref.current; if (!f) return;
    // partial HTML is fine: the browser closes open tags; scroll follows the newest section
    try { f.srcdoc = prepareHtml(html, new Set(ids), 600); } catch { /* mid-tag */ }
    f.onload = () => { try { if (f.contentDocument) capitalizeSentences(f.contentDocument, f.contentWindow); } catch { /* cross-origin */ } };
    const t = setTimeout(() => { try { const d = f.contentDocument; if (d) d.documentElement.scrollTop = Math.max(0, d.documentElement.scrollHeight - 1320); } catch { /* cross-origin */ } }, 300);
    return () => clearTimeout(t);
  }, [html]);
  return <div ref={wrap} class="live-html"><iframe ref={ref} sandbox="allow-same-origin" title="Đang vẽ" style={{ width: 600, height: 1320, transform: `scale(${k})` }} /></div>;
}

/** Which client style the AI will follow: brand book, past emails, type and colours, with a switch. */
function HouseCard({ house, on, onToggle }: { house: HouseStyle | null | undefined; on: boolean; onToggle: (v: boolean) => void }) {
  if (house === undefined) return <div class="card"><div class="small dim">Đang đọc phong cách khách hàng…</div></div>;
  if (!house) return null;
  const empty = !house.hasBook && !house.pastEmails;
  return (
    <div class={`card ${on && !empty ? 'glow' : ''}`}>
      <div class="row"><Icon name="palette" style={{ color: 'var(--neon)' }} /><b class="grow">Phong cách khách hàng · {house.name}</b>{!empty && <label class="row small" style={{ gap: 6, cursor: 'pointer' }}><input type="checkbox" checked={on} onChange={(e) => onToggle((e.target as HTMLInputElement).checked)} />Theo phong cách này</label>}</div>
      {empty ? <div class="small muted">Khách này chưa có bộ nhận diện hay mail cũ nào. Tạo bộ nhận diện ở Phloem MKT (Thương hiệu) hoặc cho AI đọc website bên dưới để mail đúng chất khách.</div> : (
        <div class="row wrap small" style={{ gap: 8 }}>
          {house.hasBook && <span class="chip on">bộ nhận diện</span>}
          {house.pastEmails > 0 && <span class="chip on">học từ {house.pastEmails} mail cũ{house.images.length ? ` (${house.images.length} ảnh)` : ''}</span>}
          {(house.fonts.heading || house.fonts.body) && <span class="chip">{[house.fonts.heading, house.fonts.body].filter(Boolean).join(' / ')}</span>}
          {[house.primary, house.accent].filter(Boolean).map((c) => <i key={c} title={c} style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: '1px solid var(--line-2)', display: 'inline-block' }} />)}
          <span class="dim">AI giữ màu, font, giọng văn, logo và chân mail của khách; ba phương án khác nhau ở ý tưởng, không khác thương hiệu.</span>
        </div>
      )}
    </div>
  );
}
