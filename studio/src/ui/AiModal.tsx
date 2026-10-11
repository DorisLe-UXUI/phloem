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

export function AiModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [form, setForm] = useState<GenInput>(() => {
    const base: GenInput = { goal: 'promo', brandName: '', brief: '', content: '', tone: TONES[0].v, imageIds: [], palette: 'auto', website: '', site: null, webBrand: null, logoAssetId: null, logoLightAssetId: null, language: 'auto', products: [] };
    try { const saved = JSON.parse(localStorage.getItem(LS) || '{}') as Partial<GenInput>; return { ...base, ...saved, imageIds: [], site: null, logoAssetId: null, logoLightAssetId: null, products: [], palette: saved.palette === 'Web' ? 'auto' : (saved.palette ?? 'auto') }; } catch { return base; }
  });
  const [transport, setTransport] = useState<AiTransport | 'checking'>('checking');
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stage, setStage] = useState('');
  // Full-size preview of one variant before choosing it.
  const [preview, setPreview] = useState<number | null>(null);
  const [pvMode, setPvMode] = useState<'desktop' | 'mobile'>('desktop');
  const [pvUrl, setPvUrl] = useState('');
  useEffect(() => {
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
  }, [preview, pvMode, variants]);
  useEffect(() => {
    if (preview === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPreview(null); } if (e.key === 'ArrowRight') setPreview((p) => (p === null ? p : (p + 1) % variants.length)); if (e.key === 'ArrowLeft') setPreview((p) => (p === null ? p : (p + variants.length - 1) % variants.length)); };
    window.addEventListener('keydown', k, true); return () => window.removeEventListener('keydown', k, true);
  }, [preview, variants.length]);
  const [relayUp, setRelayUp] = useState(false);
  useEffect(() => { const u = (get().settings.relayUrl || '').replace(/\/$/, ''); if (!u) return; fetch(u + '/', { signal: AbortSignal.timeout(2500) }).then((r) => r.json()).then((j) => setRelayUp(!!j?.ai && !!j?.auth)).catch(() => setRelayUp(false)); }, [s.settings.relayUrl, s.user?.id]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [err, setErr] = useState('');
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
      const p: SiteProfile = await analyzeSite(site);
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
    setBusy(true); setErr(''); setVariants([]); setThumbs([]);
    try {
      let input = form;
      if ((form.website || '').trim() && !form.site) { // typed a website but never pressed "AI đọc web": read it first
        const r = await analyzeNow(); if (r) input = r;
      }
      await document.fonts.ready;
      const vs = await generateVariants(input, setStage);
      setVariants(vs);
      ensureFonts(vs.flatMap((v) => [v.headingFont || '', v.bodyFont || '']).filter(Boolean));
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
      const render = () => vs.map((v) => { const br = brandForVariant(v, baseBrand(), form.webBrand); try { return thumbnail(variantToDoc(v, br), br, assets, 320); } catch { return ''; } });
      setThumbs(render());
      setTimeout(() => setThumbs(render()), 2500); // once web fonts are in
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); setStage(''); }
  };

  const use = async (v: Variant) => {
    const brand: Brand = brandForVariant(v, baseBrand(), form.webBrand);
    ensureFonts([brand.headingFamily, brand.fontFamily]);
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
    const doc = variantToDoc(v, brand);
    if (s.project) {
      if (!(await ask(`Thay toàn bộ nội dung "${s.project.name}" bằng phương án "${v.name}"? Có thể hoàn tác bằng ⌘Z.`, 'Thay', false))) return;
      if (get().variant !== 'desktop') A.setVariant('desktop');
      A.commit(doc);
      A.patchProject({ brand, fields: v.fields, mobile: null });
      set({ selection: [], modal: null });
      tagForProject(s.project.id);
      toast(`Đã áp dụng "${v.name}". Chỉnh tiếp trên canvas.`, 'ok');
    } else {
      onClose();
      await A.newProject('blank', brand, v.fields.campaignName || v.name);
      A.commit(doc, false);
      A.patchProject({ fields: v.fields });
      const pid = get().project?.id; if (pid) tagForProject(pid);
      toast(`Đã tạo project từ "${v.name}".`, 'ok');
    }
  };

  /** Images the composer worked with (site import, uploads, logo) belong to the project the variant lands in. */
  const tagForProject = (pid: string) => { const ids = [...form.imageIds, form.logoAssetId, form.logoLightAssetId].filter((x): x is string => !!x).filter((id) => !assets.get(id)?.project); if (ids.length) assets.tag(ids, { project: pid }); };
  const all = assets.all();
  const groups = groupAssets(all, { projectId: s.project?.id ?? null, usedIds: usedAssetIds(s.project), scope: 'all' });
  const groupSel = (ids: string[]) => { const allOn = ids.every((id) => form.imageIds.includes(id)); upd((f) => ({ imageIds: allOn ? f.imageIds.filter((x) => !ids.includes(x)) : [...f.imageIds, ...ids.filter((x) => !f.imageIds.includes(x))] })); };
  return (
    <Modal title="Dựng bằng AI" icon="sparkle" onClose={onClose} wide
      footer={<>
        <span class="grow small muted">{transport === 'checking' ? 'Đang kiểm tra AI…' : transport === 'key' ? 'Dùng API key của bạn' : transport === 'relay' ? 'Dùng qua relay' : transport === 'sample' ? 'Dùng Claude của claude.ai' : (relayUp ? 'Relay có AI nhưng bạn chưa đăng nhập' : 'Chưa có AI: vào Cài đặt → AI')}</span>
        {transport === null ? <>{relayUp && <Btn kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập relay để dùng AI</Btn>}<a class="btn sm" href="https://claude.ai/artifact/9SNPduXknZra6ckgXh3WCG" target="_blank" rel="noopener">Mở bản claude.ai (AI sẵn)</a><Btn kind="ghost" onClick={() => set({ modal: 'settings' })}>Dán API key</Btn></> : null}
        <Btn kind="primary" icon="sparkle" disabled={busy || transport === 'checking' || transport === null} onClick={run}>{busy ? 'Đang dựng 3 phương án…' : variants.length ? 'Dựng lại' : 'Dựng 3 phương án'}</Btn>
      </>}>
      <div class="small muted">Dán link website: AI tự vào xem, lấy logo, màu, font, ảnh thật và giọng văn, nhận ra ngành để chọn bố cục riêng. Thêm ảnh và nội dung thô nếu có. Kết quả là 3 phương án khác nhau bằng block của Phloem, chọn một rồi chỉnh tiếp.</div>
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
        <div />
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
              {g.items.map((a) => (
                <div key={a.id} class={`asset ${form.imageIds.includes(a.id) ? 'on' : ''}`} style={form.imageIds.includes(a.id) ? { outline: '2px solid var(--neon)', outlineOffset: -2 } : {}} title={`${a.name}${a.src?.page ? ` · ${a.src.page}` : ''} · ${a.w}×${a.h}`} onClick={() => toggleImg(a.id)}>
                  {assets.url(a.id) ? <img src={assets.url(a.id)} alt="" /> : null}
                  {form.imageIds.includes(a.id) && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--neon)', color: 'var(--neon-ink)', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{form.imageIds.indexOf(a.id) + 1}</span>}
                  {pageLabel(a) && <div class="nm">{pageLabel(a)}</div>}
                </div>
              ))}
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
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span>{/đăng nhập/i.test(err) && <Btn sm kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập</Btn>}</div>}
      {busy && <div class="card"><div class="row"><Icon name="bolt" style={{ color: 'var(--neon)' }} /><b class="grow">{stage === 'refine' ? 'Creative director AI đang duyệt và sửa lại 3 phương án…' : 'AI đang đọc nội dung và ảnh, dựng 3 phương án…'}</b></div><div class="progress"><i class="indet" /></div><div class="dim small">Thường mất 20–60 giây. Kết quả là block Phloem thật, không phải ảnh mockup.</div></div>}
      {variants.length > 0 && (
        <>
          <Eyebrow>3 phương án</Eyebrow>
          <div class="tpl-grid">
            {variants.map((v, i) => (
              <div key={i} class="tpl">
                <div class="pv" style={{ aspectRatio: '3 / 3.2' }}>{thumbs[i] ? <img src={thumbs[i]} alt="" /> : null}</div>
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
      {preview !== null && variants[preview] && (
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
