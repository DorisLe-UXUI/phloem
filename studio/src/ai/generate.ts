// "Give me images and copy, get 3 layouts": Claude composes block specs, Phloem renders them deterministically.
import type { EmailFields, Brand, Doc } from '../model/types';
import { BRAND_PRESETS, DEFAULT_BRAND } from '../model/types';
import { buildDoc, type BlockSpec } from '../model/templates';
import { assets } from '../storage/assets';
import { askClaude, extractJson, type AiImage } from './client';

export interface GenInput {
  goal: string;        // promo | newsletter | launch | welcome | event | cart | digest | other
  brandName: string;
  brief: string;       // what the email is about, offer, audience
  content: string;     // raw copy: headlines, products, prices, links, dates…
  tone: string;        // thân thiện | sang trọng | tối giản | sôi nổi
  imageIds: string[];
  palette: string | 'auto';
}

export interface Variant { name: string; why: string; palette: string; fields: EmailFields; blocks: BlockSpec[] }

const BLOCK_DOC = `Các block có thể dùng (kind → content):
- nav: {brand, links:[{label,url}] (2–4 link)}
- hero: {eyebrow, headline (≤60 ký tự), subhead (1–2 câu), button:{label,url}, image:<imageId|null>, imageAlt}
- hero-band: giống hero nhưng chữ nằm trên dải màu thương hiệu, ảnh ở dưới. Hợp với promo, ra mắt, chào mừng.
- text: {eyebrow, heading, body (2–4 câu)}
- feature-row: {heading, body (1–2 câu), link:{label,url}, image:<imageId|null>, imageAlt}
- products-2 / products-3: {items:[{name, price, url, image:<imageId|null>}]} (đúng 2 hoặc 3 item)
- stats: {stats:[{value,label}]} (3 mục, value ngắn như "12k+", "48h", "-25%")
- quote: {quote, author}
- cta: {heading, subhead, button:{label,url}}
- hero-overlay: chữ trắng trên ảnh tối dần, {eyebrow, headline, subhead, button, image, imageAlt}. Rất hợp du lịch, ẩm thực, lifestyle.
- split: ảnh trái, chữ phải {eyebrow, heading, body, button:{label,url}, image, imageAlt}
- bento: {items:[{name, body, url, image}]} (đúng 3 item: 1 lớn + 2 nhỏ)
- badges: {stats:[{value,label}]} (3–4 pill ngắn: "-30% toàn bộ", "Freeship", "24h giao")
- dark-band: {eyebrow, headline (viết HOA, ≤40 ký tự), subhead, button} chữ khổ lớn trên nền tối, hợp streetwear/tech/fitness
- categories: {items:[{name, url, image}]} (3 ảnh tròn)
- gallery: {items:[{name, url, image}]} (3 ảnh vuông)
- social: {quote:"4.9/5 từ 2.300 đánh giá", author:"dòng phụ"}
- cta-wide: {button:{label,url}, subhead} nút full-width
- hero-center: {style:"light"|"band"|"gradient", eyebrow (pill), headline (≤40 ký tự, có thể viết HOA), subhead, button, image, imageAlt} tiêu đề căn giữa khổ lớn, ảnh dưới; "gradient" rất hợp khuyến mãi lớn kiểu "GIẢM 20%"
- icon-row: {items:[{name:"nhãn", body:"1 emoji hoặc ký tự", url}]} (4 mục) hàng icon tròn: dịch vụ, danh mục, lợi ích
- checklist: {heading, items:[{name}]} (3–5 dòng ✓)
- countdown: {heading, stats:[{value:"06",label:"Ngày"},{value:"12",label:"Giờ"},{value:"24",label:"Phút"},{value:"18",label:"Giây"}]}
- code: {eyebrow:"Dùng mã", headline:"MÃ", subhead:"điều kiện"} khung mã giảm giá
- stat-tiles: {stats:[{value:"+320%",label:"doanh thu"}]} (3 hoặc 4 tile)
- articles: {items:[{name:"tiêu đề", badge:"EP01", body:"Đọc thêm →", url, image}]} (3 thẻ bài viết / tập video / dự án)
- products-2/3 cũng nhận oldPrice ("$2.000") + badge ("-20%") để hiện giá cũ gạch ngang và nhãn
- footer nhận social:[{label:"YouTube"|"Instagram"|"TikTok"|"Facebook"|"LinkedIn"|"X", url}]
- divider: {} · spacer: {}
- footer: {brand, address, unsubscribeUrl, preferencesUrl}`;

function systemPrompt(presetNames: string[]): string {
  return `Bạn là art director email cho Phloem Studio. Nhiệm vụ: từ nội dung và ảnh người dùng đưa, dựng 3 phương án email marketing KHÁC NHAU RÕ RỆT về cấu trúc và nhịp điệu, mỗi phương án 6–9 block, luôn bắt đầu bằng nav và kết thúc bằng footer.

${BLOCK_DOC}

Quy tắc:
- Viết tiếng Việt tự nhiên, ngắn, cụ thể, đúng chính tả. Không dùng lorem ipsum. Không bịa số liệu nếu nội dung không có; nếu thiếu thì dùng stats về chính sách (đổi trả, giao hàng) có trong nội dung hoặc bỏ block stats.
- Chỉ dùng imageId có trong danh sách ảnh được cung cấp, đúng chuỗi id. Mỗi ảnh dùng tối đa 2 lần. Nếu không có ảnh phù hợp, để image: null (Phloem tự vẽ placeholder).
- Lấy URL từ nội dung nếu có; nếu không, dùng https://example.com/… có nghĩa.
- Mỗi phương án đặt tên ngắn (ví dụ "Tối giản", "Dải màu nổi bật", "Kể chuyện") và một câu "why" giải thích chọn cấu trúc đó cho mục tiêu nào.
- Chọn palette cho mỗi phương án từ: ${presetNames.join(', ')}. Ưu tiên khác nhau giữa các phương án trừ khi người dùng đã chọn.
- Thiết kế theo xu hướng hiện nay: một block "anchor" khổ lớn (hero-overlay / dark-band / hero-band / hero-center), hàng icon hoặc badges ngay dưới hero, khoảng trắng rộng, 1 CTA chính lặp lại ở cuối bằng cta-wide, social proof ngắn, footer có social, không quá 2 block chữ dài. Khuyến mãi: thêm code + countdown + giá cũ/mới.
- fields: campaignName (ngắn), subject (30–55 ký tự, nói thẳng lợi ích), preheader (40–90 ký tự, nối tiếp subject, không lặp).

Trả lời CHỈ bằng JSON hợp lệ, không giải thích thêm:
{"variants":[{"name":"…","why":"…","palette":"…","fields":{"campaignName":"…","subject":"…","preheader":"…"},"blocks":[{"kind":"nav","content":{…}},…]}]}`;
}

async function thumbOf(assetId: string): Promise<AiImage | null> {
  const blob = await assets.blob(assetId);
  const meta = assets.get(assetId);
  if (!blob || !meta) return null;
  try {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const dataUrl = c.toDataURL('image/jpeg', 0.8);
    return { name: meta.name, mime: 'image/jpeg', base64: dataUrl.split(',')[1] };
  } catch { return null; }
}

export async function generateVariants(inp: GenInput): Promise<Variant[]> {
  const presets = BRAND_PRESETS.map((p) => p.name);
  const images: AiImage[] = [];
  const imageLines: string[] = [];
  for (const id of inp.imageIds) {
    const t = await thumbOf(id);
    const meta = assets.get(id);
    if (t && meta) { images.push(t); imageLines.push(`- imageId "${id}": file "${meta.name}", ${meta.w}×${meta.h}px (ảnh kèm theo thứ tự)`); }
  }
  const prompt = [
    `Loại email: ${inp.goal}`,
    `Thương hiệu: ${inp.brandName || '(chưa đặt tên — dùng "BRAND")'}`,
    `Giọng điệu: ${inp.tone}`,
    inp.palette !== 'auto' ? `Bảng màu người dùng đã chọn: ${inp.palette} (dùng cho cả 3 phương án)` : 'Bảng màu: AI chọn',
    `Mục tiêu / brief:\n${inp.brief || '(không có)'}`,
    `Nội dung thô (tiêu đề, sản phẩm, giá, link, ngày…):\n${inp.content || '(không có — hãy viết copy mẫu hợp lý cho loại email này)'}`,
    imageLines.length ? `Ảnh có sẵn (${imageLines.length}):\n${imageLines.join('\n')}` : 'Ảnh: không có — dùng image: null.',
  ].join('\n\n');
  const text = await askClaude({ system: systemPrompt(presets), turns: [{ role: 'user', text: prompt, images }], maxTokens: 16000, effort: 'medium' });
  const parsed = extractJson<{ variants?: Variant[] }>(text);
  const variants = (parsed.variants || []).filter((v) => v && Array.isArray(v.blocks) && v.blocks.length).slice(0, 3);
  if (!variants.length) throw new Error('AI không trả về phương án nào. Thử mô tả nội dung rõ hơn.');
  const validIds = new Set(inp.imageIds);
  for (const v of variants) {
    v.blocks = v.blocks.filter((b) => b && typeof b.kind === 'string');
    for (const b of v.blocks) {
      const c = (b.content ||= {});
      if (c.image && !validIds.has(String(c.image))) c.image = null;
      if (c.items) for (const it of c.items) if (it.image && !validIds.has(String(it.image))) it.image = null;
    }
    if (!presets.includes(v.palette)) v.palette = inp.palette !== 'auto' ? inp.palette : 'Forest';
    v.fields = { campaignName: v.fields?.campaignName || 'Email', subject: v.fields?.subject || '', preheader: v.fields?.preheader || '' };
  }
  return variants;
}

export function brandForPalette(name: string, base: Brand = DEFAULT_BRAND): Brand {
  const p = BRAND_PRESETS.find((x) => x.name === name);
  return { ...base, ...(p ? p.brand : {}) };
}

export function variantToDoc(v: Variant, brand: Brand): Doc {
  return buildDoc(v.blocks, brand);
}
