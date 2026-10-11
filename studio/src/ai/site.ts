// Website → brand profile for the AI composer: the relay reads the page (logo, colours, fonts, headings, images),
// this module turns that into a Brand, imports the images as assets, and writes the summary the prompt uses.
import type { Brand } from '../model/types';
import { FONTS } from '../model/types';
import { assets } from '../storage/assets';
import { get } from '../store';

export interface SiteImage { url: string; alt: string; w: number; h: number }
export interface SiteProfile {
  url: string; title: string; lang: string; siteName: string; description: string; themeColor: string;
  logo: string; icon: string; ogImage: string; images: SiteImage[]; headings: string[]; nav: string[]; buttons: string[]; text: string;
  colors: { hex: string; n: number }[]; darks: string[]; lights: string[]; fonts: { name: string; n: number }[];
}

function relay(): { url: string; headers: Record<string, string> } | null {
  const s = get().settings; const url = (s.relayUrl || '').replace(/\/$/, '');
  if (!url) return null;
  return { url, headers: s.relayToken ? { 'X-Phloem-Token': s.relayToken } : {} };
}

export async function analyzeSite(site: string): Promise<SiteProfile> {
  const r = relay();
  if (!r) throw new Error('Cần relay để đọc website: Cài đặt → Relay URL (npm run relay).');
  let url = site.trim(); if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  let res: Response;
  try { res = await fetch(`${r.url}/site`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...r.headers }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(30_000) }); }
  catch { throw new Error('Không gọi được relay. Relay có đang chạy không?'); }
  const j = await res.json().catch(() => ({}));
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
  const accentC = p.colors.find((c) => Math.abs(hue(c.hex) - hue(primary)) > 25)?.hex;
  const accent = accentC || mix(primary, lum(primary) > 0.3 ? '#000000' : '#ffffff', 0.35);
  const onPrimary = lum(primary) > 0.45 ? '#111111' : '#FFFFFF';
  const dark = p.darks[0] && lum(p.darks[0]) < 0.08 ? p.darks[0] : '#141414';
  const heading = mapFont(p.fonts[0]?.name, 'heading'), body = mapFont(p.fonts[1]?.name || p.fonts[0]?.name, 'body');
  return {
    primary, accent, onPrimary, ink: dark, muted: mix(dark, '#ffffff', 0.45), bg: '#FFFFFF', soft: mix(primary, '#ffffff', 0.9), line: mix(primary, '#ffffff', 0.82),
    ...(heading ? { headingFamily: heading } : {}), ...(body ? { fontFamily: body } : {}),
    name: (p.siteName || p.title.split(/[|·•–-]/)[0] || 'BRAND').trim().slice(0, 40),
  };
}

/** Pull the logo and up to `max` images through the relay into the asset library. */
export async function importSiteImages(p: SiteProfile, max = 8, onProgress?: (done: number, total: number) => void): Promise<{ logoId: string | null; imageIds: string[] }> {
  const r = relay(); if (!r) return { logoId: null, imageIds: [] };
  const grab = async (url: string, name: string) => {
    try {
      const res = await fetch(`${r.url}/image?url=${encodeURIComponent(url)}`, { headers: r.headers, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      const blob = await res.blob(); if (!blob.type.startsWith('image/') || blob.size < 1500) return null;
      return (await assets.add(blob, name)).id;
    } catch { return null; }
  };
  const urls: { url: string; name: string }[] = [];
  const seen = new Set<string>();
  const push = (url: string, name: string) => { if (url && !seen.has(url)) { seen.add(url); urls.push({ url, name }); } };
  if (p.ogImage) push(p.ogImage, 'og-image');
  for (const im of p.images) push(im.url, im.alt || im.url.split('/').pop()?.split('?')[0] || 'image');
  const list = urls.slice(0, max);
  const total = list.length + (p.logo || p.icon ? 1 : 0);
  let done = 0;
  const logoId = p.logo || p.icon ? await grab(p.logo || p.icon, 'logo') : null; done++; onProgress?.(done, total);
  const imageIds: string[] = [];
  for (let i = 0; i < list.length; i += 3) {
    const ids = await Promise.all(list.slice(i, i + 3).map((x) => grab(x.url, x.name)));
    for (const id of ids) { done++; onProgress?.(done, total); if (id) imageIds.push(id); }
  }
  return { logoId, imageIds };
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
    `Màu thương hiệu (theo tần suất): ${p.colors.map((c) => c.hex).join(', ') || '(không rõ)'} → primary ${brand.primary}, accent ${brand.accent}`,
    `Font trên web: ${p.fonts.map((f) => f.name).join(', ') || '(không rõ)'} → Phloem dùng ${brand.headingFamily || 'mặc định'} / ${brand.fontFamily || 'mặc định'}`,
  ].filter(Boolean).join('\n');
}
