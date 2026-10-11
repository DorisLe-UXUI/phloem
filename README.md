# Phloem — Figma → Email

> *Phloem* (đọc "flow-em") là **mô libe**, mạch dẫn của cây: mang đúng thứ lá vừa tổng hợp tới nơi cần dùng, không biến đổi nó. Figma là lá. Mailchimp / Klaviyo là nơi cần. Phloem là mạch nối — và trong tên có sẵn *flow* + *em(ail)*.

**Thiết kế email → bấm một nút → có bản nháp trong Mailchimp hoặc Klaviyo, hoặc HTML để dán — đúng như đã vẽ.** Không AI, không dựng lại bằng component riêng, không bao giờ tự gửi.

Hai cách dùng, chung một lõi:

| | **Phloem Studio** (`studio/`) | **Plugin Figma** (`manifest.json`) |
|---|---|---|
| Thiết kế ở đâu | Ngay trong app: canvas, layer, block, template, brand kit | Trong Figma |
| Chạy | `npm run studio` → mở `studio/index.html` (hoặc `npm run preview` → http://localhost:5173/studio/) | Import manifest vào Figma |
| Xuất | Draft Mailchimp/Klaviyo · Copy HTML · .zip · Preview hộp thư | Draft · Copy HTML · .zip |
| Import | Figma REST (token + link frame), file `.phloem.json` | — |

## Phloem Studio

Web app độc lập, không cần Figma. Mở `studio/index.html` sau khi build.

- **Trình thiết kế canvas**: chọn/di chuyển/resize với handle, bắt dính cạnh & tâm (⌥ để tắt), marquee, nhóm/bỏ nhóm, vào nhóm bằng double-click, sửa chữ tại chỗ, undo/redo, copy/paste, z-order, căn & dàn đều, khoá/ẩn, context menu, zoom/pan, lưới. Phím tắt kiểu Figma (`?` để xem).
- **Layer**: cây layer kéo thả, đổi tên, block có nhãn.
- **Block & template**: 10 block, 6 template, 6 bảng màu. Brand kit bằng token: đổi màu/font là cả email đổi theo.
- **Ảnh**: kéo thả lên artboard hoặc thư viện, lưu IndexedDB; cover/contain/fill, bo góc, phủ màu; cảnh báo ảnh nhỏ hơn 2× khung.
- **Bản mobile**: nhân bản 375px, chỉnh riêng; điện thoại nhận bản mobile, desktop nhận bản 600.
- **Email**: subject/preheader/tên campaign, điểm + gợi ý theo luật, kiểm tra trước khi xuất (link lỗi, CTA thiếu link, thiếu alt, ảnh placeholder chưa thay, quá nặng, Gmail 102KB).
- **Xem trước như hộp thư**: HTML thật render trong iframe, Desktop/iPhone, chặn ảnh (chỉ alt), nền tối.
- **Xuất**: Tạo/cập nhật draft, Copy HTML (nội dung hoặc trang đầy đủ), Tải .zip. Render bằng chính renderer của editor nên ảnh ra đúng từng pixel.
- **Project**: tự lưu trong trình duyệt (IndexedDB), thumbnail, nhân bản, xuất/nhập `.phloem.json` kèm ảnh.
- **Import Figma**: dán link frame + personal token; chữ/hình/frame màu phẳng thành layer sửa được, ảnh/vector render qua API.

```bash
npm run studio          # build studio/dist (kèm studio/dist/artifact.html để publish lên claude.ai)
npm run studio:watch    # build lại khi sửa
npm run typecheck:studio
```

### Deploy

| Phần | Cách | Ghi chú |
|---|---|---|
| **Studio trên GitHub Pages** | https://dorisle-uxui.github.io/phloem/ | Bản đầy đủ. Repo: https://github.com/DorisLe-UXUI/phloem. Tạo draft cần relay: chạy `npm run relay` ở máy (Studio online gọi được `http://localhost:8787`) hoặc deploy relay rồi điền URL vào Cài đặt. |
| Studio trên claude.ai | https://claude.ai/artifact/9SNPduXknZra6ckgXh3WCG | Bản riêng tư. Trang claude.ai khoá mạng ra ngoài: thiết kế, xem trước, tải zip chạy; tạo draft/Copy HTML không chạy ở đây. |
| Studio + relay đầy đủ | Static host bất kỳ cho `studio/` (sau `npm run studio`) + relay Node | Relay: `server/Dockerfile`, `server/render.yaml` (Render), `server/fly.toml` (Fly). Điền `PUBLIC_URL`, `RELAY_TOKEN`; nhập URL relay vào Studio → Cài đặt. |
| Chạy local | `npm run preview` + `npm run relay` | http://localhost:5173/studio/ |

```
Thiết kế (Figma)            Phloem                              Nền tảng
────────────────  ───────────────────────────────  ─────────────────────────
template 600px →  cắt lát theo vùng link        →  Create draft (Mailchimp/Klaviyo)
block chèn nhanh  upload ảnh, giữ link + alt         Copy HTML (dán vào template brand)
gợi ý theo luật   kiểm lỗi trước khi xuất            Tải .zip (HTML + ảnh)
```

## Tính năng

**Thiết kế (tab "Thiết kế")**
- 6 template chuẩn 600px dựng bằng auto layout, link và alt đã gắn: Newsletter, Product grid, Promo, Welcome, Cart reminder, Desktop + Mobile.
- 10 block chèn vào frame đang chọn: nav, hero, text, CTA, sản phẩm ×2/×3, ảnh + chữ, divider, spacer, footer.
- Gợi ý theo luật (không AI, cùng frame → cùng gợi ý): chiều rộng 600, toạ độ lẻ pixel, CTA trên fold, chữ quá nhỏ trên điện thoại, email quá dài, hero quá cao, thiếu footer, tương phản thấp, subject/preheader, frame mobile. Có nút sửa một chạm.
- "Tối ưu frame": snap 600px, làm tròn pixel (chống đường chỉ giữa các lát), bật clip.
- "Tạo frame mobile": nhân bản 375px, reflow nếu auto layout.

**Xuất (tab "Xuất")**
- Cắt frame thành lát ảnh theo vùng link: mỗi ô lưới sản phẩm một link, nhiều link trên một hàng → cắt cột, link lồng nhau → link sâu hơn thắng. Hàng không link được gộp. Lát cao quá 1500px tự chia (Outlook cắt >1728px).
- Link lấy từ: hyperlink chữ (⌘K), prototype "Open link", `#link=…` trong tên layer, hoặc nhập trong plugin. Alt từ `#alt=…`, tên layer ảnh, chữ bên trong, hoặc nhập trong plugin.
- Kiểm trước khi xuất: link lỗi, CTA thiếu link, lát thiếu alt, email quá nặng, HTML >102KB (Gmail cắt), link chồng nhau, frame không chuẩn.
- **Create draft**: upload ảnh (lát không đổi thì dùng lại, không upload lại), tạo campaign + nội dung. Sửa design, bấm lại → **cập nhật đúng draft đó**. Draft đã gửi/xoá → tạo mới.
  - Mailchimp: chèn vào `mc:edit` section của template có brand (header/footer giữ nguyên) hoặc HTML đầy đủ.
  - Klaviyo: template CODE + campaign + gán template.
- **Copy HTML**: HTML nội dung (dán vào template) hoặc trang đầy đủ (⇅). Ảnh được host trên chính nền tảng của client.
- **Tải .zip**: `index.html` + `images/`, không cần tài khoản.
- Preheader, tên campaign, subject điền ngay trong plugin (lưu vào frame).
- Chọn nhiều frame → chạy lần lượt, mỗi frame một draft; làm việc tiếp trên canvas trong lúc chờ.
- Frame mobile riêng: điện thoại nhận bản mobile, desktop nhận bản gốc (media query swap).
- UTM theo mẫu `{provider} {campaign} {frame} {slice} {date} {host}`; bỏ qua mailto/tel, merge tag `*|UNSUB|*` / `{% … %}`, và link đã có utm.

**Client (tab "Client")**
- Mỗi client = một kết nối + mặc định: audience, from, template/section, UTM, footer, PNG/JPG, 1x/2x.
- Kết nối bằng API key, hoặc **đăng nhập OAuth** (qua relay) để dùng đúng quyền được cấp. Thiếu quyền nào, plugin hiện rõ (`✕ campaigns:write`) và chỉ làm phần được phép.
- API key chỉ nằm trong `figma.clientStorage` của bạn; relay không lưu gì.

**Không làm**: tự gửi email (relay cũng chặn endpoint send/schedule), AI đổi layout, chuyển ảnh thành chữ sống.

## Cài đặt

```bash
npm install
npm run build        # dist/code.js + dist/ui.html
```

Figma → Plugins → Development → **Import plugin from manifest…** → chọn `manifest.json`.

### Relay (bắt buộc để gọi API)

Mailchimp và Klaviyo không cho trình duyệt gọi thẳng (CORS). Phloem đi qua một relay nhỏ **của bạn**, zero dependency:

```bash
npm run relay        # http://localhost:8787
```

Deploy `server/` lên bất kỳ host Node ≥ 18 (Railway, Fly, Render, VPS…), rồi điền URL vào tab Cài đặt. Nếu relay chạy ở domain khác `localhost`, thêm domain đó vào `manifest.json → networkAccess.allowedDomains` và build lại. Đặt `RELAY_TOKEN` trong `server/.env` để chỉ bạn dùng được relay.

### OAuth (tuỳ chọn)

Sao chép `server/.env.example` → `server/.env`, điền `MAILCHIMP_CLIENT_ID/SECRET` và/hoặc `KLAVIYO_CLIENT_ID/SECRET`, redirect URL = `{PUBLIC_URL}/oauth/callback/{provider}`. Trong plugin, nút "Đăng nhập Mailchimp/Klaviyo" sẽ bật. Klaviyo dùng PKCE; token được refresh tự động.

## Phát triển

```bash
npm run watch        # build lại khi sửa
npm test             # 12 test cho slicer / html / utm / checks / suggestions / zip
npm run typecheck    # tsc cho sandbox; tsc -p tsconfig.ui.json cho UI
npm run preview      # http://localhost:5173 — UI chạy trong trình duyệt với Figma giả
```

Cấu trúc:

```
studio/src/    Phloem Studio (Preact): model (ops/history/templates), render (canvas renderer, text layout,
               export slices), storage (IndexedDB, assets), pipeline (actions, export flow), ui, io (Figma import)
src/shared/    lõi thuần, dùng chung Studio + plugin: slicer, html, utm, checks, suggestions, zip
src/plugin/    sandbox Figma: normalize (đọc link/alt), exporter (SliceNode tạm), templates, storage, main
src/ui/        iframe: ui.ts (giao diện + pipeline), api/{relay,mailchimp,klaviyo}, imageops, clipboard
server/        relay: /proxy, /oauth/*, chặn send
dev/           preview harness
test/          node --test
```

## Quy ước thiết kế để kết quả đẹp nhất

| Việc | Cách |
|---|---|
| Link cho chữ | ⌘K như bình thường |
| Link cho ảnh / nhóm | Prototype → Open link, hoặc tên layer `Hero #link=https://…`, hoặc tab Xuất → bấm lát → Link |
| Alt text | `#alt=…` trong tên layer, hoặc đặt tên ảnh có nghĩa, hoặc tab Xuất → bấm lát → Alt |
| Lưới sản phẩm | Các ô cùng hàng căn cùng đỉnh/đáy → ít lát hơn |
| Nút | Group nút + chữ rồi gắn link cho group |
| Mobile | "Tạo frame mobile" rồi chỉnh tay; chọn trong "Frame mobile" khi xuất |
| Merge tag | `*|UNSUB|*`, `*|ARCHIVE|*` (Mailchimp), `{% unsubscribe %}` (Klaviyo) giữ nguyên |

## Ghi chú kỹ thuật

- Export dùng một `SliceNode` tạm đặt ở top-level trang nên không làm xáo auto layout; xoá ngay sau khi xuất.
- JPG được nén trong UI (canvas) vì Figma không có quality cho JPG; lát nào PNG nhỏ hơn thì giữ PNG.
- Hash FNV-1a của từng lát được lưu trong frame (`sharedPluginData`) để lần sau không upload lại ảnh không đổi.
- Klaviyo API revision mặc định `2025-07-15` (`KLAVIYO_REVISION` trên relay). Nếu Klaviyo đổi schema campaign-message, sửa `src/ui/api/klaviyo.ts → messageDefinition`.

## Landing page (song ngữ VI/EN)

`index.html` ở gốc repo là trang giới thiệu, GitHub Pages phục vụ tại `https://dorisle-uxui.github.io/phloem/`.

- Hero là cảnh 3D bằng CSS (`landing/landing.css`, `landing/landing.js`): laptop mở Studio, con trỏ chọn mẫu → đổi màu → bấm "Tạo draft" → email được cắt lát bay sang điện thoại, hiện "Draft Mailchimp đã tạo". Tự lặp, nghiêng theo chuột, dừng khi cuộn khỏi màn hình, tôn trọng `prefers-reduced-motion`.
- Phần cắt lát chạy theo cuộn (sticky), vòng xoay 24 mẫu kéo được, bấm vào mẫu mở thẳng Studio với `studio/?t=<kind>`.
- Song ngữ: `landing/i18n.js` chứa từ điển `vi`/`en`; phần tử có `data-i` (text) hoặc `data-ih` (HTML). Nút VI/EN gọi `applyLang()`, lưu lựa chọn vào `localStorage`, tự đoán theo ngôn ngữ trình duyệt lần đầu.
- Ảnh tham khảo trong `landing/showcase/` chỉ commit bản crop (`*-h.jpg`, `*-t.jpg`) đã bỏ phần có tên thương hiệu; bản gốc bị `.gitignore`.

## Host relay (để cả team dùng AI, không ai phải dán key)

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/DorisLe-UXUI/phloem)

1. Bấm nút trên (hoặc Render → New → Blueprint → chọn repo). Render đọc `render.yaml`, tạo service `phloem-relay` từ `server/`.
2. Điền `ANTHROPIC_API_KEY` (bắt buộc), `GOOGLE_CLIENT_ID` nếu muốn đăng nhập Google. `RELAY_TOKEN` tự sinh (không cần dùng nếu mọi người đăng nhập tài khoản).
3. Gói Starter có ổ đĩa 1 GB cho SQLite (tài khoản, email, ảnh giữ qua các lần deploy). Gói Free: xoá khối `disk` và biến `DATA_DIR` trong `render.yaml`; relay vẫn chạy nhưng dữ liệu trên relay mất khi deploy lại (dữ liệu trong trình duyệt người dùng vẫn còn).
4. Relay của Phloem đang chạy tại `https://phloem-relay.onrender.com` (gói Free). URL này nằm trong `<meta name="phloem-relay">` của `studio/index.html` và `index.html`; đổi relay thì sửa meta rồi push. Từ đó bản GitHub Pages mặc định trỏ về relay này: người dùng chỉ cần đăng ký/đăng nhập.

Fly.io: `cd server && fly launch --copy-config --yes && fly volumes create phloem_data --size 1 && fly secrets set ANTHROPIC_API_KEY=… DATA_DIR=/data` (thêm `[mounts] source="phloem_data" destination="/data"` vào `fly.toml`).

## Bật AI (trợ lý + dựng 3 phương án)

Bản tĩnh trên GitHub Pages không chứa khoá API. Có ba cách để AI chạy:

| Cách | Khi nào dùng | Làm gì |
| --- | --- | --- |
| Bản claude.ai | Nhanh nhất, không cần khoá | Mở artifact Phloem Studio trên claude.ai, AI dùng ngay qua tài khoản của bạn |
| Dán khoá trong Studio | Dùng bản GitHub Pages | Cài đặt → AI → dán `sk-ant-…` và chọn model. Khoá chỉ lưu trong trình duyệt đó |
| Relay cục bộ | Đội nhóm, không muốn chia khoá | `cp server/.env.example server/.env`, điền `ANTHROPIC_API_KEY`, chạy `npm run relay`, trong Studio đặt Relay URL `http://localhost:8787`. Khoá nằm ở máy chạy relay, không bao giờ lên repo |

Relay cũng là nơi giữ khoá Mailchimp/Klaviyo cho OAuth và chặn mọi lệnh gửi/lên lịch.

## Tài khoản (đăng ký / đăng nhập)

Landing có mục **Đăng ký** (`#signup`); Studio có nút Đăng nhập / Đăng ký trên trang chủ. Đăng ký xong là vào Studio đã đăng nhập; email, brand kit và client tách theo tài khoản (email tạo khi chưa đăng nhập có thể "Chuyển vào tài khoản").

| Chế độ | Khi nào | Dữ liệu ở đâu |
| --- | --- | --- |
| Trên máy (mặc định) | Không có relay, ví dụ bản GitHub Pages | Tài khoản trong IndexedDB của trình duyệt, mật khẩu băm PBKDF2 (WebCrypto). Chỉ đăng nhập được trên trình duyệt đó |
| Relay | Studio → Cài đặt có Relay URL và relay đang chạy | `POST /auth/register`, `/auth/login`, `GET /auth/me`. Người dùng trong `server/data/users.json` (mật khẩu băm scrypt), token ký HMAC bằng `AUTH_SECRET` (tự sinh vào `server/data/auth-secret` nếu không đặt). Thư mục `server/data/` không lên repo |

Mã dùng chung: `studio/src/auth/core.ts`; landing nạp bản build `studio/dist/auth.js` (`window.PhloemAuth`). Relay không gửi email xác nhận và không có quên mật khẩu; muốn thêm thì nối vào `server/src/auth.mjs`.

## Database (relay)

Relay dùng SQLite qua `node:sqlite` (Node ≥ 22.13), một file `server/data/phloem.db` (WAL), không cần cài gì thêm. Thư mục `server/data/` không lên repo.

| Bảng | Nội dung |
| --- | --- |
| `users` | id, tên, email, brand, mật khẩu băm scrypt |
| `sessions` | token đã băm, user, thiết bị, lần dùng cuối. Đăng xuất là xoá dòng → token bị thu hồi ngay |
| `projects` | JSON toàn bộ email (desktop + mobile + brand + fields + drafts), thumb, theo `owner` |
| `assets` | ảnh (bytes nằm trong DB), kích thước, mime, theo `owner` |
| `profiles` | client Mailchimp/Klaviyo của mỗi user, mã hoá AES-256-GCM bằng khoá dẫn từ `AUTH_SECRET` |

API (cần `Authorization: Bearer <token>`): `GET/PUT/DELETE /db/projects[/:id]`, `GET/PUT/DELETE /db/assets[/:id]` (PUT gửi bytes thô, header `Content-Type`, `X-Asset-Name`, `X-Asset-W/H`), `GET/PUT /db/profiles`, `GET /db/stats`, `GET/DELETE /db/sessions`.

Studio đồng bộ tự động khi tài khoản là tài khoản relay: IndexedDB vẫn là bản làm việc (không chờ mạng), mỗi lần lưu đẩy lên relay sau 1,5 giây, đăng nhập máy khác là kéo về (so `updatedAt`, bản mới hơn thắng). Ảnh tải lên được đẩy lên relay và tải về khi máy khác cần. Chip "Đồng bộ ✓" trên trang chủ Studio; bấm để đồng bộ lại.

Xem dữ liệu: `sqlite3 server/data/phloem.db "select id,name,updated_at from projects"` hoặc mở bằng DB Browser for SQLite. Sao lưu: copy file `.db` (và `.db-wal` nếu đang chạy).

## AI đọc website

Trong "Dựng bằng AI", dán link web rồi bấm **AI đọc web**: relay tải trang (`POST /site`), lấy logo, màu (theo tần suất, bỏ xám/trắng/đen), font (kể cả Google Fonts), tiêu đề, menu, nút, đoạn văn, ảnh; ảnh và logo được kéo qua `GET /image?url=` vào thư viện ảnh. Studio suy ra brand kit "Web" (primary, accent, font gần nhất Phloem có) và đưa hồ sơ này vào prompt. Prompt yêu cầu AI nhận ra ngành (game/trẻ em, agency, bán lẻ, giáo dục, SaaS, du lịch…) và dùng công thức bố cục riêng cho ngành, 3 phương án khác nhau về cấu trúc, copy tiếng Việt hoặc English theo lựa chọn.

Logo: relay ưu tiên ảnh trong header hoặc link về trang chủ, lấy cả SVG inline trong header (chuyển thành PNG), và bỏ qua "logo wall" khách hàng/đối tác/báo chí (những ảnh này cũng không bao giờ thành ảnh nội dung). Logo tối trên nền trong suốt được tạo thêm bản trắng (`logoLightAssetId`) để dùng trên nav/footer tối. Hồ sơ web nói rõ với AI: thương hiệu gửi là chính website; ảnh có alt mang tên thương hiệu khác chỉ là case study / khách hàng tiêu biểu. Loại email "Giới thiệu dịch vụ / thương hiệu" dành cho email đầu tiên tới khách tiềm năng.

Đọc sâu: relay đọc thêm tới 7 trang con cùng domain (ưu tiên link trên nav và các trang work / products / about / services…), gom ảnh `<img>` lẫn ảnh nền CSS, tối đa 80 ảnh, mỗi ảnh nhớ trang gốc; tiêu đề và đoạn mở đầu của từng trang con cũng vào prompt. Studio tải **toàn bộ** ảnh vào thư viện (bỏ icon dưới 140px), chọn sẵn ≤ 24 ảnh cho AI (sản phẩm, og, ảnh lớn nhất); prompt gửi tối đa 30 ảnh xem trước, phần còn lại liệt kê theo tên. Link dán hai lần hoặc có khoảng trắng được tự làm sạch.

Thư viện ảnh có nhãn nguồn và dự án (`Asset.src`, `Asset.project`, đồng bộ lên relay qua cột `meta`): tab Ảnh và lưới ảnh trong "Dựng bằng AI" nhóm theo *Đang dùng trong email → Dự án này → từng website → Tải lên & dán → Khác*, có lọc "Dự án này / Tất cả", tìm kiếm, chọn cả nhóm. Ảnh được gắn vào dự án khi thêm trong editor hoặc khi áp dụng một phương án AI.

Cửa hàng Shopify: relay đọc thêm `/products.json` (tên, giá, giá cũ, link, ảnh sản phẩm thật) và AI bắt buộc dùng đúng dữ liệu đó cho block sản phẩm. Ảnh lấy bản lớn nhất trong `srcset`. Nếu bạn dán link rồi bấm "Dựng" luôn, Studio tự đọc web trước.

Bảo mật relay: `/ai`, `/site`, `/image` chỉ phục vụ người đã đăng nhập tài khoản relay (hoặc có `RELAY_TOKEN`); relay chỉ tải host công khai, kiểm tra lại từng bước redirect, kết nối đúng địa chỉ đã kiểm tra (chống DNS rebinding), giới hạn trang 2 MB, ảnh 10 MB, 3 stylesheet; mật khẩu băm scrypt bất đồng bộ; hạn mức lưu trữ `USER_QUOTA_MB` (500) và `TOTAL_QUOTA_MB` (5000).

## Thiết kế: vibe, font, hiệu ứng

Brand kit có **Vibe** (clean / playful / bold / luxury / editorial): quyết định bo góc, nút pill phát sáng, bóng đổ card, hình tròn trang trí trên dải màu, cỡ tiêu đề. 45 Google Fonts (sans, display, serif, bo tròn, viết tay, mono) với cờ hỗ trợ tiếng Việt. AI chọn vibe + font tiêu đề/nội dung cho từng phương án theo ngành. Email là ảnh cắt lát nên mọi hiệu ứng (gradient, glow, bóng, chữ display) hiển thị đúng ở mọi hộp thư.

Hệ thiết kế v3 (10/2026): cỡ chữ display lớn với tracking âm theo vibe (`Theme.track`), nhịp khoảng trắng theo vibe (`Theme.space`); hero-band và hero-center kiểu **poster** (ảnh thành card nổi tràn khỏi mép dải màu); **hero-product** (sân khấu tối, chữ khổng lồ, sản phẩm nổi trong vầng sáng); stats số khổng lồ (có `style: "dark"`); steps 4 bước thành lưới 2×2 với số 01·02; card sản phẩm có tiêu đề mục, link "Xem tất cả →", giá cũ gạch ngang cùng dòng, đĩa mờ sau ảnh; block mới **ticker**, **offer** (số ưu đãi trên gradient), **reviews** (card sao), **overlap** (ảnh + card đè); nav/cta có `style: "dark"`, feature-row có `style: "right"`. AI được dạy 7 công thức bố cục theo ngành (poster, dải màu, editorial, luxury, agency, SaaS, game) và bắt buộc có một dải tối/gradient mỗi email (trừ luxury); block text đứng trước block danh sách được gộp thành heading của block đó.

Chỉnh ảnh như Figma: double-click một layer ảnh để vào chế độ **Cắt ảnh** (kéo để dời ảnh trong khung, lăn chuột để zoom, thanh công cụ nhỏ: −/+, Vừa khung, Lật ↔/↕, Xong; Esc để thoát). Panel phải có Zoom, lưới điểm nhìn 3×3, Xoay, Lật, Đặt lại. Mô hình: `ImageNode.crop {zoom, fx, fy}`, `flipX/flipY`, `rotate`.

Hiệu ứng 3D (vẽ bằng canvas nên hộp thư nào cũng hiển thị): chữ `effect` đùn khối (extrude) / neon / rỗng viền (outline) / bóng dài (shadow) với màu và độ sâu; ảnh `tilt {rx, ry}` nghiêng phối cảnh (vẽ lại theo dải), `floatShadow` bóng ellipse mềm phía dưới cho ảnh tách nền; `rotate` cho sticker/phụ kiện. Block hero-product / dark-band / hero-band / hero-center / statement nhận `effect`; hero-product nhận `tilt` và `items` = ảnh phụ kiện tách nền (trái cây, đá, lá, splash) xếp quanh sản phẩm theo ô cố định, hơi nghiêng. AI được dạy khi nào dùng.

Ảnh: dán Ctrl+V ở bất cứ đâu trong editor (ảnh từ clipboard, ảnh copy từ web, link ảnh): ảnh rơi ra **pasteboard** cạnh artboard, kéo vào email khi cần (thả lên layer ảnh để thay, thả chỗ trống để thêm layer); kéo file từ máy thả ngoài artboard cũng xếp tạm ở đó; kéo ảnh từ thư viện (tab Ảnh) vào email; trong "Dựng bằng AI" cũng dán hoặc kéo thả được. Artboard tự ôm đúng chiều cao nội dung sau mỗi thao tác (gõ H thủ công thì giữ nguyên; "Khớp nội dung" bật lại tự động).

## Kho hàng và gợi ý nên đẩy gì

Trang chủ Studio → **Kho hàng**: nhập sản phẩm từ Google Sheet (share "Anyone with the link" hoặc Publish to web → CSV; relay tải qua `POST /csv`), file CSV, hoặc cửa hàng Shopify. Cột tự nhận (VI/EN): tên, giá, giá cũ, giá vốn, tồn kho, đã bán, danh mục, ảnh, link, mô tả. Bấm **AI gợi ý**: Claude đọc kho (tồn nhiều/bán chậm, bán chạy, sắp hết, biên cao, mùa vụ) và trả 3–5 chiến dịch nên làm, mỗi gợi ý có sản phẩm cụ thể, lý do, loại email, subject. Tick sản phẩm (hoặc bấm "Dựng email từ gợi ý") → mở Dựng bằng AI với đúng tên/giá/link/ảnh sản phẩm. Kho lưu trên máy và đồng bộ lên relay (`/db/kv/catalog`) khi có tài khoản relay. Ảnh sản phẩm trong email hiển thị trọn (contain), không cắt.

## Đăng nhập bằng Google

Tạo OAuth Client ID (Web) trong Google Cloud Console, thêm Authorized JavaScript origins (`https://dorisle-uxui.github.io`, `http://localhost:5173`), đặt `GOOGLE_CLIENT_ID=...` trong `server/.env`, chạy lại relay. Nút "Continue with Google" tự hiện trong Studio (và sẽ hiện ở landing khi relay báo có client id). Relay xác minh ID token với Google rồi mở phiên như đăng nhập thường; không lưu mật khẩu Google.

## Import từ Figma

Studio → Import Figma cần Personal access token có quyền **File content: Read** (tuỳ chọn thêm Dev resources: Read). Token thiếu quyền này bị Figma trả `403 Invalid scope(s)`; tạo token mới trong Figma → Settings → Security → Personal access tokens và tick quyền đó.
