// "Dựng bằng AI": images + copy in, three rendered variants out, pick one.
import { useEffect, useRef, useState } from 'preact/hooks';
import { BRAND_PRESETS, DEFAULT_BRAND, type Brand } from '../model/types';
import { thumbnail } from '../render/renderer';
import { assets } from '../storage/assets';
import { get, set, toast, useStore } from '../store';
import * as A from '../pipeline/actions';
import { brandForPalette, brandForVariant, generateVariants, variantToDoc, type GenInput, type Variant } from '../ai/generate';
import { ensureFonts } from '../render/fonts';
import { aiTransport, type AiTransport } from '../ai/client';
import { analyzeSite, brandFromSite, importSiteImages, type SiteProfile } from '../ai/site';
import { Btn, Eyebrow, Field, Modal, Select, TextArea, TextInput } from './components';
import { Icon } from './icons';
import { ask } from './confirm';

const GOALS = [
  { v: 'promo', label: 'Khuyến mãi / sale' }, { v: 'newsletter', label: 'Newsletter định kỳ' }, { v: 'launch', label: 'Ra mắt sản phẩm' },
  { v: 'welcome', label: 'Chào mừng người mới' }, { v: 'event', label: 'Mời sự kiện' }, { v: 'cart', label: 'Nhắc giỏ hàng' },
  { v: 'digest', label: 'Bản tin biên tập' }, { v: 'reengagement', label: 'Kéo khách quay lại' }, { v: 'other', label: 'Khác' },
];
const TONES = [{ v: 'thân thiện, gần gũi', label: 'Thân thiện' }, { v: 'sang trọng, tối giản', label: 'Sang trọng' }, { v: 'sôi nổi, thúc giục', label: 'Sôi nổi' }, { v: 'chuyên nghiệp, rõ ràng', label: 'Chuyên nghiệp' }];

const LS = 'phloem.ai.form';

export function AiModal({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const [form, setForm] = useState<GenInput>(() => {
    const base: GenInput = { goal: 'promo', brandName: '', brief: '', content: '', tone: TONES[0].v, imageIds: [], palette: 'auto', website: '', site: null, webBrand: null, logoAssetId: null, language: 'auto' };
    try { const saved = JSON.parse(localStorage.getItem(LS) || '{}') as Partial<GenInput>; return { ...base, ...saved, imageIds: [], site: null, logoAssetId: null, palette: saved.palette === 'Web' ? 'auto' : (saved.palette ?? 'auto') }; } catch { return base; }
  });
  const [transport, setTransport] = useState<AiTransport | 'checking'>('checking');
  const [busy, setBusy] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [err, setErr] = useState('');
  const [, bump] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const logoFile = useRef<HTMLInputElement>(null);
  const [siteBusy, setSiteBusy] = useState('');
  const [siteErr, setSiteErr] = useState('');
  useEffect(() => { void aiTransport().then(setTransport); return assets.onChange(() => bump((n) => n + 1)); }, []);
  const addFiles = async (list: FileList | File[]) => { const ids: string[] = []; for (const f of Array.from(list)) { if (!f.type.startsWith('image/')) continue; try { ids.push((await assets.add(f)).id); } catch { /* skip */ } } if (ids.length) { upd((f) => ({ imageIds: [...f.imageIds, ...ids] })); toast(`Đã thêm ${ids.length} ảnh.`, 'ok'); } };
  useEffect(() => {
    const h = (e: ClipboardEvent) => { const t = e.target as HTMLElement | null; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; const files = Array.from(e.clipboardData?.files || []); if (files.some((f) => f.type.startsWith('image/'))) { e.preventDefault(); void addFiles(files); } };
    window.addEventListener('paste', h); return () => window.removeEventListener('paste', h);
  }, []);
  const upd = (patch: Partial<GenInput> | ((f: GenInput) => Partial<GenInput>)) => setForm((f) => { const n = { ...f, ...(typeof patch === 'function' ? patch(f) : patch) }; try { localStorage.setItem(LS, JSON.stringify({ ...n, imageIds: [], site: null, logoAssetId: null })); } catch { /* ignore */ } return n; });
  const baseBrand = (): Brand => ({ ...DEFAULT_BRAND, ...(form.webBrand || {}), name: form.brandName || form.webBrand?.name || DEFAULT_BRAND.name, logoAssetId: form.logoAssetId ?? null });
  /** Read the website, import its images, update the form. Returns the updated form (or null on error). */
  const analyzeNow = async (): Promise<GenInput | null> => {
    setSiteErr(''); setSiteBusy('AI đang đọc trang…');
    try {
      const p: SiteProfile = await analyzeSite(form.website || '');
      const wb = brandFromSite(p);
      setSiteBusy('Đang tải logo và ảnh…');
      const got = await importSiteImages(p, 10, (d, t) => setSiteBusy(`Đang tải ảnh ${d}/${t}…`), !!form.logoAssetId);
      let next: GenInput | null = null;
      upd((f) => { next = { ...f, site: p, webBrand: wb, brandName: f.brandName || wb.name || '', logoAssetId: f.logoAssetId ?? got.logoId ?? null, imageIds: [...new Set([...f.imageIds, ...got.imageIds])], palette: 'Web' }; return next; });
      toast(`Đã đọc ${p.siteName || p.title}: ${p.colors.length} màu, ${p.fonts.length} font, ${got.imageIds.length} ảnh${got.logoId ? ', logo' : ''}${p.products?.length ? `, ${p.products.length} sản phẩm` : ''}.`, 'ok');
      return next;
    } catch (e) { setSiteErr((e as Error).message); return null; }
    finally { setSiteBusy(''); }
  };
  const analyze = () => { void analyzeNow(); };
  const pickLogo = async (f: File) => { try { const a = await assets.add(f, f.name || 'logo'); upd({ logoAssetId: a.id }); } catch (e) { toast((e as Error).message, 'err'); } };
  const toggleImg = (id: string) => upd({ imageIds: form.imageIds.includes(id) ? form.imageIds.filter((x) => x !== id) : [...form.imageIds, id] });

  const run = async () => {
    setBusy(true); setErr(''); setVariants([]); setThumbs([]);
    try {
      let input = form;
      if ((form.website || '').trim() && !form.site) { // typed a website but never pressed "AI đọc web": read it first
        const r = await analyzeNow(); if (r) input = r;
      }
      await document.fonts.ready;
      const vs = await generateVariants(input);
      setVariants(vs);
      ensureFonts(vs.flatMap((v) => [v.headingFont || '', v.bodyFont || '']).filter(Boolean));
      await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
      const render = () => vs.map((v) => { const br = brandForVariant(v, baseBrand(), form.webBrand); try { return thumbnail(variantToDoc(v, br), br, assets, 320); } catch { return ''; } });
      setThumbs(render());
      setTimeout(() => setThumbs(render()), 2500); // once web fonts are in
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
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
      toast(`Đã áp dụng "${v.name}". Chỉnh tiếp trên canvas.`, 'ok');
    } else {
      onClose();
      await A.newProject('blank', brand, v.fields.campaignName || v.name);
      A.commit(doc, false);
      A.patchProject({ fields: v.fields });
      toast(`Đã tạo project từ "${v.name}".`, 'ok');
    }
  };

  const all = assets.all();
  return (
    <Modal title="Dựng bằng AI" icon="sparkle" onClose={onClose} wide
      footer={<>
        <span class="grow small muted">{transport === 'checking' ? 'Đang kiểm tra AI…' : transport === 'key' ? 'Dùng API key của bạn' : transport === 'relay' ? 'Dùng qua relay' : transport === 'sample' ? 'Dùng Claude của claude.ai' : 'Chưa có AI: vào Cài đặt → AI'}</span>
        {transport === null ? <><a class="btn sm" href="https://claude.ai/artifact/9SNPduXknZra6ckgXh3WCG" target="_blank" rel="noopener">Mở bản claude.ai (AI sẵn)</a><Btn kind="ghost" onClick={() => set({ modal: 'settings' })}>Dán API key</Btn></> : null}
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
            <span class="row" style={{ gap: 4 }}>{form.site.colors.slice(0, 6).map((c) => <i key={c.hex} title={c.hex} style={{ width: 18, height: 18, borderRadius: '50%', background: c.hex, border: '1px solid rgba(255,255,255,.2)', display: 'inline-block' }} />)}</span>
            <span class="small muted">{form.site.fonts.map((f) => f.name).slice(0, 3).join(' · ') || 'font mặc định'}</span>
            <span class="small muted">· {form.site.images.length} ảnh · {form.site.headings.length} tiêu đề{form.site.products?.length ? ` · ${form.site.products.length} sản phẩm (${form.site.platform})` : ''}</span>
          </div>
        )}
      </div>
      <div class="grid3">
        <Field label="Loại email"><Select value={form.goal} options={GOALS} onChange={(v) => upd({ goal: v })} /></Field>
        <Field label="Thương hiệu"><TextInput value={form.brandName} placeholder="Terra" onCommit={(v) => upd({ brandName: v })} onInput={(v) => upd({ brandName: v })} /></Field>
        <Field label="Logo" hint="PNG nền trong, thay vào nav/footer">
          <div class="row">
            <div style={{ width: 64, height: 28, borderRadius: 6, background: 'repeating-conic-gradient(#1a2a1e 0 25%, #0c120e 0 50%) 0 0 / 10px 10px', display: 'grid', placeItems: 'center', overflow: 'hidden', flex: 'none' }}>
              {form.logoAssetId && assets.url(form.logoAssetId) ? <img src={assets.url(form.logoAssetId)} alt="" style={{ maxWidth: '90%', maxHeight: '80%', objectFit: 'contain' }} /> : <span class="dim" style={{ fontSize: 10 }}>chữ</span>}
            </div>
            <Btn sm icon="upload" onClick={() => logoFile.current?.click()}>Tải logo</Btn>
            {form.logoAssetId && <Btn sm kind="ghost" onClick={() => upd({ logoAssetId: null })}>Bỏ</Btn>}
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
      <Eyebrow action={{ label: '+ Tải ảnh', onClick: () => file.current?.click() }}>Ảnh ({form.imageIds.length} đã chọn) · dán Ctrl+V hoặc kéo thả vào đây</Eyebrow>
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) void addFiles(e.dataTransfer.files); }}>
      <input ref={file} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={async (e) => { const fs = Array.from((e.target as HTMLInputElement).files || []); const ids: string[] = []; for (const f of fs) { try { ids.push((await assets.add(f)).id); } catch { /* skip */ } } upd((f) => ({ imageIds: [...f.imageIds, ...ids] })); (e.target as HTMLInputElement).value = ''; }} />
      {all.length ? (
        <div class="asset-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          {all.map((a) => (
            <div key={a.id} class={`asset ${form.imageIds.includes(a.id) ? 'on' : ''}`} style={form.imageIds.includes(a.id) ? { outline: '2px solid var(--neon)', outlineOffset: -2 } : {}} title={a.name} onClick={() => toggleImg(a.id)}>
              {assets.url(a.id) ? <img src={assets.url(a.id)} alt="" /> : null}
              {form.imageIds.includes(a.id) && <span style={{ position: 'absolute', top: 4, left: 4, background: 'var(--neon)', color: 'var(--neon-ink)', borderRadius: 999, fontSize: 10, fontWeight: 700, padding: '1px 6px' }}>{form.imageIds.indexOf(a.id) + 1}</span>}
            </div>
          ))}
        </div>
      ) : <div class="dropzone" onClick={() => file.current?.click()}><Icon name="upload" /> <div>Chưa có ảnh. Dán (Ctrl+V), kéo thả, hoặc bấm để tải lên. Bỏ qua cũng được: AI sẽ để placeholder.</div></div>}
      </div>
      <Eyebrow>Bảng màu</Eyebrow>
      <div class="presets">
        <button class={`preset ${form.palette === 'auto' ? 'on' : ''}`} onClick={() => upd({ palette: 'auto' })}><Icon name="sparkle" size={14} />AI chọn</button>
        {form.webBrand && <button class={`preset ${form.palette === 'Web' ? 'on' : ''}`} onClick={() => upd({ palette: 'Web' })} title="Màu lấy từ website"><i style={{ background: form.webBrand.primary, borderColor: form.webBrand.accent }} />Web</button>}
        {BRAND_PRESETS.map((p) => <button key={p.name} class={`preset ${form.palette === p.name ? 'on' : ''}`} onClick={() => upd({ palette: p.name })}><i style={{ background: p.brand.primary, borderColor: p.brand.bg }} />{p.name}</button>)}
      </div>
      {err && <div class="check err"><span class="lv">LỖI</span><span class="m">{err}</span>{/đăng nhập/i.test(err) && <Btn sm kind="primary" onClick={() => set({ modal: 'auth', authTab: 'login' })}>Đăng nhập</Btn>}</div>}
      {busy && <div class="card"><div class="row"><Icon name="bolt" style={{ color: 'var(--neon)' }} /><b class="grow">AI đang đọc nội dung và ảnh, dựng 3 phương án…</b></div><div class="progress"><i class="indet" /></div><div class="dim small">Thường mất 20–60 giây. Kết quả là block Phloem thật, không phải ảnh mockup.</div></div>}
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
                  <div class="row" style={{ marginTop: 8 }}><Btn sm kind="primary" block onClick={() => use(v)}>{s.project ? 'Dùng, thay nội dung hiện tại' : 'Tạo project từ mẫu này'}</Btn></div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
