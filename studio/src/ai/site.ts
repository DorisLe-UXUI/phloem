// Website → brand profile for the AI composer: the relay reads the page (logo, colours, fonts, headings, images),
// this module turns that into a Brand, imports the images as assets, and writes the summary the prompt uses.
import type { Brand } from '../model/types';
import { FONTS } from '../model/types';
import { assets } from '../storage/assets';
import { get } from '../store';
import { getSession, expired } from '../auth/core';

export interface SiteImage { url: string; alt: string; w: number; h: number; page?: string; bg?: boolean }
export interface SitePage { url: string; path: string; title: string; headings: string[]; text: string }
export interface SiteProfile {
  url: string; title: string; lang: string; siteName: string; description: string; themeColor: string;
  logo: string; icon: string; ogImage: string; images: SiteImage[]; headings: string[]; nav: string[]; buttons: string[]; text: string;
  /** Inline SVG wordmark from the site header (when the logo is not an <img>). */
  logoSvg?: string;
  colors: { hex: string; n: number }[]; darks: string[]; lights: string[]; fonts: { name: string; n: number }[];
  platform?: string;
  products?: SiteProduct[];
  /** Internal pages the relay also read (work, products, about…). */
  pages?: SitePage[];
}
export interface SiteProduct { name: string; price: string; compareAt: string; type: string; url: string; image: string; assetId?: string | null }

function relay(): { url: string; headers: Record<string, string> } | null {
  const s = get().settings; const url = (s.relayUrl || '').replace(/\/$/, '');
  if (!url) return null;
  const ses = getSession();
  return { url, headers: { ...(ses?.mode === 'relay' ? { Authorization: `Bearer ${ses.token}` } : {}), ...(s.relayToken ? { 'X-Phloem-Token': s.relayToken } : {}) } };
}

export async function analyzeSite(site: string): Promise<SiteProfile> {
  const r = relay();
  if (!r) throw new Error('Cần relay để đọc website: Cài đặt → Relay URL (npm run relay).');
  let url = site.trim(); if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let res: Response;
  try { res = await fetch(`${r.url}/site`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...r.headers }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Không gọi được relay. Relay có đang chạy không?'); }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) throw getSession() ? expired() : new Error('Đăng nhập tài khoản relay (hoặc đặt Relay token trong Cài đặt) để AI đọc web.');
  if (!res.ok) throw new Error(j.error || `Relay trả ${res.status}`);
  return j as SiteProfile;
}

// ---------- colour helpers ----------
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lum = (h: string) => { const [r, g, b] = rgb(h).map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const mix = (a: string, b: string, t: number) => { const A = rgb(a), B = rgb(b); return hex(A.map((v, i) => v + (B[i] - v) * t)); };
const hue = (h: string) => { const [r, g, b] = rgb(h).map((v) => v / 255); const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min; if (!d) return 0; let x = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4; return (x * 60 + 360) % 360; };

/** Map a website font to one Phloem can load; falls back by category so the feel survives. */
export function mapFont(name: string | undefined, kind: 'body' | 'heading'): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  const exact = FONTS.find((f) => f.family.toLowerCase() === n);
  if (exact) return exact.family;
  const pick = (cands: string[]) => FONTS.find((f) => cands.some((c) => f.family.toLowerCase().includes(c)))?.family ?? null;
  if (/serif|playfair|garamond|georgia|times|lora|merriweather|cormorant|libre|baskerville|dm serif|fraunces/.test(n) && !/sans/.test(n)) return pick(['playfair', 'lora', 'merriweather', 'cormorant', 'serif']);
  if (/fredoka|nunito|baloo|quicksand|comic|varela|rounded|poppins|montserrat|raleway/.test(n)) return pick(['nunito', 'poppins', 'montserrat', 'quicksand']);
  if (/mono|code|courier/.test(n)) return pick(['mono']);
  if (/space grotesk|grotesk|syne|unbounded|bebas|oswald|anton/.test(n)) return pick(['space grotesk', 'syne', 'oswald', 'bebas', 'unbounded']) ?? pick(['poppins']);
  return kind === 'heading' ? pick(['poppins', 'inter']) : pick(['inter']);
}

/** Brand tokens from the site's colours and fonts. Primary = most used saturated colour, accent = a different hue. */
export function brandFromSite(p: SiteProfile): Partial<Brand> {
  const primary = p.colors[0]?.hex || p.themeColor || '#0F3D2E';
  const dHue = (a: number, b: number) => { const d = Math.abs(a - b); return Math.min(d, 360 - d); };
  const accentC = p.colors.find((c) => dHue(hue(c.hex), hue(primary)) > 25)?.hex;
  const accent = accentC || mix(primary, lum(primary) > 0.3 ? '#000000' : '#ffffff', 0.35);
  const onPrimary = lum(primary) > 0.45 ? '#111111' : '#FFFFFF';
  const dark = p.darks[0] && lum(p.darks[0]) < 0.08 ? p.darks[0] : '#141414';
  const heading = mapFont(p.fonts[0]?.name, 'heading'), body = mapFont(p.fonts[1]?.name || p.fonts[0]?.name, 'body');
  return {
    primary, accent, onPrimary, ink: dark, muted: mix(dark, '#ffffff', 0.45), bg: '#FFFFFF', soft: mix(mix(primary, '#8a8a8a', 0.55), '#ffffff', 0.93), line: mix(mix(primary, '#8a8a8a', 0.5), '#ffffff', 0.84),
    ...(heading ? { headingFamily: heading } : {}), ...(body ? { fontFamily: body } : {}),
    name: (p.siteName || p.title.split(/[|·•–-]/)[0] || 'BRAND').trim().slice(0, 40),
  };
}

/** Chromium's createImageBitmap cannot decode SVG blobs; rasterise via <img> + canvas (240px tall, aspect kept). */
async function svgToPng(svg: Blob): Promise<Blob> {
  const u = URL.createObjectURL(svg);
  try {
    const img = new Image();
    await new Promise<void>((ok, no) => { img.onload = () => ok(); img.onerror = () => no(new Error('svg')); img.src = u; });
    const h = 240, w = Math.max(1, Math.round(h * ((img.naturalWidth || 3) / (img.naturalHeight || 1))));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('png'))), 'image/png'));
  } finally { URL.revokeObjectURL(u); }
}

/** A white copy of a dark, transparent logo (for dark bands). null when the logo has a solid background or is already light. */
export async function lightVersionOf(blob: Blob): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const g = c.getContext('2d')!; g.drawImage(bmp, 0, 0); bmp.close();
    const d = g.getImageData(0, 0, c.width, c.height); const px = d.data;
    let opaque = 0, transparent = 0, dark = 0;
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3];
      if (a < 24) { transparent++; continue; }
      opaque++;
      const l = (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      if (l < 0.45) dark++;
    }
    if (!opaque || transparent / (opaque + transparent) < 0.08 || dark / opaque < 0.6) return null; // solid background or already light
    for (let i = 0; i < px.length; i += 4) { if (px[i + 3] >= 24) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; } }
    g.putImageData(d, 0, 0);
    return await new Promise<Blob | null>((ok) => c.toBlob((b) => ok(b), 'image/png'));
  } catch { return null; }
}

/** Pull the logo and up to `max` images through the relay into the asset library. */
export async function importSiteImages(p: SiteProfile, max = 80, onProgress?: (done: number, total: number) => void, skipLogo = false): Promise<{ logoId: string | null; logoLightId: string | null; imageIds: string[]; suggested: string[] }> {
  const r = relay(); if (!r) return { logoId: null, logoLightId: null, imageIds: [], suggested: [] };
  let logoLightId: string | null = null;
  const host = (() => { try { return new URL(p.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const grab = async (url: string, name: string, page?: string) => {
    try {
      const res = await fetch(`${r.url}/image?url=${encodeURIComponent(url)}`, { headers: r.headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      const blob = await res.blob(); if (!blob.type.startsWith('image/') || blob.size < 600) return null;
      const file = blob.type === 'image/svg+xml' ? await svgToPng(blob) : blob;
      const isLogo = name === 'logo';
      if (isLogo) { const light = await lightVersionOf(file); if (light) logoLightId = (await assets.add(light, 'logo-light.png', { src: { kind: 'logo', host, url } })).id; }
      const a = await assets.add(file, name, { src: { kind: isLogo ? 'logo' : 'web', host, url, page } });
      // icons, spacers and tiny thumbnails are useless in an email: drop them again
      if (!isLogo && (Math.max(a.w, a.h) < 140 || Math.min(a.w, a.h) < 60)) { await assets.remove(a.id); return null; }
      return a.id;
    } catch { return null; }
  };
  // Every product photo is imported (the composer needs one per card); `max` only caps the generic page images.
  const urls: { url: string; name: string; page?: string }[] = [];
  const seen = new Set<string>();
  const push = (url: string, name: string, page?: string) => { if (url && !seen.has(url)) { seen.add(url); urls.push({ url, name, page }); } };
  for (const pr of (p.products || []).slice(0, 40)) if (pr.image) push(pr.image, pr.name, '/products');
  const productCount = urls.length;
  if (p.ogImage) push(p.ogImage, 'og-image', '/');
  for (const im of p.images) push(im.url, im.alt || im.url.split('/').pop()?.split('?')[0] || 'image', im.page);
  const list = urls.slice(0, productCount + max);
  const wantLogo = !skipLogo && !!(p.logo || p.logoSvg || p.icon);
  const total = list.length + (wantLogo ? 1 : 0);
  let done = 0;
  const grabSvg = async (svg: string) => {
    try {
      const png = await svgToPng(new Blob([svg], { type: 'image/svg+xml' }));
      try { const white = await svgToPng(new Blob([svg.replace(/#111111/gi, '#FFFFFF').replace(/#000000|black/gi, '#FFFFFF')], { type: 'image/svg+xml' })); logoLightId = (await assets.add(white, 'logo-light.png')).id; } catch { /* no light version */ }
      return (await assets.add(png, 'logo.png')).id;
    } catch { return null; }
  };
  // Order: the site's own <img> logo → inline header SVG → the largest icon as a last resort.
  const logoId = !wantLogo ? null : (p.logo ? await grab(p.logo, 'logo') : null) || (p.logoSvg ? await grabSvg(p.logoSvg) : null) || (p.icon && !p.logo && !p.logoSvg ? await grab(p.icon, 'logo') : null);
  if (wantLogo) { done++; onProgress?.(done, total); }
  const imageIds: string[] = [];
  const byUrl = new Map<string, string>();
  for (let i = 0; i < list.length; i += 6) {
    const batch = list.slice(i, i + 6);
    const ids = await Promise.all(batch.map((x) => grab(x.url, x.name, x.page)));
    ids.forEach((id, k) => { done++; onProgress?.(done, total); if (id) { imageIds.push(id); byUrl.set(batch[k].url, id); } });
  }
  for (const pr of p.products || []) pr.assetId = byUrl.get(pr.image) ?? null;
  // Suggested selection for the composer: every product photo, the og image, then the largest page photos (≤ 24 total).
  const productIds = (p.products || []).map((pr) => pr.assetId).filter((x): x is string => !!x);
  const rest = imageIds.filter((id) => !productIds.includes(id)).sort((a, b) => { const A = assets.get(a), B = assets.get(b); return (B ? B.w * B.h : 0) - (A ? A.w * A.h : 0); });
  const suggested = [...productIds, ...rest].slice(0, Math.max(24, productIds.length));
  return { logoId, logoLightId: logoId ? logoLightId : null, imageIds, suggested };
}

/** Compact text for the prompt: what the site is, how it speaks, what it looks like. */
export function siteSummary(p: SiteProfile, brand: Partial<Brand>): string {
  return [
    `Website: ${p.url}`,
    `Tên: ${p.siteName || p.title}`,
    p.description ? `Mô tả: ${p.description}` : '',
    p.lang ? `Ngôn ngữ trang: ${p.lang}` : '',
    p.headings.length ? `Tiêu đề trên trang: ${p.headings.slice(0, 8).join(' | ')}` : '',
    p.nav.length ? `Menu: ${p.nav.join(' · ')}` : '',
    p.buttons.length ? `Nút trên trang: ${p.buttons.join(' · ')}` : '',
    p.text ? `Trích văn bản: ${p.text.slice(0, 600)}` : '',
    `Thương hiệu GỬI email là ${p.siteName || p.title.split(/[|·•–-]/)[0] || 'website này'}: email nói về chính họ và dịch vụ/sản phẩm của họ. Ảnh có alt mang tên thương hiệu khác (khách hàng, đối tác, case study) chỉ dùng làm "khách hàng tiêu biểu" / dự án đã làm trong articles, gallery, collage, quote; không bao giờ coi thương hiệu đó là người gửi hay chủ đề chính.`,
    `Màu thương hiệu (theo tần suất): ${p.colors.map((c) => c.hex).join(', ') || '(không rõ)'} → primary ${brand.primary}, accent ${brand.accent}`,
    `Font trên web: ${p.fonts.map((f) => f.name).join(', ') || '(không rõ)'} → Phloem dùng ${brand.headingFamily || 'mặc định'} / ${brand.fontFamily || 'mặc định'}`,
    p.pages && p.pages.length ? `Các trang con đã đọc:\n${p.pages.map((pg) => `- ${pg.path}: ${pg.title}${pg.headings.length ? ` — ${pg.headings.slice(0, 4).join(' | ')}` : ''}${pg.text ? ` — ${pg.text.slice(0, 160)}` : ''}`).join('\n')}` : '',
    p.products && p.products.length ? `Sản phẩm thật trên web (${p.platform || 'cửa hàng'}), dùng đúng tên/giá/link/ảnh:\n${p.products.map((pr) => `- ${pr.name}${pr.type ? ` (${pr.type})` : ''}${pr.price ? ` · giá ${pr.price}` : ''}${pr.compareAt ? ` (giá cũ ${pr.compareAt})` : ''} · ${pr.url}${pr.assetId ? ` · imageId "${pr.assetId}"` : ''}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');
}
