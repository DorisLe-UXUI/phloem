import { render } from 'preact';
import { App } from './ui/App';
import { ensureFonts } from './render/fonts';
import { assets } from './storage/assets';
import { refreshProjects, restoreSession } from './pipeline/actions';
import * as A from './pipeline/actions';
import { planSlices } from '../../src/shared/slicer';
import { docToNNode } from './model/toNNode';
import { exportDocSlices } from './render/exportSlices';
import { get, set } from './store';

ensureFonts(['Inter']);
void assets.ready.then(async () => {
  set({ settings: get().settings }); // persist defaults so the landing page sees the relay URL
  await restoreSession();
  await refreshProjects();
  const params = new URLSearchParams(location.search);
  const authParam = params.get('auth');
  if (authParam === 'login' || authParam === 'register') { history.replaceState(null, '', location.pathname); set({ modal: 'auth', authTab: authParam }); }
  const t = params.get('t');
  if (t) {
    const { TEMPLATES: T, templateBrand } = await import('./model/templates');
    const { BRAND_PRESETS, DEFAULT_BRAND } = await import('./model/types');
    const { newProject } = await import('./pipeline/actions');
    const def = T.find((x) => x.kind === t);
    if (def) { history.replaceState(null, '', location.pathname); await newProject(def.kind, templateBrand(def, DEFAULT_BRAND, BRAND_PRESETS)); }
  }
});
render(<App />, document.getElementById('root')!);

// Dev hook: window.__phloemExportThumbs() renders every template (desktop + mobile crop) and posts JPGs to the
// preview server, which saves them under landing/thumbs/ for the marketing page. Not used by the app itself.
import { TEMPLATES, makeTemplate, buildDoc, type BlockSpec } from './model/templates';
import { BRAND_PRESETS, DEFAULT_BRAND, type Doc } from './model/types';
import { htmlToDoc } from './ai/htmlToDoc';
import { polishDesign } from './pipeline/polish';
import { renderToCanvas } from './render/renderer';
import { animBlocks, makeMobile } from './model/ops';
import { finalizeSlices } from '../../src/ui/imageops';
(window as unknown as { __phloemExportThumbs?: (base?: string) => Promise<string[]> }).__phloemExportThumbs = async (base = '') => {
  const out: string[] = [];
  for (const t of TEMPLATES) {
    if (!t.blocks.length) continue;
    const brand = { ...DEFAULT_BRAND, ...(BRAND_PRESETS.find((p) => p.name === t.preset)?.brand || {}), ...(t.brand || {}) };
    ensureFonts([brand.fontFamily, brand.headingFamily]);
    await document.fonts.ready;
    const { doc } = makeTemplate(t.kind, brand);
    const desk = renderToCanvas({ ...doc, height: Math.min(doc.height, 1100) }, brand, assets, 0.8);
    const m = makeMobile(doc);
    const mob = renderToCanvas({ ...m, height: Math.min(m.height, 760) }, brand, assets, 1);
    for (const [name, canvas] of [[t.kind, desk], [`${t.kind}-m`, mob]] as const) {
      await fetch(`${base}/save-thumb`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, dataUrl: canvas.toDataURL('image/jpeg', 0.86) }) });
      out.push(name);
    }
  }
  return out;
};

// Dev hook: window.__phloemExportGeneric() renders brand-neutral sample emails ("BRAND", generic copy, placeholder art)
// for the landing page, so the marketing site never shows a real brand or anyone's photos.
(window as unknown as { __phloemExportGeneric?: (base?: string, images?: Record<string, string>) => Promise<string[]> }).__phloemExportGeneric = async (base = '', images: Record<string, string> = {}) => {
  // '@key' in any image slot is replaced by the asset imported from images[key] (same-origin or relay-proxied URL).
  const ids: Record<string, string> = {};
  for (const [k, url] of Object.entries(images)) { try { const r = await fetch(url); const blob = await r.blob(); ids[k] = (await assets.add(blob, k)).id; } catch { /* skip */ } }
  const im = (k: string) => ids[k] ?? null;
  await Promise.all(Object.values(ids).map((id) => new Promise<void>((res) => { if (assets.image(id)) return res(); const off = assets.onChange(() => { if (assets.image(id)) { off(); res(); } }); setTimeout(() => { off(); res(); }, 8000); })));
  const L = (label: string) => ({ label, url: '#' });
  const foot = { kind: 'footer' as const, content: { brand: 'BRAND', address: 'Địa chỉ công ty · Thành phố', unsubscribeUrl: '#', preferencesUrl: '#', social: [L('Instagram'), L('Facebook'), L('TikTok')] } };
  const nav = (links: string[]) => ({ kind: 'nav' as const, content: { brand: 'BRAND', links: links.map(L) } });
  const SETS: { name: string; preset: string; vibe: 'clean' | 'playful' | 'bold' | 'luxury' | 'editorial'; specs: BlockSpec[] }[] = [
    { name: 'generic-promo', preset: 'Coral', vibe: 'playful', specs: [
      nav(['Sản phẩm', 'Bộ sưu tập', 'Về chúng tôi']),
      { kind: 'hero-band', content: { eyebrow: 'BỘ SƯU TẬP MỚI', headline: 'Tiêu đề email nổi bật của bạn', subhead: 'Một đoạn mô tả ngắn, hai dòng, nói về điều người đọc nhận được khi bấm vào.', button: L('Mua ngay'), image: im('promo-hero'), imageAlt: 'Ảnh bộ sưu tập' } },
      { kind: 'products-3', content: { heading: 'Sản phẩm nổi bật', items: [{ name: 'Sản phẩm 1', price: '199.000đ', url: '#', image: im('promo-1') }, { name: 'Sản phẩm 2', price: '249.000đ', badge: '-20%', url: '#', image: im('promo-2') }, { name: 'Sản phẩm 3', price: '299.000đ', url: '#', image: im('promo-3') }] } },
      { kind: 'quote', content: { quote: 'Một câu khách hàng nói về bạn, ngắn gọn và thật.', author: 'Tên khách hàng' } },
      { kind: 'cta-wide', content: { heading: 'Sẵn sàng chưa?', body: 'Ưu đãi kết thúc Chủ nhật này.', button: L('Xem bộ sưu tập') } },
      foot] },
    { name: 'generic-news', preset: 'Forest', vibe: 'editorial', specs: [
      nav(['Bài viết', 'Chủ đề', 'Lưu trữ']),
      { kind: 'hero', content: { eyebrow: 'BẢN TIN THÁNG', headline: 'Ba điều đáng đọc tuần này', subhead: 'Tóm tắt ngắn gọn những gì đang diễn ra và vì sao nó quan trọng với bạn.', button: L('Đọc tiếp'), image: im('news-hero'), imageAlt: 'Ảnh bản tin' } },
      { kind: 'articles', content: { items: [{ name: 'Bài viết 1: tiêu đề ngắn gọn, hai dòng', badge: '01', url: '#', image: im('news-1') }, { name: 'Bài viết 2: tiêu đề ngắn gọn, hai dòng', badge: '02', url: '#', image: im('news-2') }, { name: 'Bài viết 3: tiêu đề ngắn gọn, hai dòng', badge: '03', url: '#', image: im('news-3') }] } },
      { kind: 'text', content: { eyebrow: 'TỪ ĐỘI NGŨ', heading: 'Cảm ơn bạn đã đọc', body: 'Trả lời email này nếu bạn muốn góp ý. Chúng tôi đọc từng thư.' } },
      foot] },
    { name: 'generic-launch', preset: 'Midnight', vibe: 'bold', specs: [
      nav(['Tính năng', 'Bảng giá', 'Hỗ trợ']),
      { kind: 'hero-center', content: { style: 'gradient', eyebrow: 'PHIÊN BẢN 2.0', headline: 'Ra mắt tính năng mới', subhead: 'Nhanh hơn, gọn hơn, và làm được việc bạn chờ từ lâu.', button: L('Khám phá ngay'), image: im('launch-hero'), imageAlt: 'Ảnh sản phẩm' } },
      { kind: 'stat-tiles', content: { stats: [{ value: '+320%', label: 'Tăng trưởng' }, { value: '24k', label: 'Người dùng' }, { value: '4.9★', label: 'Đánh giá' }] } },
      { kind: 'feature-row', content: { heading: 'Tính năng nổi bật', body: 'Mô tả ngắn về tính năng, lợi ích cụ thể cho người dùng.', link: L('Tìm hiểu thêm'), image: im('launch-feature') } },
      { kind: 'cta', content: { heading: 'Dùng thử miễn phí 14 ngày', body: 'Không cần thẻ.', button: L('Bắt đầu') } },
      foot] },
    { name: 'generic-drop', preset: 'Neon', vibe: 'bold', specs: [
      nav(['Drop', 'Lookbook', 'Cửa hàng']),
      { kind: 'hero-overlay', content: { eyebrow: 'DROP 01', headline: 'Số lượng giới hạn', subhead: 'Mở bán 20:00 tối nay. Hết là hết.', button: L('Mua ngay'), image: im('drop-hero'), imageAlt: 'Ảnh drop' } },
      { kind: 'countdown', content: { heading: 'Kết thúc sau' } },
      { kind: 'products-2', content: { items: [{ name: 'Mẫu 01', price: '890.000đ', url: '#', image: im('drop-1') }, { name: 'Mẫu 02', price: '990.000đ', oldPrice: '1.190.000đ', badge: 'MỚI', url: '#', image: im('drop-2') }] } },
      foot] },
  ];
  const out: string[] = [];
  for (const set of SETS) {
    const brand = { ...DEFAULT_BRAND, name: 'BRAND', ...(BRAND_PRESETS.find((p) => p.name === set.preset)?.brand || {}), vibe: set.vibe, headingFamily: set.vibe === 'playful' ? 'Baloo 2' : set.vibe === 'bold' ? 'Unbounded' : set.vibe === 'editorial' ? 'Lora' : 'Inter' };
    ensureFonts([brand.fontFamily, brand.headingFamily]);
    await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 4000))]);
    const doc = buildDoc(set.specs, brand);
    const desk = renderToCanvas({ ...doc, height: Math.min(doc.height, 1100) }, brand, assets, 0.8);
    const m = makeMobile(doc);
    const mob = renderToCanvas({ ...m, height: Math.min(m.height, 760) }, brand, assets, 1);
    for (const [name, canvas] of [[set.name, desk], [`${set.name}-m`, mob]] as const) {
      await fetch(`${base}/save-thumb`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, dataUrl: canvas.toDataURL('image/jpeg', 0.88) }) });
      out.push(name);
    }
  }
  return out;
};

// Dev/testing hook: store + actions + assets, used by browser checks.
// back online → push what was saved offline and pull what others changed
window.addEventListener('online', () => { void A.syncNow().catch(() => { /* reported in the sync chip */ }); });

(window as unknown as { __phloemDev?: unknown }).__phloemDev = {
  polish: (d: Doc) => polishDesign(d, get().project!.brand),
  /** The open doc rendered as the export will see it (data URL). */
  renderPng: (scale = 1) => { const p = get().project!; const d = get().variant === 'mobile' && p.mobile ? p.mobile : p.desktop; return renderToCanvas(d, p.brand, assets, scale).toDataURL('image/png'); },
  /** HTML → layers (AI designer converter), for browser checks. */
  htmlToDoc: (html: string, width = 600) => htmlToDoc(html, { width, validIds: new Set(assets.all().map((a) => a.id)), temp: false }),
  get, set, A, assets,
  /** Export the open project's desktop doc as slices (PNG, animated regions as GIF) without uploading. */
  exportSlices: async (fps = 10, format: 'PNG' | 'JPG' = 'PNG') => { const p = get().project!; const plan = planSlices(docToNNode(p.desktop, p.brand), { maxSliceHeight: get().settings.maxSliceHeight, mergeRows: get().settings.mergeRows, keep: animBlocks(p.desktop.nodes) }); const raw = await exportDocSlices(p.desktop, p.brand, plan, 2, undefined, fps); const slices = await finalizeSlices(raw, format, 85); return slices.map((x) => ({ key: x.key, format: x.format, kb: Math.round(x.bytes.length / 1024), w: x.w, h: x.h, url: x.format === 'GIF' ? URL.createObjectURL(new Blob([x.bytes as BlobPart], { type: 'image/gif' })) : undefined })); },
};
