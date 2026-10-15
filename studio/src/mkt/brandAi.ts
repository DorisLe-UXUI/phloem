// Thương hiệu: website + Google Sheet + uploaded guidelines → a brand book (JSON, checked before it is saved) + brand kit.
import { analyzeSite, brandFromSite, importSiteImages, linksFromSite, type SiteProfile } from '../ai/site';
import { extractJson, streamClaude, type AiImage } from '../ai/client';
import { sheetCsvUrl } from '../catalog/catalog';
import { assets } from '../storage/assets';
import { getSession } from '../auth/core';
import { get } from '../store';
import { audienceLine, type BrandBook, type Client, type PaletteColor, type Persona } from './types';

export interface BrandInput { website: string; sheet: string; drive: string; notes: string; files: File[] }
export interface BrandProgress { step: number; total: number; label: string; chars?: number }

const str = (v: unknown, n = 600) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const list = (v: unknown, max = 12, n = 300) => (Array.isArray(v) ? v.map((x) => str(x, n)).filter(Boolean).slice(0, max) : []);
const HEX = /^#[0-9a-f]{6}$/i;

/** The schema check: whatever Claude returned becomes a complete, well-typed BrandBook (missing parts → empty, never undefined). */
export function coerceBrandBook(raw: any, base: Partial<BrandBook> = {}): BrandBook {
  const r = raw && typeof raw === 'object' ? raw : {};
  const personas: Persona[] = (Array.isArray(r.personas) ? r.personas : []).slice(0, 4).map((p: any) => ({ name: str(p?.name, 80), age: str(p?.age, 40), job: str(p?.job, 120), goals: str(p?.goals, 400), pains: str(p?.pains, 400), channels: str(p?.channels, 200) })).filter((p: Persona) => p.name);
  const palette: PaletteColor[] = (Array.isArray(r.palette) ? r.palette : []).map((c: any) => ({ name: str(c?.name, 40) || 'Màu', hex: HEX.test(String(c?.hex || '')) ? String(c.hex).toUpperCase() : '', role: (['primary', 'accent', 'neutral'].includes(c?.role) ? c.role : 'neutral') as PaletteColor['role'], ratio: Math.max(0, Math.min(100, Math.round(Number(c?.ratio) || 0))) })).filter((c: PaletteColor) => c.hex).slice(0, 10);
  return {
    title: str(r.title, 120) || base.title || 'Brand book',
    status: base.status || 'draft',
    sources: base.sources || {},
    tagline: str(r.tagline, 160), mission: str(r.mission, 800), vision: str(r.vision, 800), values: list(r.values, 8, 200),
    personas,
    voice: { traits: list(r.voice?.traits, 8, 60), do: list(r.voice?.do, 10), dont: list(r.voice?.dont, 10) },
    messages: list(r.messages, 8), usp: list(r.usp, 8),
    competitors: (Array.isArray(r.competitors) ? r.competitors : []).slice(0, 8).map((c: any) => ({ name: str(c?.name, 80), note: str(c?.note, 300) })).filter((c: { name: string }) => c.name),
    logo: { main: base.logo?.main, light: base.logo?.light, dark: base.logo?.dark, rules: list(r.logo?.rules ?? r.logoRules, 8) },
    palette,
    fonts: { heading: str(r.fonts?.heading, 60) || 'Be Vietnam Pro', body: str(r.fonts?.body, 60) || 'Inter', note: str(r.fonts?.note, 300) },
    imagery: list(r.imagery, 8), layout: list(r.layout, 8),
    examples: { do: list(r.examples?.do, 8), dont: list(r.examples?.dont, 8) },
    kit: { hashtags: list(r.kit?.hashtags ?? r.hashtags, 15, 40).map((h) => (h.startsWith('#') ? h : `#${h}`).replace(/\s+/g, '')), ctas: list(r.kit?.ctas ?? r.ctas, 8, 60) },
    emailBrand: base.emailBrand ?? null,
    version: base.version || 1,
    versions: base.versions || [],
  };
}

const SYSTEM = `Bạn là giám đốc chiến lược thương hiệu của một agency marketing. Từ dữ liệu website, bảng tính và tài liệu của khách, viết BRAND BOOK: cụ thể, dựa trên bằng chứng trong dữ liệu, không sáo rỗng, không bịa số liệu. Khi dữ liệu thiếu, suy luận hợp lý từ ngành và ghi rõ là đề xuất.
NGÔN NGỮ: viết TOÀN BỘ brand book (mọi giá trị trong JSON) bằng NGÔN NGỮ NỘI DUNG của khách (dòng "Public copy language"), vì brand book được gửi cho chính khách duyệt; hợp văn hoá THỊ TRƯỜNG của khách. Chỉ khi ngôn ngữ là tiếng Việt mới viết tiếng Việt.
Trả lời CHỈ bằng một object JSON đúng schema sau, không markdown, không giải thích:
{"title": "Brand book <tên thương hiệu>", "brandName": "tên thương hiệu thật, đúng cách viết của khách (VD: Tool Mart)", "industry": "ngành ngắn gọn bằng TIẾNG VIỆT cho đội agency (VD: Dụng cụ cầm tay và máy công cụ)", "tagline": "...", "mission": "...", "vision": "...", "values": ["..."],
 "personas": [{"name": "Tên gợi nhớ", "age": "25-34", "job": "...", "goals": "...", "pains": "...", "channels": "Facebook, TikTok..."}],
 "voice": {"traits": ["3-5 tính từ"], "do": ["nên viết..."], "dont": ["không viết..."]},
 "messages": ["thông điệp chính"], "usp": ["điểm khác biệt"], "competitors": [{"name": "...", "note": "khác gì"}],
 "logo": {"rules": ["khoảng trống, nền sáng/tối, không kéo méo..."]},
 "palette": [{"name": "Xanh rêu", "hex": "#0F3D2E", "role": "primary|accent|neutral", "ratio": 60}],
 "fonts": {"heading": "font Google có tiếng Việt", "body": "font Google có tiếng Việt", "note": "cách dùng"},
 "imagery": ["phong cách ảnh"], "layout": ["quy tắc bố cục"], "examples": {"do": ["ví dụ đúng"], "dont": ["ví dụ sai"]},
 "kit": {"hashtags": ["#..."], "ctas": ["Đặt bàn ngay"]}}
Quy tắc: 2-4 persona; bảng màu 4-7 màu lấy từ màu thật của website/logo (giữ đúng mã hex đã cho khi có), tổng ratio ≈ 100; font phải hỗ trợ tiếng Việt (Be Vietnam Pro, Inter, Montserrat, Playfair Display, Lora, Nunito, Roboto, Oswald...); giọng văn phù hợp ngành và khách hàng mục tiêu Việt Nam.`;

function siteDigest(p: SiteProfile): string {
  const pages = (p.pages || []).slice(0, 6).map((pg) => `- ${pg.path}: ${pg.title} | ${pg.headings.slice(0, 6).join(' / ')} | ${pg.text.slice(0, 600)}`).join('\n');
  return [
    `URL: ${p.url}`, `Tên: ${p.siteName || p.title}`, `Mô tả: ${p.description}`,
    `Màu đo được (theo tần suất): ${p.colors.slice(0, 10).map((c) => c.hex).join(', ')}`,
    p.vars?.length ? `Token CSS: ${p.vars.slice(0, 8).map((v) => `${v.name}=${v.hex}`).join(', ')}` : '',
    p.ctaColors?.length ? `Màu nút: ${p.ctaColors.slice(0, 4).map((c) => c.hex).join(', ')}` : '',
    `Font: ${p.fonts.slice(0, 4).map((f) => f.name).join(', ')}`,
    `Menu: ${p.nav.slice(0, 12).join(' · ')}`, `Nút: ${p.buttons.slice(0, 10).join(' · ')}`,
    `Tiêu đề: ${p.headings.slice(0, 20).join(' | ')}`,
    p.socials?.length ? `Mạng xã hội: ${p.socials.map((s) => s.label).join(', ')}` : '',
    p.products?.length ? `Sản phẩm: ${p.products.slice(0, 15).map((x) => `${x.name} ${x.price}`).join('; ')}` : '',
    `Nội dung trang chủ: ${p.text.slice(0, 3500)}`,
    pages ? `Trang con:\n${pages}` : '',
  ].filter(Boolean).join('\n');
}

async function readSheet(link: string): Promise<string> {
  const csv = sheetCsvUrl(link) || link;
  const s = get().settings; const ses = getSession();
  const r = await fetch(`${s.relayUrl.replace(/\/$/, '')}/csv`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(ses?.mode === 'relay' ? { Authorization: `Bearer ${ses.token}` } : {}) }, body: JSON.stringify({ url: csv }), signal: AbortSignal.timeout(30_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Không đọc được Sheet (HTTP ${r.status}).`);
  return String(j.text || '').slice(0, 8000);
}

const b64 = async (f: Blob) => { const buf = new Uint8Array(await f.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); };

/** Read every source, ask Claude, return the book + the email brand + the client logo (small data URL). */
export async function buildBrandBook(client: Client, input: BrandInput, onProgress: (p: BrandProgress) => void, signal?: AbortSignal): Promise<{ book: BrandBook; logo: string | null; notes: string[]; industry: string; brandName: string }> {
  const total = 4;
  const notes: string[] = [];
  let site: SiteProfile | null = null, sheet = '';
  let emailBrand: Record<string, unknown> | null = null, logoMain: string | undefined, logoLight: string | undefined, logoData: string | null = null;
  const mock = get().settings.anthropicKey.trim() === 'mock';

  const siteOk = /^(https?:\/\/|www\.)|^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(input.website.trim());
  if (input.website.trim() && !siteOk) notes.push(`"${input.website.trim()}" không phải địa chỉ website, bỏ qua bước đọc web.`);
  if (input.website.trim() && siteOk && !mock) {
    onProgress({ step: 1, total, label: 'Đọc website (màu, font, logo, nội dung, trang con)…' });
    try {
      site = await analyzeSite(input.website, (m) => onProgress({ step: 1, total, label: m }));
      emailBrand = { ...brandFromSite(site), links: linksFromSite(site), name: client.name };
    } catch (e) { notes.push(`Không đọc được website: ${(e as Error).message}`); }
  }
  if (input.sheet.trim() && !mock) {
    onProgress({ step: 2, total, label: 'Đọc Google Sheet…' });
    try { sheet = await readSheet(input.sheet.trim()); } catch (e) { notes.push(`Không đọc được Sheet: ${(e as Error).message}. Hãy chia sẻ "Bất kỳ ai có link".`); }
  }
  if (site && !mock) {
    onProgress({ step: 2, total, label: 'Lấy logo và ảnh thương hiệu vào kho…' });
    try {
      const prevClient = assets.context.client; assets.context.client = client.id; // the website's logo and photos land in this client's library
      const imp = await importSiteImages(site, 24).finally(() => { assets.context.client = prevClient; });
      if (imp.logoId) { logoMain = imp.logoId; logoLight = imp.logoLightId || undefined; emailBrand = { ...emailBrand, logoAssetId: imp.logoId, logoLightAssetId: imp.logoLightId }; const blob = await assets.blob(imp.logoId); if (blob) { const { logoDataUrl } = await import('./data'); logoData = await logoDataUrl(blob); } }
    } catch { /* logo is optional */ }
  }

  const images: AiImage[] = []; const docs: { name: string; base64: string }[] = []; const texts: string[] = [];
  for (const f of input.files.slice(0, 6)) {
    if (f.size > 12 * 1048576) { notes.push(`${f.name} lớn hơn 12MB, bỏ qua.`); continue; }
    if (f.type === 'application/pdf') docs.push({ name: f.name, base64: await b64(f) });
    else if (/^image\/(png|jpeg|webp)$/.test(f.type)) images.push({ name: f.name, mime: f.type as AiImage['mime'], base64: await b64(f) });
    else if (/^text\//.test(f.type) || /\.(md|txt|csv)$/i.test(f.name)) texts.push(`--- ${f.name} ---\n${(await f.text()).slice(0, 6000)}`);
    else notes.push(`${f.name}: chưa đọc được loại file này.`);
  }

  onProgress({ step: 3, total, label: 'AI đang viết brand book…', chars: 0 });
  const ask = [
    `Khách hàng: ${client.name}${client.industry ? ` · ngành ${client.industry}` : ' · ngành: chưa rõ, hãy nhận diện từ dữ liệu'}`,
    audienceLine(client),
    input.notes.trim() ? `Ghi chú / brief của agency:\n${input.notes.trim().slice(0, 4000)}` : '',
    site ? `DỮ LIỆU WEBSITE\n${siteDigest(site)}` : input.website ? `Website: ${input.website} (không đọc được, suy luận từ ngành)` : '',
    emailBrand ? `Màu thương hiệu đã đo từ logo/website: primary ${emailBrand.primary}, accent ${emailBrand.accent}, chữ ${emailBrand.ink}, nền ${emailBrand.bg}. Font: ${emailBrand.headingFamily || '?'} / ${emailBrand.fontFamily || '?'}.` : '',
    sheet ? `DỮ LIỆU GOOGLE SHEET (CSV)\n${sheet}` : '',
    input.drive.trim() ? `Thư mục Google Drive của khách: ${input.drive.trim()} (chưa đọc tự động; dùng các file đính kèm nếu có)` : '',
    texts.join('\n\n'),
    docs.length ? `Đính kèm ${docs.length} PDF hướng dẫn thương hiệu: ưu tiên quy tắc trong đó.` : '',
    images.length ? `Đính kèm ${images.length} ảnh (logo/sản phẩm/bài đăng cũ): dùng để mô tả phong cách ảnh và màu.` : '',
  ].filter(Boolean).join('\n\n');

  let text: string;
  if (mock) text = JSON.stringify(mockBook(client));
  else text = await streamClaude({ system: SYSTEM, turns: [{ role: 'user', text: ask, images, docs }], maxTokens: 12000, effort: 'medium' }, (t) => onProgress({ step: 3, total, label: 'AI đang viết brand book…', chars: t.length }), signal);
  onProgress({ step: 4, total, label: 'Kiểm tra và lưu…' });
  let raw: unknown;
  try { raw = extractJson(text); } catch { throw new Error('AI trả về không đúng định dạng. Bấm làm lại.'); }
  const book = coerceBrandBook(raw, {
    title: `Brand book ${client.name}`,
    sources: { website: input.website.trim() || undefined, sheet: input.sheet.trim() || undefined, drive: input.drive.trim() || undefined, files: input.files.map((f) => f.name) },
    logo: { main: logoMain, light: logoLight, rules: [] }, emailBrand,
  });
  if (!book.palette.length && emailBrand) book.palette = [{ name: 'Chính', hex: String(emailBrand.primary), role: 'primary', ratio: 60 }, { name: 'Nhấn', hex: String(emailBrand.accent), role: 'accent', ratio: 10 }, { name: 'Chữ', hex: String(emailBrand.ink), role: 'neutral', ratio: 20 }, { name: 'Nền', hex: String(emailBrand.bg), role: 'neutral', ratio: 10 }].filter((c) => HEX.test(c.hex)) as PaletteColor[];
  const industry = typeof (raw as { industry?: unknown })?.industry === 'string' ? String((raw as { industry: string }).industry).trim().slice(0, 80) : '';
  const brandName = String((raw as { brandName?: unknown })?.brandName || site?.siteName || '').trim().slice(0, 80);
  return { book, logo: logoData, notes, industry, brandName };
}

function mockBook(c: Client) {
  return {
    title: `Brand book ${c.name}`, tagline: 'Chậm lại một nhịp, ngon hơn một chút', mission: `${c.name} mang đến trải nghiệm ấm áp, gần gũi cho người trẻ thành thị.`, vision: 'Trở thành điểm hẹn quen thuộc của mỗi khu phố.', values: ['Chân thật', 'Tử tế', 'Tỉ mỉ'],
    personas: [{ name: 'Minh Anh, dân văn phòng', age: '24-30', job: 'Nhân viên marketing', goals: 'Chỗ ngồi yên tĩnh làm việc', pains: 'Quán ồn, wifi yếu', channels: 'Instagram, TikTok' }, { name: 'Anh Huy, chủ doanh nghiệp nhỏ', age: '32-40', job: 'Chủ shop', goals: 'Gặp khách lịch sự', pains: 'Thiếu chỗ đỗ xe', channels: 'Facebook, Zalo' }],
    voice: { traits: ['ấm áp', 'gần gũi', 'tinh tế'], do: ['Xưng "mình" - "bạn"', 'Câu ngắn, cảm giác'], dont: ['Viết hoa toàn bộ', 'Dùng quá 2 emoji một câu'] },
    messages: ['Góc nhỏ cho ngày dài'], usp: ['Cà phê rang tại chỗ mỗi sáng'], competitors: [{ name: 'Chuỗi cà phê lớn', note: 'Nhanh nhưng thiếu cá tính' }],
    logo: { rules: ['Chừa khoảng trống bằng chiều cao chữ P', 'Trên nền tối dùng bản trắng'] },
    palette: [{ name: 'Nâu rang', hex: '#5B3A29', role: 'primary', ratio: 50 }, { name: 'Kem sữa', hex: '#F4E9DA', role: 'neutral', ratio: 30 }, { name: 'Cam hoàng hôn', hex: '#E8833A', role: 'accent', ratio: 10 }, { name: 'Đen cà phê', hex: '#1E1A17', role: 'neutral', ratio: 10 }],
    fonts: { heading: 'Playfair Display', body: 'Be Vietnam Pro', note: 'Tiêu đề serif, nội dung sans' },
    imagery: ['Ánh sáng tự nhiên, tông ấm', 'Cận cảnh tay pha chế'], layout: ['Nhiều khoảng trắng', 'Một điểm nhấn mỗi bố cục'],
    examples: { do: ['Ảnh thật tại quán'], dont: ['Ảnh stock phương Tây'] }, kit: { hashtags: ['#caphegio', '#gocnhochongaydai'], ctas: ['Ghé quán', 'Đặt bàn'] },
  };
}
