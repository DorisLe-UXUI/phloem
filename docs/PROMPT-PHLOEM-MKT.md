# PROMPT — Phloem MKT: bộ công cụ tự động hoá marketing cho agency

> Dán toàn bộ file này vào một phiên Claude Code mới, mở trong repo Phloem (hoặc repo mới cùng nhánh). Đọc hết trước khi viết dòng code nào. Làm theo đúng thứ tự các giai đoạn ở mục 10; mỗi giai đoạn phải chạy được, có test và được deploy trước khi sang giai đoạn sau.

---

## 0. Vai trò và mục tiêu

Bạn là kỹ sư trưởng + product designer của **Phloem**, một agency marketing. Đã có sẵn **Phloem Email** (repo `DorisLe-UXUI/phloem`, thư mục `studio/` + relay `server/`): thiết kế email bằng AI, editor layer kiểu Figma, thư viện ~15.000 đồ hoạ, gửi qua Mailchimp/Klaviyo/Gmail. Nhiệm vụ: dựng **Phloem MKT**, một app duy nhất để agency tự động hoá toàn bộ mảng marketing cho **nhiều khách hàng**, mỗi khách hàng là một không gian riêng, không bao giờ lẫn dữ liệu. Phloem Email trở thành một module trong đó.

Kết quả phải: **gọn, dễ hiểu, dễ vận hành**. Người dùng chính là nhân viên agency người Việt, không phải kỹ sư. Mọi thao tác chính ≤ 3 cú bấm từ trang khách hàng.

---

## 1. Kế thừa từ Phloem Email (bắt buộc dùng lại, không viết lại)

**Stack**
- Frontend: Preact + TypeScript, build bằng esbuild (`node build.mjs`), không framework UI ngoài; store nhỏ tự viết (`studio/src/store.ts`); host tĩnh trên GitHub Pages; bản artifact claude.ai một file.
- Relay/backend: Node (`server/src/*.mjs`), SQLite (`db.mjs`), backup R2/S3 mỗi 10 phút (`backup.mjs`), host Render. Key Anthropic chỉ ở server (`ANTHROPIC_API_KEY`), không bao giờ nhúng vào web.
- Đăng nhập: email/mật khẩu + Google Sign-In (`auth.mjs`), admin theo `ADMIN_EMAILS`, **mã dùng AI** do admin cấp (`/aiaccess`), trang Database cho admin.
- AI: Claude Opus 5.5 qua relay `POST /ai` và `POST /ai/stream` (SSE). Mô hình mặc định `claude-opus-5-5`; Sonnet/Haiku cho việc rẻ. Chỉ gửi `fallbacks` cho model Opus.
- Editor & render: mô hình layer `studio/src/model/types.ts` (rect/text/image/group, gradient nhiều điểm, bo từng góc, blur, kính mờ, xoay, hoạt ảnh lặp), renderer canvas `studio/src/render/renderer.ts`, chuyển HTML→layer `studio/src/ai/htmlToDoc.ts`, AI thiết kế tự do `studio/src/ai/design.ts`, thư viện đồ hoạ `studio/src/design/*` (Fluent 3D, bộ sinh nền/hoạ tiết, Iconify theo lô, Openverse).
- Kiểm thử: `npm test` (node:test) cho phần thuần; kiểm thử trình duyệt cho UI. Typecheck `npx tsc --noEmit -p tsconfig.studio.json`.

**Hệ nhận diện & UI (giữ y nguyên tinh thần)**
- Nền đen ánh xanh, điểm nhấn neon xanh lá. Token:
  `--bg #060908 · --bg-2 #090d0b · --panel #0c120e · --panel-2 #111a14 · --panel-3 #16211a · --line #182619 · --line-2 #233825 · --text #e8f5ec · --muted #8fa796 · --dim #5d7265 · --neon #39ff14 · --neon-dim #26b50d · --neon-ink #04140a · --warn #ffc53d · --err #ff5c5c · --info #6fb7ff`, glow `0 0 0 1px rgba(57,255,20,.35), 0 0 28px -8px rgba(57,255,20,.6)`.
- Chữ: Inter cho giao diện (12.5–13px), JetBrains Mono cho nhãn/eyebrow (in hoa, giãn chữ), Poppins ExtraBold cho wordmark "Phloem" + chữ phụ màu neon (`email`, `mkt`, `design`…). Bo góc 8px / 6px.
- Logo: chiếc lá neon (SVG trong `studio/src/ui/icons.tsx` → `LogoMark`). Wordmark: `Phloem` trắng + tên module xanh neon.
- Bố cục: top bar 48px, cột trái 252px, cột phải 300px, thanh trạng thái 26px; trên điện thoại các cột thành bottom sheet. Chip trạng thái, eyebrow mono, nút `primary` neon, `ghost` viền mảnh.
- Giọng chữ: tiếng Việt ngắn, cụ thể, động từ trước ("Tạo khách hàng", "Duyệt kế hoạch"), không thuật ngữ khi không cần, mỗi thông báo nói rõ bước tiếp theo.
- Nguyên tắc vận hành đã có và phải giữ: **Phloem không bao giờ tự gửi/đăng/chi tiền**: mọi thứ đi ra ngoài (đăng bài, chạy ads, gửi mail) cần người bấm duyệt; tạo campaign quảng cáo luôn ở trạng thái **tạm dừng**.

---

## 2. Kiến trúc thông tin (gọn, không rối)

```
Phloem MKT (trang chính tổng thể)
├── Tổng quan            ← hôm nay: việc cần duyệt, bài sắp đăng, ads đang chạy, cảnh báo, theo từng khách hàng
├── Khách hàng           ← danh sách + nút "Tạo khách hàng"
│   └── [Khách hàng A]   ← mỗi khách hàng = 1 workspace riêng, có thanh tab:
│       ├── Tổng quan    (KPI, tiến độ kế hoạch, việc chờ, lịch 7 ngày tới)
│       ├── Thương hiệu  (brand book + brand kit dùng chung cho mọi module)
│       ├── Kế hoạch     (1–12 tháng, dạng bảng như Google Sheets, khách duyệt)
│       ├── Thiết kế     (Phloem Design: ảnh, video, template theo kênh)
│       ├── Lịch đăng    (Meta, TikTok, Google, LinkedIn)
│       ├── Quảng cáo    (nghiên cứu, đề xuất campaign, mô phỏng)
│       ├── Email        (Phloem Email hiện tại, theo brand của khách)
│       ├── Báo cáo      (số liệu thật từ nền tảng + nhận xét AI)
│       └── Cài đặt      (kết nối tài khoản, thành viên, quyền, xoá/xuất dữ liệu)
├── Thư viện chung       ← template & đồ hoạ của agency (khách hàng chỉ thấy bản sao của mình)
└── Quản trị             ← người dùng, mã AI, chi phí AI, Database (admin)
```

- Thanh chuyển khách hàng ở top bar (giống chuyển workspace của Slack/Figma): tên + logo khách, tìm nhanh `⌘K`.
- Mỗi trang module có cùng khung: tiêu đề + trạng thái + 1 nút chính ở phải. Không quá 1 nút `primary` trên một màn.
- Trạng thái thống nhất toàn app: `Nháp → Chờ duyệt → Đã duyệt → Đã lên lịch → Đã đăng/Đang chạy → Lỗi`, mỗi trạng thái 1 màu chip.

---

## 3. Khách hàng là project riêng (quan trọng nhất)

- Bảng `clients` (id, tên, logo, ngành, website, múi giờ, tiền tệ, trạng thái, người phụ trách). **Mọi bảng dữ liệu khác có `client_id` NOT NULL**; mọi query phía server lọc theo `client_id` lấy từ quyền của người gọi, không bao giờ tin `client_id` từ trình duyệt mà không kiểm quyền.
- Kho file theo tiền tố `clients/<client_id>/…` (R2/S3). Token mạng xã hội/ads của khách lưu **mã hoá** (AES-GCM, khoá ở biến môi trường), theo `client_id`.
- AI: ngữ cảnh gửi Claude chỉ gồm dữ liệu của đúng khách hàng đang mở. Không có tính năng nào trộn dữ liệu 2 khách trong một lần gọi AI. Viết test chứng minh điều này (gọi API với khách A, khẳng định không đọc được bất kỳ dòng nào của khách B).
- Quyền: `owner` agency, `manager`, `designer`, `content`, `ads`, và `client_viewer` (khách hàng chỉ xem + duyệt + bình luận trong workspace của chính họ). Phân quyền theo từng khách hàng.
- Nhật ký (audit log) mọi thao tác ra ngoài: ai đăng, ai duyệt, ai kết nối tài khoản, ai xoá.
- Xuất toàn bộ dữ liệu một khách (ZIP) và xoá vĩnh viễn một khách (có xác nhận gõ tên), tuân thủ Nghị định 13/2023 về dữ liệu cá nhân.
- "Tạo khách hàng": 1 form ngắn (tên, website, ngành) → tạo workspace → mở ngay bước "Lên thương hiệu".

---

## 4. Module Thương hiệu (từ link + Google Sheet + Google Drive của khách)

**Đầu vào**: link website, link Google Sheet, thư mục Google Drive, file tải lên (PDF brand guideline, ảnh logo, ảnh sản phẩm).
- Website: dùng lại bộ đọc web của Phloem Email (`server/src/site.mjs`: màu, font, ảnh, sản phẩm, menu, social, giọng văn).
- Google Drive/Sheets: Google OAuth phạm vi **chỉ đọc** (`drive.readonly`, `spreadsheets.readonly`) hoặc link công khai; liệt kê file, kéo ảnh/logo/tài liệu về kho của khách.
**AI làm**: phân tích → **Brand book** (một trang đẹp, chỉnh được): sứ mệnh, giá trị, chân dung khách hàng mục tiêu (2–4 persona), giọng nói (nên/không nên), thông điệp chính, USP, đối thủ, logo + biến thể sáng/tối, bảng màu (primary/accent/neutral, tỉ lệ dùng), font (heading/body có tiếng Việt), phong cách ảnh, quy tắc layout, ví dụ đúng/sai.
**Brand kit** (token) dùng cho mọi module: màu, font, logo, giọng văn, hashtag, CTA mặc định. Có phiên bản; đổi brand kit thì thiết kế mới tự theo.
**Duyệt**: gửi link brand book cho khách duyệt/bình luận.

---

## 5. Module Kế hoạch (chọn 1–12 tháng, khách duyệt)

**Thiết lập**: số tháng (1–12), kênh (Meta: Facebook/Instagram · TikTok · Google: Search/YouTube/Display/Business Profile · LinkedIn), mục tiêu (nhận diện, tương tác, khách tiềm năng, doanh số), ngân sách tổng, ngày bắt đầu, sự kiện/mùa vụ (Tết, 8/3, 11.11…).
**AI soạn** (Claude, đầu ra JSON có schema, rồi mới vẽ bảng): chiến lược tổng, trụ cột nội dung, chiến dịch theo tháng, phân bổ ngân sách theo kênh/tháng, KPI theo tháng, **lịch nội dung đến từng bài**: ngày, kênh, định dạng (ảnh/carousel/reel/video/story/bài viết), trụ cột, chủ đề, hook, caption nháp, CTA, hashtag, ý tưởng hình ảnh, người phụ trách, trạng thái.
**Trình bày như Google Sheets nhưng đẹp hơn**: lưới có hàng tiêu đề cố định, cột cố định đầu, nhóm theo tháng/kênh, lọc, sắp xếp, tô màu theo kênh/trạng thái, ô chỉnh trực tiếp, bình luận trên từng hàng, chế độ xem Bảng / Lịch / Kanban / Tóm tắt (1 trang cho sếp khách). Ngoài ra tab "Ngân sách" và "KPI" có biểu đồ.
**Xuất**: Google Sheets (Sheets API, giữ định dạng màu/nhóm), XLSX, PDF.
**Duyệt**: link duyệt cho khách (không cần tài khoản, token có hạn) → khách duyệt từng hàng/cả kế hoạch, bình luận; mọi thay đổi có lịch sử phiên bản. Hàng đã duyệt tự sinh việc ở Thiết kế và Lịch đăng.

---

## 6. Module Thiết kế: **Phloem Design** (ảnh + video, mạnh như Figma + Canva)

Nâng cấp từ editor của Phloem Email, dùng chung model layer và renderer.

**Kho đồ hoạ ≥ 10.000 món, chỉnh/cắt/ghép được** (đã có ~15.000 trong Phloem Email, mở rộng thêm):
- Vật thể 3D (Fluent 3D, MIT), sticker/emoji màu (Fluent, Noto), icon (Phosphor/Lucide/Tabler/Material, >20.000), logo thương hiệu (CC0), nền & hoạ tiết sinh theo brand (vô hạn), hình khối, khung, đồ hoạ dựng sẵn, ảnh miễn phí (Openverse; có thể thêm Pexels/Unsplash nếu có API key), template theo kênh.
- Mọi món: đổi màu (vector), cắt (crop, mask theo hình), tách nền, ghép (group, boolean union/subtract/intersect), làm mờ, kính mờ, bóng, xoay, lật. Lưu giấy phép/nguồn từng món; chỉ đưa vào kho món có giấy phép thương mại.

**Editor (tính năng kiểu Figma)**: canvas vô hạn, nhiều frame/artboard, kích thước sẵn theo kênh (1080×1080, 1080×1350, 1080×1920, 1200×628, 1280×720 thumbnail YouTube, 1584×396 cover LinkedIn…), layer/group/khoá/ẩn, **auto layout**, constraints khi đổi cỡ, **component + variant**, pen tool và chỉnh điểm vector, boolean, mask, text style và color style từ brand kit, smart guides, snap, thước, căn/giãn đều, phím tắt như Figma, comment ghim trên canvas, lịch sử phiên bản, (giai đoạn sau) cộng tác thời gian thực bằng CRDT (Yjs).
**Tính năng kiểu Canva**: kéo thả từ kho, template theo ngành/kênh, "Đổi cỡ thần kỳ" (1 thiết kế → mọi kích thước kênh), tách nền 1 chạm, hiệu ứng chữ, khung ảnh, biểu đồ đơn giản, QR.
**AI**: tạo thiết kế từ một hàng kế hoạch (dùng pipeline HTML→layer đã có, creative director soát trên render), viết lại caption, gợi ý layout; **tạo ảnh** qua API key cấu hình được (ví dụ OpenAI image, Google Imagen, Flux/Ideogram) với brand style; **tạo video** qua API (ví dụ Google Veo, Runway, Kling, Luma) khi có key.
**Video**: timeline nhiều cảnh, chữ động, chuyển cảnh, nhạc nền (thư viện nhạc có giấy phép), phụ đề tự động, tỉ lệ 9:16/1:1/16:9, xuất MP4 (render server bằng Remotion hoặc ffmpeg; trình duyệt dùng WebCodecs cho bản xem trước).
**Xuất**: PNG/JPG/MP4/GIF/PDF, gửi thẳng sang Lịch đăng.

---

## 7. Module Lịch đăng (Meta, TikTok, Google, LinkedIn)

- Lịch tháng/tuần/danh sách, kéo thả đổi ngày, xem trước đúng giao diện từng nền tảng, gợi ý giờ đăng tốt (từ số liệu thật của khách khi có).
- Đăng qua **API chính thức**: Meta Graph API (Page + Instagram Content Publishing), TikTok Content Posting API, Google Business Profile API + YouTube Data API, LinkedIn (Community Management / Posts API cho trang công ty). Mỗi khách kết nối tài khoản của chính họ (OAuth), token mã hoá.
- Hàng đợi phía server (worker + cron) với thử lại, báo lỗi rõ ràng, không đăng trùng; bài chỉ đăng khi trạng thái **Đã duyệt**.
- UTM tự gắn, rút gọn link, bình luận đầu tiên, hashtag theo brand kit.
- Thực tế cần nói rõ với người dùng: Meta, TikTok, LinkedIn đều cần **app review/duyệt quyền** trước khi đăng thay khách; trong lúc chờ, app vẫn lên lịch và nhắc người đăng tay (tải file + caption sẵn).

---

## 8. Module Quảng cáo (thu thập, so sánh, đề xuất, mô phỏng)

- **Thu thập**: quảng cáo đối thủ (Meta Ad Library API; Google Ads Transparency và TikTok Creative Center xem tay/nhập link), từ khoá và khối lượng tìm kiếm (Google Ads Keyword Planner API khi có tài khoản), số liệu lịch sử của chính khách (Meta Insights, Google Ads, TikTok Ads, GA4).
- **So sánh**: bảng đối thủ (thông điệp, định dạng, tần suất, CTA, ưu đãi), điểm mạnh/yếu, khoảng trống cơ hội.
- **AI đề xuất campaign**: mục tiêu, kênh, đối tượng (sở thích, lookalike, từ khoá), vị trí, ngân sách/ngày, chiến lược giá thầu, cấu trúc campaign → nhóm → quảng cáo, 3–5 biến thể nội dung, kế hoạch A/B test, lịch tối ưu.
- **Mô phỏng (bảng demo AI)**: bảng dự báo theo kịch bản thấp/trung bình/cao: hiển thị, tiếp cận, CPM, CTR, CPC, chuyển đổi, CPA, ROAS, kèm thanh kéo ngân sách/thời gian để thấy số thay đổi; số dựa trên benchmark ngành theo thị trường Việt Nam + dữ liệu thật của khách khi có. **Luôn ghi rõ "ước tính, không cam kết"** và nêu giả định.
- **Đẩy sang nền tảng**: tạo campaign qua Meta Marketing API / Google Ads API / TikTok Marketing API ở trạng thái **tạm dừng**; người có quyền bấm bật trong trình quản lý quảng cáo.

---

## 9. Các module/đề xuất thêm (theo thứ tự giá trị)

1. **Báo cáo tự động**: dashboard từng khách + báo cáo tuần/tháng (PDF/Slides) với nhận xét AI, gửi khách qua email/Zalo.
2. **Cổng khách hàng**: khách đăng nhập (hoặc link token) chỉ thấy workspace của họ: duyệt kế hoạch, duyệt thiết kế, xem lịch, xem báo cáo.
3. **Hộp thư & bình luận**: gom tin nhắn/bình luận Facebook, Instagram, TikTok, Zalo OA về một chỗ; AI gợi ý trả lời theo giọng thương hiệu; gắn nhãn khách hàng tiềm năng.
4. **Zalo OA** (thị trường Việt Nam): gửi tin, ZNS, kết nối CRM.
5. **Thương mại điện tử**: kéo dữ liệu Shopee/Lazada/TikTok Shop cho khách bán hàng; gợi ý sản phẩm nên đẩy (đã có logic "Kho hàng" trong Phloem Email).
6. **KOL/KOC**: danh sách, báo giá, theo dõi bài đăng, chi phí/hiệu quả.
7. **Landing page builder** dùng chung editor + brand kit; form thu lead → CRM nhẹ.
8. **SEO & blog**: AI viết bài theo từ khoá, lịch đăng blog, đăng WordPress.
9. **Việc & quy trình**: Kanban theo khách, SLA duyệt, nhắc việc.
10. **Chi phí & lợi nhuận theo khách**: giờ làm, chi phí AI/API, phí dịch vụ.
11. **Thư viện mẫu của agency**: lưu template/brief/caption hay để dùng lại cho khách khác (sao chép, không liên kết dữ liệu).

---

## 10. Lộ trình thực hiện (mỗi giai đoạn: code + test + README + deploy)

| Giai đoạn | Nội dung | Xong khi |
|---|---|---|
| 0. Nền tảng | Trang chính Phloem MKT, Khách hàng (tạo/sửa/lưu trữ/xoá), workspace + thanh tab, chuyển khách ⌘K, phân quyền theo khách, audit log, cách ly dữ liệu + test cách ly, đưa Phloem Email vào tab Email | Tạo 2 khách, dữ liệu không lẫn, test cách ly xanh |
| 1. Thương hiệu | Đọc web + Drive + Sheet, brand book, brand kit, duyệt | Từ 1 link ra brand book đẹp trong < 3 phút |
| 2. Kế hoạch | Chọn 1–12 tháng + kênh, AI soạn, lưới kiểu Sheets, xuất Google Sheets/XLSX/PDF, link duyệt cho khách | Khách duyệt từng hàng qua link |
| 3. Phloem Design | Kho ≥ 10.000 đồ hoạ có giấy phép, editor (auto layout, component, pen, boolean, mask), template theo kênh, đổi cỡ thần kỳ, AI tạo ảnh qua API key | Thiết kế 1 bài từ hàng kế hoạch trong 1 cú bấm |
| 4. Lịch đăng | Lịch + hàng đợi + đăng API (sau khi được duyệt app), chế độ đăng tay khi chưa có quyền | Bài đã duyệt tự đăng đúng giờ, lỗi báo rõ |
| 5. Quảng cáo | Thu thập, so sánh, AI đề xuất, bảng mô phỏng, tạo campaign tạm dừng | Bảng mô phỏng chạy với thanh kéo ngân sách |
| 6. Video | Timeline, chữ động, xuất MP4, AI video qua API | Xuất reel 9:16 có phụ đề |
| 7. Báo cáo + cổng khách | Dashboard, báo cáo định kỳ, cổng khách | Báo cáo tháng tự gửi |

---

## 11. Quy tắc kỹ thuật và chất lượng

- Mọi đầu ra AI dạng dữ liệu đều qua **JSON schema** và kiểm tra trước khi lưu; nội dung dài dùng `/ai/stream` để người dùng thấy đang chạy.
- Hạn mức AI theo khách và theo người (dùng lại mã AI + nhật ký chi phí); hiển thị chi phí ước tính trước các việc nặng (video, ảnh hàng loạt).
- Không lưu mật khẩu/API key của khách ở trình duyệt; mọi token bên thứ ba ở server, mã hoá.
- Hiệu năng: danh sách dài ảo hoá; ảnh thumbnail; tải thư viện theo lô; app dùng được trên laptop 13" và điện thoại (xem/duyệt).
- Tiếp cận: tương phản AA, phím tắt, focus rõ, nhãn tiếng Việt cho mọi nút icon.
- Mỗi tính năng có trạng thái rỗng hướng dẫn bước đầu ("Chưa có kế hoạch. Bấm Soạn kế hoạch").
- Kiểm thử: test thuần cho logic (lịch, phân bổ ngân sách, mô phỏng, cách ly dữ liệu); kiểm thử trình duyệt cho các luồng chính; không deploy khi test đỏ.
- Giấy phép: chỉ dùng tài nguyên có giấy phép thương mại; lưu nguồn; logo thương hiệu chỉ dùng để chỉ đúng thương hiệu đó.
- Pháp lý quảng cáo: số mô phỏng là ước tính; không hứa kết quả; tuân thủ chính sách quảng cáo từng nền tảng.

---

## 12. Cách làm việc với tôi

- Trước mỗi giai đoạn: tóm tắt ngắn kế hoạch (màn hình, bảng dữ liệu, API) rồi làm luôn, không chờ hỏi trừ khi cần quyết định chi tiền hoặc tài khoản.
- Sau mỗi giai đoạn: deploy (GitHub Pages + relay), gửi link + ảnh chụp các màn chính, liệt kê việc tôi cần làm tay (ví dụ đăng ký app Meta/TikTok/LinkedIn, dán API key).
- Viết tiếng Việt trong giao diện và tin nhắn; code và comment tiếng Anh.
