// "Give me images and copy, get 3 layouts": Claude composes block specs, Phloem renders them deterministically.
import type { EmailFields, Brand, Doc } from '../model/types';
import { BRAND_PRESETS, DEFAULT_BRAND, FONTS, VIBES, type Vibe } from '../model/types';
import { buildDoc, type BlockSpec } from '../model/templates';
import { assets } from '../storage/assets';
import { askClaude, extractJson, type AiImage } from './client';
import { siteSummary, type SiteProduct, type SiteProfile } from './site';

export interface GenInput {
  goal: string;        // promo | newsletter | launch | welcome | event | cart | digest | other
  brandName: string;
  brief: string;       // what the email is about, offer, audience
  content: string;     // raw copy: headlines, products, prices, links, dates…
  tone: string;        // thân thiện | sang trọng | tối giản | sôi nổi
  imageIds: string[];
  palette: string | 'auto';
  /** Website the AI read (relay /site): drives industry, tone, colours, fonts and real images. */
  website?: string;
  site?: SiteProfile | null;
  webBrand?: Partial<Brand> | null;
  logoAssetId?: string | null;
  language?: 'auto' | 'vi' | 'en';
  /** Products from Kho hàng (or the site) with imported imageIds. */
  products?: SiteProduct[];
  /** Second creative-director pass (default on). */
  refine?: boolean;
}

export interface Variant { name: string; why: string; palette: string; vibe?: Vibe; headingFont?: string; bodyFont?: string; fields: EmailFields; blocks: BlockSpec[] }

const BLOCK_DOC = `Các block có thể dùng (kind → content):
- nav: {style:"light"|"dark", brand, links:[{label,url}] (2–4 link)} ("dark" chỉ khi website nền tối và logo là ảnh sáng hoặc chữ)
- hero: {eyebrow, headline (≤60 ký tự), subhead (1–2 câu), button:{label,url}, image:<imageId|null>, imageAlt}
- hero-band: kiểu POSTER: chữ trên dải màu thương hiệu, ảnh là card nổi bóng đổ tràn ra khỏi mép dải. Hợp promo, ra mắt, chào mừng.
- hero-product: SÂN KHẤU TỐI: {style:"ink"|"band"|"gradient", eyebrow, headline (≤ 5 từ, HOA càng mạnh), subhead, button, image:<ảnh sản phẩm, tốt nhất nền trong suốt hoặc nền tối>, imageAlt} tiêu đề khổng lồ căn giữa, sản phẩm nổi trong vầng sáng, tràn xuống phần dưới. Anchor mạnh nhất cho sản phẩm vật lý, thực phẩm chức năng, công nghệ, streetwear, mỹ phẩm.
- text: {eyebrow, heading, body (2–4 câu)}
- feature-row: {heading, body (1–2 câu), link:{label,url}, image:<imageId|null>, imageAlt}
- products-2 / products-3: {eyebrow, heading, link:{label:"Xem tất cả →",url}, items:[{name, price, oldPrice, badge, url, image:<imageId|null>}]} (đúng 2 hoặc 3 item; heading/eyebrow/link là tiêu đề mục nằm ngay trong block, KHÔNG đặt block text trước nó)
- stats: {style:"light"|"dark", eyebrow, heading, stats:[{value,label}]} (3 mục, value rất ngắn ≤ 6 ký tự như "12k+", "48h", "-25%", "4.9/5"; "dark" = số khổng lồ trên nền tối)
- quote: {eyebrow:"★★★★★" (tuỳ chọn), quote, author}
- cta: {style:"card"|"dark"|"band", heading, subhead, button:{label,url}} ("dark" = card nền tối, "band" = card màu thương hiệu; dùng dark/band cho CTA cuối email)
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
- spotlight: {headline, body, button:{label,url}, items:[{name, price, badge, url, image}]} một sản phẩm/dịch vụ "ngôi sao": ảnh lớn bo góc, tag giá nổi, nhãn, mô tả, nút. Rất hợp sản phẩm chủ lực / ra mắt.
- glass-hero: {eyebrow, headline, subhead, button, image, imageAlt} ảnh toàn khung + thẻ kính mờ chứa chữ (cao cấp, lifestyle, khách sạn, làm đẹp).
- steps: {eyebrow, heading, items:[{name, body (≤ 10 từ)}]} 3 card hàng ngang hoặc 4 card lưới 2×2, số to 01·02·03 (quy trình, cách dùng, onboarding, cách làm việc).
- ticker: {items:[{name}]} dải chữ chạy nền thương hiệu: 3–5 cụm RẤT ngắn ("Freeship", "New drop", "-30% hôm nay"). Đặt ngay dưới hero hoặc trước footer.
- offer: {stats:[{value:"-30%",label:"toàn bộ"}], heading, subhead, button} con số ưu đãi khổng lồ trên card gradient. Chỉ khi có ưu đãi thật.
- reviews: {eyebrow, heading, items:[{name:"tên khách", body:"1–2 câu", badge:"Đã mua 3 lần"}]} 2–3 card sao + lời khách. Social proof đẹp hơn quote khi có ≥ 2 lời khách.
- overlap: {eyebrow, heading, body, link:{label,url} hoặc button, image, imageAlt} ảnh tràn khung + card chữ đè lên mép dưới ảnh. Rất "editorial", hợp kể chuyện, giới thiệu, lifestyle.
- feature-row nhận style:"right" để đảo ảnh sang phải (xen kẽ trái/phải khi dùng 2 feature-row liên tiếp).
- dark-band nhận image (ảnh card nổi dưới nút).
- collage: {items:[{name, url, image}]} 3 ảnh xếp lệch (1 lớn trái, 2 nhỏ phải): bộ sưu tập, không gian, hậu trường.
- divider: {} · spacer: {}
- footer: {brand, address, unsubscribeUrl, preferencesUrl, unsubscribeLabel ("Huỷ đăng ký" | "Unsubscribe"), preferencesLabel ("Cập nhật thông tin" | "Update preferences") theo ngôn ngữ copy}`;

const INDUSTRY_DOC = `Trước khi dựng, XÁC ĐỊNH NGÀNH và cá tính thương hiệu từ website/nội dung/ảnh (game & trẻ em, giáo dục, agency/studio sáng tạo, SaaS/app, bán lẻ thời trang, F&B, làm đẹp, du lịch, bất động sản, tổ chức…). Mỗi ngành có công thức riêng, KHÔNG dùng một bố cục cho mọi ngành:
- Game / trẻ em / giải trí: hero-overlay với ảnh nhân vật hoặc thế giới game (ảnh thật từ web), headline ngắn vui; icon-row 4–5 hoạt động/tính năng (body là 1 emoji); categories hoặc gallery các "vùng đất"/hoạt động; code + badges cho quà tặng; cta-wide "Vào chơi ngay"; palette tươi (Candy, Sky, Sunset, Web). Giọng hào hứng, câu ngắn.
- Agency / studio / dịch vụ sáng tạo: hero-band tối hoặc hero-center gradient, headline mạnh ≤ 7 từ; stat-tiles kết quả (+320% doanh thu…); articles 3 case study/bài viết; quote khách hàng; icon-row dịch vụ; cta "Đặt lịch tư vấn". Palette Midnight/Neon/Web. Giọng tự tin, chuyên nghiệp.
- Bán lẻ / thời trang / F&B / làm đẹp: hero ảnh sản phẩm, hoặc dark-band cho sale lớn; products-3 có price, oldPrice, badge; countdown + code khi có khuyến mãi; checklist chính sách (freeship, đổi trả); social; cta-wide. Giọng cụ thể, số liệu rõ, kêu gọi hành động.
- Giáo dục / media / khoá học: hero-center light hoặc hero ảnh lớp học; articles (tập/bài học, badge EP01…); checklist "bạn sẽ học được"; feature-row giảng viên; cta "Đăng ký". Giọng ấm, rõ ràng, khích lệ.
- SaaS / app / công nghệ: hero-center gradient hoặc hero-band; feature-row ×2 với ảnh UI thật; stat-tiles; checklist; cta "Dùng thử miễn phí". Giọng ngắn gọn, lợi ích trước tính năng.
- Du lịch / lifestyle / sự kiện: hero-overlay ảnh toàn khung; split; gallery; countdown cho sự kiện; cta. Giọng gợi cảm xúc.
Ba phương án phải khác nhau về CẤU TRÚC và CẢM XÚC (ví dụ "Chào mừng" / "Khuyến mãi" / "Kể chuyện", hay "Hero ảnh" / "Dải màu" / "Tối giản"), không chỉ khác màu. Mỗi phương án có một block anchor khác loại.`;

const DESIGN_DOC = `HỆ THỐNG THIẾT KẾ (Phloem vẽ email thành ảnh, nên mọi hiệu ứng đều hiển thị đúng ở mọi hộp thư):
- vibe quyết định bo góc, bóng đổ, pill, hình trang trí, cỡ tiêu đề: ${VIBES.map((v) => `"${v.v}" (${v.hint})`).join('; ')}. Chọn vibe theo ngành: trẻ em/game/F&B → playful; agency/tech/streetwear/sale lớn → bold; làm đẹp/thời trang cao cấp/khách sạn → luxury; báo chí/media/giáo dục → editorial; còn lại → clean.
- headingFont / bodyFont chọn từ: ${FONTS.filter((f) => f.cat !== 'system').map((f) => `${f.family}${f.vi ? '' : ' (không có tiếng Việt)'}`).join(', ')}. Khi copy tiếng Việt CHỈ dùng font có tiếng Việt. Gợi ý: playful → Baloo 2 / Nunito / Quicksand; bold → Unbounded / Space Grotesk / Anton / Oswald; luxury → Playfair Display / Cormorant Garamond / Fraunces; editorial → Lora / Merriweather / Roboto Slab; clean → Inter / Manrope / Be Vietnam Pro / Plus Jakarta Sans. Heading và body nên khác nhau (display + sans).
- Hiệu ứng có sẵn và nên dùng: hero-product (sân khấu tối + vầng sáng + sản phẩm tràn khung), hero-band / hero-center (ảnh thành card nổi tràn khỏi dải màu), hero-overlay (ảnh toàn khung + lớp tối dần + chữ trắng), glass-hero, dark-band, stats dark (số khổng lồ), ticker, offer gradient, overlap, nút pill phát sáng (playful/bold), card bo góc có bóng, pill badges, countdown tiles, code box. Kết hợp 3–4 hiệu ứng mỗi email theo công thức bên dưới, không dùng tất cả.
- Nhịp điệu: anchor khổ lớn → ticker/hàng icon/badges → nội dung chính (sản phẩm/bài viết/feature, có heading ngay trong block) → social proof → CTA dark/band → footer. Khoảng trắng rộng, mỗi block một ý.
CÔNG THỨC "WOW" (mỗi phương án chọn MỘT công thức khác nhau, đổi tên/ảnh/copy theo ngành; đây là cấu trúc đã được art director duyệt, đừng trộn lung tung):
1. POSTER (bold/playful; promo, drop, ra mắt sản phẩm vật lý): nav → hero-product (ink hoặc gradient, ảnh sản phẩm) → ticker → products-3 (heading "Mua kèm"/"Bestseller", giá + badge) → offer (nếu có ưu đãi) → reviews → cta dark → footer.
2. DẢI MÀU (clean/playful; sale, chào mừng, sự kiện): nav → hero-band (poster, ảnh card nổi) → badges → products-2 (heading) → countdown + code (nếu khuyến mãi) → quote (★★★★★) → cta band → footer.
3. EDITORIAL (editorial/clean; newsletter, kể chuyện, giới thiệu): nav → hero (ảnh trên, chữ dưới) → overlap → articles (heading "Mới trên blog"/"Dự án") → stats light → cta card → footer.
4. LUXURY (luxury; làm đẹp, thời trang cao cấp, khách sạn, trang sức): nav → glass-hero hoặc hero-overlay → text ngắn (eyebrow + 1 câu) → spotlight → collage → quote → cta band → footer. Nhiều khoảng trắng, serif, không ticker.
5. AGENCY / DỊCH VỤ (bold/clean; giới thiệu dịch vụ, B2B, studio, tư vấn): nav (dark nếu web tối) → dark-band (headline ≤ 6 từ, ảnh đội ngũ/og nếu có) → stat-tiles (kết quả thật) → steps 4 (cách làm việc) → articles (heading "Dự án đã làm", ảnh case study, badge tên khách) → reviews hoặc quote → cta dark ("Đặt lịch 20 phút") → footer.
6. SAAS / APP (clean/bold): nav → hero-center (gradient hoặc light, ảnh UI card nổi) → icon-row (4 lợi ích) → feature-row + feature-row style right (ảnh UI thật) → stats dark → checklist → cta dark → footer.
7. GAME / TRẺ EM (playful): nav → hero-overlay (ảnh nhân vật) → icon-row (emoji) → categories/gallery → code + badges → cta-wide → footer.
BẮT BUỘC: mỗi email có ít nhất một dải tối hoặc gradient (hero-product / dark-band / stats dark / cta dark / hero-center gradient), trừ công thức LUXURY. Không bao giờ đặt block text ngay trước products/articles/steps/reviews/stat-tiles: dùng heading/eyebrow của chính block đó. Tối đa 1 block text mỗi email. Headline của hero-product/dark-band ≤ 6 từ, hero khác ≤ 8 từ. Steps: body ≤ 10 từ. Stats chỉ dùng số thật.
CHECKLIST PREMIUM (tự kiểm trước khi trả): headline ≤ 8 từ, nói một lợi ích cụ thể, không mở đầu bằng "Chào mừng bạn đến với"; không câu sáo rỗng ("chất lượng cao", "giá tốt nhất"); mỗi block một ý, không lặp ý; số liệu/giá/mã lấy từ nguồn thật; hero và mọi card có ảnh nếu có ảnh; 1 CTA chính, lặp ở cuối với cùng lời kêu gọi; eyebrow ngắn (2–4 từ); subject và preheader bổ sung nhau; 3 phương án khác nhau cả cấu trúc, vibe lẫn font; ít nhất một phương án dùng block "mới" (spotlight / glass-hero / collage / steps) khi ngành phù hợp.`;

const GOAL_DESC: Record<string, string> = {
  promo: 'promo / khuyến mãi (giá, mã, hạn chót, sản phẩm giảm giá)',
  intro: 'giới thiệu dịch vụ / thương hiệu: email đầu tiên gửi cho khách tiềm năng, nói rõ công ty làm gì, cho ai, khác gì, kết quả đã đạt, cách bắt đầu; CTA là đặt lịch / liên hệ / xem dịch vụ',
  newsletter: 'newsletter định kỳ (tin, bài viết, cập nhật)',
  launch: 'ra mắt sản phẩm / dịch vụ mới (điểm mới, lợi ích, ưu đãi mở bán)',
  welcome: 'chào mừng người mới (giới thiệu thương hiệu, ưu đãi đầu, bước tiếp theo)',
  event: 'mời sự kiện (thời gian, địa điểm, lý do tham gia, đăng ký)',
  cart: 'nhắc giỏ hàng (sản phẩm bỏ dở, lý do quay lại, ưu đãi nhỏ)',
  digest: 'bản tin biên tập (tuyển chọn bài / tập / dự án)',
  reengagement: 'kéo khách cũ quay lại (nhớ bạn, có gì mới, ưu đãi quay lại)',
  other: 'khác',
};

function systemPrompt(presetNames: string[], lang: 'vi' | 'en' = 'vi'): string {
  return `Bạn là art director email cho Phloem Studio. Nhiệm vụ: từ website, nội dung và ảnh người dùng đưa, dựng 3 phương án email marketing KHÁC NHAU RÕ RỆT về cấu trúc và nhịp điệu, mỗi phương án 7–10 block, luôn bắt đầu bằng nav và kết thúc bằng footer.

${INDUSTRY_DOC}

${DESIGN_DOC}

${BLOCK_DOC}

Quy tắc:
- Toàn bộ copy (fields + mọi block, kể cả nhãn nút, eyebrow, label countdown/stats, footer) viết bằng ${lang === 'en' ? 'English tự nhiên, ngắn gọn, đúng marketing English (các ví dụ tiếng Việt trong tài liệu block chỉ minh hoạ cấu trúc: hãy viết English)' : 'tiếng Việt tự nhiên, ngắn, cụ thể'}, đúng chính tả. Không dùng lorem ipsum. Không bịa số liệu nếu nội dung không có; nếu thiếu thì dùng stats về chính sách (đổi trả, giao hàng) có trong nội dung hoặc bỏ block stats.
- Chỉ dùng imageId có trong danh sách ảnh được cung cấp, đúng chuỗi id. Mỗi ảnh dùng tối đa 2 lần. Nếu không có ảnh phù hợp, để image: null (Phloem tự vẽ placeholder).
- Lấy URL từ nội dung nếu có; nếu không, dùng https://example.com/… có nghĩa.
- Mỗi phương án đặt tên ngắn (ví dụ "Tối giản", "Dải màu nổi bật", "Kể chuyện") và một câu "why" giải thích chọn cấu trúc đó cho mục tiêu nào.
- Chọn palette cho mỗi phương án từ: ${presetNames.join(', ')}. Ưu tiên khác nhau giữa các phương án trừ khi người dùng đã chọn. Palette "Web" (nếu có) là màu lấy từ chính website: dùng cho ít nhất 2 trong 3 phương án, trừ khi người dùng đã chọn bảng màu khác.
- Thiết kế theo xu hướng hiện nay: một block "anchor" khổ lớn (hero-overlay / dark-band / hero-band / hero-center), hàng icon hoặc badges ngay dưới hero, khoảng trắng rộng, 1 CTA chính lặp lại ở cuối bằng cta-wide, social proof ngắn, footer có social, không quá 2 block chữ dài. Khuyến mãi: thêm code + countdown + giá cũ/mới.
- fields: campaignName (ngắn), subject (30–55 ký tự, nói thẳng lợi ích), preheader (40–90 ký tự, nối tiếp subject, không lặp).
- Mỗi phương án có vibe, headingFont, bodyFont riêng (khác nhau giữa 3 phương án khi hợp lý). Nếu website dùng font có trong danh sách thì ưu tiên font đó.
- SẢN PHẨM THẬT: nếu hồ sơ web có danh sách sản phẩm (tên, giá, link, imageId) thì products-2/3, bento, categories, articles PHẢI dùng đúng dữ liệu đó (không bịa tên hay giá; tiền tệ giữ nguyên như web, ví dụ $93.00). Chỉ chọn sản phẩm CÓ imageId cho các card ảnh; không bao giờ để card sản phẩm trống ảnh khi còn sản phẩm khác có ảnh.
- ẢNH: nếu có ảnh thì hero PHẢI dùng ảnh (hero-product / hero-overlay / hero / hero-band / hero-center / glass-hero), không để null. Ảnh sản phẩm tách nền hoặc nền tối/đơn sắc → hero-product; ảnh lifestyle ngang rộng → hero-overlay / glass-hero / hero-band; ảnh có chữ in sẵn (og-image) → chỉ hero-band / hero-center / dark-band (card nổi), không bao giờ làm nền hero-overlay. Ảnh tên "og-image" thường đã có chữ in sẵn: không dùng làm nền hero-overlay (chữ đè chữ), chỉ dùng ở hero/hero-band/split nếu không còn ảnh khác. Mỗi card sản phẩm/bài viết/bento/categories dùng một ảnh khác nhau. Chỉ để null khi thật sự không có ảnh phù hợp.

Trả lời CHỈ bằng JSON hợp lệ, không giải thích thêm:
{"variants":[{"name":"…","why":"…","palette":"…","vibe":"playful|bold|luxury|editorial|clean","headingFont":"…","bodyFont":"…","fields":{"campaignName":"…","subject":"…","preheader":"…"},"blocks":[{"kind":"nav","content":{…}},…]}]}`;
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

const CRITIC = `Bạn là creative director khó tính của một agency email hàng đầu. Bạn nhận JSON 3 phương án email (cùng schema bạn sẽ trả về). Hãy chấm từng phương án theo checklist premium và SỬA TRỰC TIẾP những chỗ yếu: headline nhạt hoặc dài → viết lại sắc hơn; copy sáo rỗng → cụ thể; block thừa hoặc lặp ý → bỏ/thay; thiếu ảnh ở hero/card khi có imageId → gán ảnh hợp ngữ cảnh; 2 phương án quá giống nhau → đổi cấu trúc một cái; vibe/font không hợp ngành → đổi; subject/preheader yếu → viết lại; email không có dải tối/gradient (trừ luxury) → đổi cta sang style "dark" hoặc hero sang hero-product/dark-band; block text đứng ngay trước products/articles/steps/reviews → xoá text và chuyển heading vào block đó; steps có body dài → rút còn ≤ 10 từ; stats bịa số → bỏ; hero-product/dark-band headline > 6 từ → rút. Giữ nguyên imageId, URL, giá, tên sản phẩm thật. Trả về CHỈ JSON cùng schema {"variants":[…]}, không giải thích.`;

function normalizeVariants(parsed: { variants?: Variant[] } | null, inp: GenInput, presets: string[], lang: 'vi' | 'en'): Variant[] {
  const variants = (parsed?.variants || []).filter((v) => v && Array.isArray(v.blocks) && v.blocks.length).slice(0, 3);
  const validIds = new Set(inp.imageIds);
  for (const v of variants) {
    v.blocks = v.blocks.filter((b) => b && typeof b.kind === 'string');
    for (const b of v.blocks) {
      const c = (b.content ||= {});
      if (c.image && !validIds.has(String(c.image))) c.image = null;
      if (c.items) for (const it of c.items) if (it.image && !validIds.has(String(it.image))) it.image = null;
      if (c.style && !['light', 'band', 'gradient', 'ink', 'dark', 'card', 'right'].includes(String(c.style))) delete c.style;
    }
    // A text block right before a list block becomes that block's heading (one idea, one block).
    const HEADED = new Set(['products-2', 'products-3', 'articles', 'steps', 'reviews', 'stat-tiles', 'stats', 'bento', 'categories', 'gallery', 'collage']);
    for (let i = 0; i < v.blocks.length - 1; i++) {
      const a = v.blocks[i], b = v.blocks[i + 1];
      if (a.kind === 'text' && HEADED.has(b.kind)) { const bc = (b.content ||= {}); if (!bc.heading) { bc.heading = a.content?.heading || a.content?.headline; if (!bc.eyebrow && a.content?.eyebrow) bc.eyebrow = a.content.eyebrow; } v.blocks.splice(i, 1); i--; }
    }
    if (v.blocks[0]?.kind !== 'nav') v.blocks.unshift({ kind: 'nav', content: { brand: inp.brandName || undefined } });
    if (v.blocks[v.blocks.length - 1]?.kind !== 'footer') v.blocks.push({ kind: 'footer', content: { brand: inp.brandName || undefined } });
    if (inp.palette !== 'auto') v.palette = presets.includes(inp.palette) ? inp.palette : 'Forest';
    else if (!presets.includes(v.palette)) v.palette = 'Forest';
    if (!VIBES.some((x) => x.v === v.vibe)) v.vibe = 'clean';
    const okFont = (f?: string) => !!f && FONTS.some((x) => x.family.toLowerCase() === f.toLowerCase() && (lang !== 'vi' || x.vi));
    v.headingFont = okFont(v.headingFont) ? FONTS.find((x) => x.family.toLowerCase() === v.headingFont!.toLowerCase())!.family : undefined;
    v.bodyFont = okFont(v.bodyFont) ? FONTS.find((x) => x.family.toLowerCase() === v.bodyFont!.toLowerCase())!.family : undefined;
    v.fields = { campaignName: v.fields?.campaignName || 'Email', subject: v.fields?.subject || '', preheader: v.fields?.preheader || '' };
  }
  return variants;
}

export async function generateVariants(inp: GenInput, onStage?: (s: string) => void): Promise<Variant[]> {
  const presets = [...(inp.webBrand ? ['Web'] : []), ...BRAND_PRESETS.map((p) => p.name)];
  const images: AiImage[] = [];
  const imageLines: string[] = [];
  for (const id of inp.imageIds) {
    const t = await thumbOf(id);
    const meta = assets.get(id);
    if (t && meta) { images.push(t); imageLines.push(`- imageId "${id}": file "${meta.name}", ${meta.w}×${meta.h}px (ảnh kèm theo thứ tự)`); }
  }
  const lang = inp.language && inp.language !== 'auto' ? inp.language : (inp.site?.lang || '').toLowerCase().startsWith('en') ? 'en' : 'vi';
  const prompt = [
    inp.site ? `Hồ sơ website (AI đã đọc trang này):\n${siteSummary(inp.site, inp.webBrand || {})}\n→ Dùng đúng giọng văn, danh mục, tên nút và ngôn ngữ của website. Ảnh từ web nằm trong danh sách ảnh bên dưới (tên/alt mô tả nội dung): ưu tiên ảnh thật, chọn đúng ngữ cảnh (hero: ảnh ngang lớn hoặc og-image; sản phẩm/bài viết: ảnh tương ứng). Logo đã được gắn vào nav/footer tự động.` : '',
    inp.products && inp.products.length ? `SẢN PHẨM ĐÃ CHỌN TỪ KHO (bắt buộc dùng đúng tên/giá/link/ảnh, email xoay quanh các sản phẩm này):\n${inp.products.map((pr) => `- ${pr.name}${pr.type ? ` (${pr.type})` : ''}${pr.price ? ` · giá ${pr.price}` : ''}${pr.compareAt ? ` (giá cũ ${pr.compareAt})` : ''} · ${pr.url || ''}${pr.assetId ? ` · imageId "${pr.assetId}"` : ''}`).join('\n')}` : '',
    `Ngôn ngữ copy: ${lang === 'en' ? 'English (natural, concise marketing English)' : 'tiếng Việt'}`,
    `Loại email: ${GOAL_DESC[inp.goal] || inp.goal}`,
    `Thương hiệu: ${inp.brandName || '(chưa đặt tên — dùng "BRAND")'}`,
    `Giọng điệu: ${inp.tone}`,
    inp.palette !== 'auto' ? `Bảng màu người dùng đã chọn: ${inp.palette} (dùng cho cả 3 phương án)` : 'Bảng màu: AI chọn',
    `Mục tiêu / brief:\n${inp.brief || '(không có)'}`,
    `Nội dung thô (tiêu đề, sản phẩm, giá, link, ngày…):\n${inp.content || '(không có — hãy viết copy mẫu hợp lý cho loại email này)'}`,
    imageLines.length ? `Ảnh có sẵn (${imageLines.length}):\n${imageLines.join('\n')}` : 'Ảnh: không có — dùng image: null.',
  ].filter(Boolean).join('\n\n');
  onStage?.('draft');
  const text = await askClaude({ system: systemPrompt(presets, lang), turns: [{ role: 'user', text: prompt, images }], maxTokens: 20000, effort: 'high' });
  let variants = normalizeVariants(extractJson<{ variants?: Variant[] }>(text), inp, presets, lang);
  if (!variants.length) throw new Error('AI không trả về phương án nào. Thử mô tả nội dung rõ hơn.');
  // Second pass: a demanding creative director rewrites weak copy, fixes structure, assigns images. Falls back to the draft on any error.
  if (inp.refine !== false) {
    onStage?.('refine');
    try {
      const ctx = [`Ngôn ngữ copy: ${lang === 'en' ? 'English' : 'tiếng Việt'}`, `Palette hợp lệ: ${presets.join(', ')}`, inp.site ? siteSummary(inp.site, inp.webBrand || {}) : `Thương hiệu: ${inp.brandName || 'BRAND'}`, imageLines.length ? `Ảnh hợp lệ (imageId):\n${imageLines.join('\n')}` : 'Không có ảnh: image phải là null.'].join('\n\n');
      const t2 = await askClaude({ system: `${CRITIC}\n\n${DESIGN_DOC}\n\n${BLOCK_DOC}`, turns: [{ role: 'user', text: `${ctx}\n\nJSON cần duyệt và sửa:\n${JSON.stringify({ variants })}` }], maxTokens: 20000, effort: 'high' });
      const better = normalizeVariants(extractJson<{ variants?: Variant[] }>(t2), inp, presets, lang);
      if (better.length === variants.length) variants = better;
    } catch { /* keep the draft */ }
  }
  return variants;
}

export function brandForPalette(name: string, base: Brand = DEFAULT_BRAND, web?: Partial<Brand> | null): Brand {
  if (name === 'Web' && web) return { ...base, ...web, name: base.name || web.name || 'BRAND', logoAssetId: base.logoAssetId ?? null };
  const p = BRAND_PRESETS.find((x) => x.name === name);
  return { ...base, ...(p ? p.brand : {}) };
}

/** Brand for a variant: palette + vibe + fonts the AI chose, on top of the user's base (name, logo, web colours). */
export function brandForVariant(v: Variant, base: Brand = DEFAULT_BRAND, web?: Partial<Brand> | null): Brand {
  const b = brandForPalette(v.palette, base, web);
  return { ...b, vibe: v.vibe ?? b.vibe ?? 'clean', ...(v.headingFont ? { headingFamily: v.headingFont } : {}), ...(v.bodyFont ? { fontFamily: v.bodyFont } : {}) };
}

export function variantToDoc(v: Variant, brand: Brand): Doc {
  return buildDoc(v.blocks, brand);
}
