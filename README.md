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

Relay Render gói free **ngủ sau 15 phút không có request** và mất 15–60 giây để dậy. Hai lớp chống lỗi "Không gọi được relay": Studio luôn **đánh thức relay trước** (`wakeRelay` trong `ai/client.ts`: ping `/` tới 3 lần, 12/30/45 s, nhớ 10 phút, báo trạng thái trong modal) rồi mới gọi `/site` (chờ 90 s) / `/ai` / `/csv`; và GitHub Action `.github/workflows/keepalive.yml` ping relay mỗi 10 phút để nó không ngủ (750 giờ/tháng của Render đủ cho 1 service chạy liên tục).

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

## Thiết kế tự do bằng AI (mặc định trong "Dựng bằng AI")

Claude làm việc như art director của một studio: **lên 3 hướng thiết kế cùng lúc** (khác concept, bố cục, chữ, cảm xúc; dùng màu/giọng của website nếu đã đọc web), rồi **vẽ từng email bằng HTML/CSS thật** song song, stream trực tiếp (thẻ phương án hiện email đang được vẽ từng phần). Phloem dàn trang HTML trong iframe ẩn và **chuyển mọi thứ thành layer** (`studio/src/ai/htmlToDoc.ts`):

- Khối: màu nền, gradient tuyến tính/toả tròn nhiều điểm dừng (mesh), viền từng cạnh, bo từng góc, bóng, blur, xoay; vùng `overflow:hidden` được cắt đúng (ảnh trong card bo góc, vạch cong theo góc).
- Chữ: font/cỡ/độ đậm/giãn chữ/text-transform; baseline tính từ metric font nên khớp trình duyệt; đoạn một kiểu thành một layer, tiêu đề có chữ đổi màu tách theo dòng; chữ xoay; neon/viền/đổ bóng từ text-shadow.
- Ảnh `<img data-img>` từ thư viện (object-fit/position → crop), icon/sticker `<img data-icon="ph:…">` (Iconify, đổi màu được), SVG vẽ tay → ảnh vector nét.
- Thứ tự lớp theo đúng cách CSS vẽ (z-index, phần tử định vị vẽ sau nội dung). Mỗi `<a>`/card một link thành **một nhóm có link** (ít lát cắt). `data-anim` → hoạt ảnh GIF.
- Bản mobile: cùng HTML dàn ở 375px (media query) → project có sẵn bản mobile.

Sau đó **creative director AI xem ảnh render** (đúng thứ người nhận thấy) và trả bản HTML tốt hơn (bật/tắt bằng ô "soát thêm một vòng"; ~4–6 phút cho 3 phương án). Màu trùng bảng màu được gắn token thương hiệu, HTML gốc lưu trong `project.design`: bấm **AI tự chỉnh** khi chưa sửa tay → creative director vẽ lại trên bản render; đã sửa tay → chỉ sửa link/alt/huỷ đăng ký, giữ nguyên bố cục. Chế độ cũ "Ghép block Phloem" vẫn còn (nhanh, rẻ hơn). Relay có `POST /ai/stream` (SSE) cho bản vẽ trực tiếp; relay cũ không có route này thì tự rơi về `/ai`.

## Tab Thiết kế (thư viện kiểu Canva)

Cột trái → **Thiết kế**: tìm kiếm, chọn màu (bảng màu thương hiệu + màu tự chọn), bấm để chèn vào giữa vùng đang xem hoặc **kéo thả** vào email.
- **Hình khối**: chữ nhật, bo góc, tròn, pill, mái vòm, chiếc lá, kẻ, khung viền, thẻ kính, quầng sáng, dải gradient, nền mesh + ~30 hình SVG (sao, nổ sao, lấp lánh, tim, blob, sóng, vòng cung, gạch vẽ tay, mũi tên vẽ tay, ruy băng, nhãn giá, bong bóng chat…).
- **Đồ hoạ dựng sẵn**: sale burst, huy hiệu MỚI, ruy băng chữ, nhãn giá, mã giảm giá, nút bấm, đánh giá sao, đếm ngược, khung polaroid, điện thoại, trình duyệt, thẻ trích dẫn, băng chữ chạy, cụm lấp lánh, confetti, nhãn LIVE.
- **Sticker 3D** (Fluent Emoji, MIT) và **Icon** (Phosphor/Lucide/Tabler/MDI… qua Iconify, 5 kiểu nét), tìm được hàng nghìn icon; icon/hình vector **đổi màu được** ở cột phải mà vẫn nét.
- **Chữ**: tiêu đề lớn, tiêu đề, phụ đề, đoạn văn, nhãn nhỏ, số khổng lồ, chữ 3D, neon, viền, bóng dài.
- **Ảnh** miễn phí từ Openverse (chỉ giấy phép cho dùng thương mại; nguồn/tác giả lưu theo ảnh).
- **Hoạt ảnh** cho layer đang chọn: hiện dần, trượt 4 hướng, nảy, mở dần, gõ chữ, chữ chạy, và **lặp liền mạch** nhịp đập / lơ lửng / xoay / lắc / nhấp nháy (chu kỳ chia hết 2,4 giây nên GIF lặp không giật).

## Thiết kế: vibe, font, hiệu ứng

Brand kit có **Vibe** (clean / playful / bold / luxury / editorial): quyết định bo góc, nút pill phát sáng, bóng đổ card, hình tròn trang trí trên dải màu, cỡ tiêu đề. 45 Google Fonts (sans, display, serif, bo tròn, viết tay, mono) với cờ hỗ trợ tiếng Việt. AI chọn vibe + font tiêu đề/nội dung cho từng phương án theo ngành. Email là ảnh cắt lát nên mọi hiệu ứng (gradient, glow, bóng, chữ display) hiển thị đúng ở mọi hộp thư.

Hệ thiết kế v3 (10/2026): cỡ chữ display lớn với tracking âm theo vibe (`Theme.track`), nhịp khoảng trắng theo vibe (`Theme.space`); hero-band và hero-center kiểu **poster** (ảnh thành card nổi tràn khỏi mép dải màu); **hero-product** (sân khấu tối, chữ khổng lồ, sản phẩm nổi trong vầng sáng); stats số khổng lồ (có `style: "dark"`); steps 4 bước thành lưới 2×2 với số 01·02; card sản phẩm có tiêu đề mục, link "Xem tất cả →", giá cũ gạch ngang cùng dòng, đĩa mờ sau ảnh; block mới **ticker**, **offer** (số ưu đãi trên gradient), **reviews** (card sao), **overlap** (ảnh + card đè); nav/cta có `style: "dark"`, feature-row có `style: "right"`. AI được dạy 7 công thức bố cục theo ngành (poster, dải màu, editorial, luxury, agency, SaaS, game) và bắt buộc có một dải tối/gradient mỗi email (trừ luxury); block text đứng trước block danh sách được gộp thành heading của block đó.

Chỉnh ảnh như Figma: double-click một layer ảnh để vào chế độ **Cắt ảnh** (kéo để dời ảnh trong khung, lăn chuột để zoom, thanh công cụ nhỏ: −/+, Vừa khung, Lật ↔/↕, Xong; Esc để thoát). Panel phải có Zoom, lưới điểm nhìn 3×3, Xoay, Lật, Đặt lại. Mô hình: `ImageNode.crop {zoom, fx, fy}`, `flipX/flipY`, `rotate`.

Tab Email có hai nút một chạm. **AI tự chỉnh** (`actions.autoFix`, một bước undo) biến bản đang 60–80 điểm thành bản ~100: (1) creative director AI (`ai/redesign.ts`) nhìn ảnh render của email + danh sách block (nội dung đọc ngược từ layer hoặc từ `GroupNode.content` lưu lúc dựng) + cảnh báo của máy chấm + thương hiệu + link/ảnh thật, rồi trả về bố cục mới theo hệ thiết kế: giữ nguyên block người dùng ghép tay (`{"keep": index}` — block không có kind, có ảnh phụ kiện/xoay, hoặc nhiều ảnh xếp tay; bị bỏ sót thì tự chèn lại), dựng lại phần còn lại bằng `makeBlock` (≤ 8 block, ≤ 2300px, một CTA chính, không lưới 4 cột, link thật), viết subject/preheader nếu trống, chọn vibe; (2) sửa kỹ thuật + làm đẹp theo hệ thiết kế (`pipeline/polish.ts`, chạy lại không đổi gì): copy < 9px trên điện thoại → 15px (nhãn/eyebrow/ticker cố ý nhỏ thì không), ảnh nền hero > 700px → 600px, alt ảnh, link cho nút/logo/icon social, link sản phẩm thật, nút đúng kiểu brand (pill/bo góc, bóng/phát sáng, chữ đậm, nhãn đọc được trên nền nút), một tiêu đề display mỗi block (tiêu đề hero phóng lớn, block dưới dời theo), eyebrow in hoa giãn chữ (hero playful/bold thành pill), copy ≥ 15px dãn dòng 1.55, vầng sáng sau hero không ảnh, sản phẩm tách nền có bóng nổi, phủ tối dưới chữ trên ảnh, dải CTA tối nếu chưa có dải tối (trừ luxury), nền xen kẽ, ảnh/card bo góc, tương phản WCAG 4.5:1 so với bề mặt ngay dưới chữ (band/card/pill), dòng huỷ đăng ký vào block thấp nhất với merge tag, bỏ block phụ nếu vẫn > 2500px; toast báo "điểm 68 → 100". Không có AI (chưa đăng nhập relay/nhập key) thì chỉ chạy phần (2). Máy chấm (`shared/suggestions.ts`) bỏ qua nhãn cố ý nhỏ, chỉ đếm link khác nhau trong thân mail, cảnh báo lát ảnh khi > 80. Nút **Làm 3D** (`actions.make3D`: tiêu đề đùn khối/bóng dài theo vibe, sản phẩm nghiêng + bóng nổi, vầng sáng (không thêm lần hai), các ảnh tách nền của dự án xếp quanh sản phẩm, số liệu nổi khối).

Làm mờ ảnh: `ImageNode.blur` (px) vẽ bằng `ctx.filter` — nền mờ sau chữ, chiều sâu cho ảnh phụ kiện. Tách nền & cắt: "Xoá nền" (nền trắng / caro / nền phẳng nối với mép ảnh, cắt gọn về vật thể), "Xoá nền AI" (@imgly/background-removal tải từ CDN khi bấm lần đầu), "Tách từng ảnh" (ảnh gộp nhiều vật thể → từng PNG nền trong, xếp cạnh artboard), "Cắt vùng" (kéo chọn một phần ảnh → layer riêng tại chỗ). Thứ tự lớp: "Xuống 1 lớp" (⌘[) từ ngoài đi *vào* block đang chồng lên rồi chui xuống dưới sản phẩm từng nấc; "Lên 1 lớp" (⌘]) đi ngược ra; thả ảnh từ pasteboard lên block thì nằm trong block.

Bộ màu thương hiệu: primary lấy theo thứ tự tin cậy — màu chủ đạo của logo (phân tích pixel) → biến CSS đặt tên brand/primary/accent (relay bóc; preset framework như `--wp--preset…` xếp cuối) → `theme-color` → màu nút CTA → màu hay dùng trong CSS; accent là màu khác tông theo cùng thứ tự. Prompt nói rõ bộ màu và cấm AI đổi.

Hiệu ứng 3D (vẽ bằng canvas nên hộp thư nào cũng hiển thị): chữ `effect` đùn khối (extrude) / neon / rỗng viền (outline) / bóng dài (shadow) với màu và độ sâu; ảnh `tilt {rx, ry}` nghiêng phối cảnh (vẽ lại theo dải), `floatShadow` bóng ellipse mềm phía dưới cho ảnh tách nền; `rotate` cho sticker/phụ kiện. Block hero-product / dark-band / hero-band / hero-center / statement nhận `effect`; hero-product nhận `tilt` và `items` = ảnh phụ kiện tách nền (trái cây, đá, lá, splash) xếp quanh sản phẩm theo ô cố định, hơi nghiêng. AI được dạy khi nào dùng.

Ảnh: dán Ctrl+V ở bất cứ đâu trong editor (ảnh từ clipboard, ảnh copy từ web, link ảnh): ảnh rơi ra **pasteboard** cạnh artboard, kéo vào email khi cần (thả lên layer ảnh để thay, thả chỗ trống để thêm layer); kéo file từ máy thả ngoài artboard cũng xếp tạm ở đó; kéo ảnh từ thư viện (tab Ảnh) vào email; trong "Dựng bằng AI" cũng dán hoặc kéo thả được. Artboard tự ôm đúng chiều cao nội dung sau mỗi thao tác (gõ H thủ công thì giữ nguyên; "Khớp nội dung" bật lại tự động).

Chuyển động ("3D" theo nghĩa chữ chạy, hình hiện ra): mỗi layer có `anim {kind, delay, dur}` với kind fade / up / down / left / right / pop / wipe (mở dần từ trên xuống, dành cho ảnh vì mỗi khung chỉ thêm một dải) / type (gõ từng chữ) / marquee (chữ chạy ngang vô tận); panel phải mục **Chuyển động** + Trễ/Dài; nút **Phát** trên toolbar xem trước trên canvas; tab Email có **Làm động** (`actions.animateDoc`, chạy lại thì làm sạch rồi áp lại): hero = tiêu đề gõ từng chữ hoặc trượt lên, nút nảy ra, ảnh sản phẩm hiện lên, phụ kiện nảy lần lượt; **mọi block còn lại hiện ra từ từ** (tiêu đề trượt lên, chữ hiện dần, ảnh mở dần, thẻ/cột nảy lần lượt, block sau trễ 0,15 s), ticker chạy chữ. Khi xuất, slicer giữ **mỗi block động là một lát** (`SlicerOptions.keep`; block chỉ chạm nhau không gộp; trong block chỉ link dạng cột/thẻ mới tách cột nên 3 card sản phẩm vẫn 3 link riêng, nút trong hero không tách) và encode GIF (`gifenc`, 10 fps, 1x): đồng hồ GIF chạy từ lúc block đó bắt đầu động nên block trễ trên canvas vẫn hiện ngay trong mail; khung đầu là bản hoàn chỉnh (Outlook chỉ hiện khung đầu), khung sau chỉ ghi pixel thay đổi, khung giống nhau gộp thành thời gian chờ; block kiểu "hiện ra" chạy một lần rồi giữ, block có gõ chữ/marquee thì lặp; nặng quá 650 KB thì tự hạ fps. Lát GIF không bị nén lại sang JPG/PNG. Cả email Flash sale động ≈ 800 KB.

Design DNA theo thương hiệu: relay bóc `design` của web (bo góc, nút pill/vuông/viền, tiêu đề uppercase, độ đậm, tracking, nền tối) → `Brand.shape`; `themeFor(vibe, shape)` ghi đè theme vibe bằng cách design thật; bảng màu tối khi web tối; prompt nêu rõ DNA và cấm AI đổi.

Điện thoại (≤ 820px): thanh trên cuộn ngang; panel Lớp/Block/Ảnh và Thiết kế/Email/Xuất/AI thành **sheet** kéo từ đáy (thanh tab dưới cùng: Lớp · Ảnh / Canvas / Chỉnh · Xuất; chạm canvas thì sheet đóng; bấm Xuất/AI trên thanh trên cũng mở sheet); modal thành sheet 1 cột, 3 phương án AI vuốt ngang; canvas chạm: 1 ngón kéo layer hoặc kéo vùng trống để dời canvas, 2 ngón pinch để zoom (`touch-action: none`). `State.mobilePane`, `isMobile()`, CSS trong khối `@media (max-width: 820px)`. Store re-render bằng rAF kèm timer dự phòng để tab ẩn vẫn cập nhật.

Rà soát 12/10/2026 (3 agent review + chạy thử mọi luồng): relay quét CSS bằng một lượt tuyến tính (`cssRules`) thay cho regex bậc hai từng treo relay cả phút với comment dài, entity/URI lạ không làm /site văng, deadline tổng cho mỗi fetch, decode theo charset, chặn thêm dải 100.64/10 và IPv6 ánh xạ dạng hex, tối đa 4 /site cùng lúc; Studio: lưu không đè sửa đổi đang gõ, project cũ/đồng bộ được chuẩn hoá (`normalizeProject`), state crop/cut/nhóm đã vào tự dọn khi layer mất (`pruneState` trong `commit`), xoá nền/cắt vùng/tách ảnh không ghi đè sửa đổi trong lúc chờ, zoom crop là một bước undo, undo không có bước rỗng, nhóm rỗng tự xoá khi kéo layer ra, pointercancel không tạo hình thừa, dán khi modal mở không nhân đôi, GIF luôn kết thúc ở trạng thái hoàn chỉnh, Klaviyo đặt tên .gif, ảnh nghiêng chỉ đổ một bóng.

Rà soát toàn app 14/10/2026 (3 agent review lưu trữ/đồng bộ/tài khoản, xuất/tích hợp, template/AI/landing + đo hiệu năng): xuất mặc định **JPG thông minh** (ảnh → JPG, lát phẳng giữ PNG; luxe 3,5 MB → 332 KB); IndexedDB chỉ báo lưu xong khi transaction commit (hết dung lượng không còn "lưu thành công giả"), ảnh + bytes trong một transaction, kết nối IDB dùng lại; **bia mộ project** hai chiều (xoá ở máy A không sống lại từ máy B; relay giữ `project_tombstones` 90 ngày, `GET /db/projects` trả `deleted`); relay trả **409 stale** khi bản lưu cũ hơn và client kéo bản mới về; hồ sơ client không bị xoá bởi relay rỗng/giải mã lỗi (`corrupt`), gộp theo id; xuất không treo khi thiếu ảnh (bỏ qua + timeout 8 s); phiên chỉ bị xoá khi 401/403, 5xx thì giữ; có mạng lại thì đồng bộ; thumbnail cũ giữ khi font chưa sẵn; Google chỉ liên kết vào tài khoản mật khẩu khi chủ tài khoản đang đăng nhập (`google_sub`); chống brute-force đăng nhập/đăng ký và giới hạn `/proxy` cho khách; dọn session 30 ngày. Email HTML: **ghost table MSO** để Outlook không kéo giãn, href mã hoá khoảng trắng/unicode, `bgcolor` luôn hex (rgba trộn với trắng, JPG làm phẳng trên đúng màu nền), ảnh mobile không hở mép; ảnh Mailchimp cũ chỉ xoá sau khi lưu nội dung mới (Copy HTML không xoá); giới hạn 5 MB Klaviyo / 10 MB Mailchimp mỗi ảnh (tự chuyển JPG); làm mới token Klaviyo không chạy đôi; cảnh báo Gmail cắt 102 KB ngay trong tab Email và trước mọi lần xuất; relay chặn thêm automation start/queue và mọi lệnh ghi lên flows. Template: chữ/giá dạng số hoặc thiếu không làm vỡ block (`coerceContent` cho AI), nav không đè logo, giá cũ xuống dòng khi chật, hero-overlay/glass-hero cao theo nội dung, block rộng hơn 600 scale đều trên mobile. Landing: không tràn ngang trên điện thoại, form đăng ký không bao giờ GET mật khẩu lên URL.

## Mã dùng AI (ai cũng đăng nhập được, AI phải xin mã)

Ai cũng đăng ký/đăng nhập (email hoặc Google), nhưng `/ai` của relay (tốn tiền Anthropic) chỉ mở cho: **admin**, người được admin cấp, và người đã nhập **mã một lần** do admin tạo. Admin = email trong `ADMIN_EMAILS` (mặc định `vankhanh.le@sentryxp.com`) **và** đã đăng nhập bằng Google ít nhất một lần (Google chứng minh email thật; đặt `ADMIN_REQUIRE_GOOGLE=0` chỉ khi test local).
- Người dùng: Home → **Mở khoá AI** (hoặc tự bật khi bấm tính năng AI mà chưa có quyền) → nhập mã `PHL-XXXX-XXXX`, hoặc **Xin mã**: relay ghi yêu cầu và mở ứng dụng mail soạn sẵn gửi tới admin (có `RESEND_API_KEY` thì relay tự gửi email cho admin).
- Admin: Home → **Quản lý AI**: danh sách yêu cầu (Tạo mã & gửi qua email / Cấp luôn), tạo mã lẻ, bật/thu hồi AI từng người, lịch sử mã. Mã chỉ hiện một lần; relay lưu SHA-256; mỗi mã dùng một lần; nhập sai giới hạn 10 lần/10 phút.
- Dùng API key riêng trong Cài đặt hoặc bản claude.ai (AI của chính người xem) thì không cần mã.
- Bảo mật: tài khoản mật khẩu chưa xác minh trùng email với một lần đăng nhập Google sẽ bị Google "nhận lại" (mật khẩu cũ và các phiên bị huỷ), nên không ai đăng ký trước email của admin để chiếm quyền được.
- Relay: `GET /aiaccess`, `POST /aiaccess/request`, `POST /aiaccess/redeem`, admin `GET /aiaccess/admin`, `POST /aiaccess/admin/code`, `POST /aiaccess/admin/grant`; bảng `ai_codes`, `ai_requests`, cột `users.ai_access`.

## Gửi bằng email thường (không cần Mailchimp/Klaviyo)

Tab Xuất → **Gửi bằng email thường**:
- **Gmail / Google Workspace, 1–10.000 người**: Kết nối Gmail (popup Google, quyền `gmail.send` + email/profile; token chỉ nằm trong bộ nhớ trình duyệt) → dán danh sách hoặc **Nhập CSV** (tự lọc trùng, bỏ địa chỉ sai, loại **danh sách huỷ đăng ký**) → **Gửi thử cho tôi** / **Gửi tới N người**. Một **hàng đợi** gửi mỗi người một email riêng (~1 thư/giây, nhịp bằng Web Worker nên tab nền vẫn chạy), dừng khi đủ **hạn mức ngày** (mặc định 450 cho @gmail.com, 1.800 cho Workspace, chỉnh được ≤ 2.000) hoặc khi Gmail báo giới hạn, và lưu tiến độ trong trình duyệt (`phloem.mailq.<project>`): hôm sau bấm **Tiếp tục gửi** là gửi tiếp từ chỗ dừng, không ai nhận trùng. Token Gmail hết hạn sau 1 giờ (~3.500 thư): bấm Kết nối Gmail rồi Tiếp tục. Gửi qua `gmail.googleapis.com/upload/.../messages/send` (MIME `message/rfc822`, tối đa 35 MB). Gmail cá nhân không gửi 10.000 thư trong một ngày được: 10.000 người mất ~20 ngày (cá nhân) hoặc ~5 ngày (Workspace); cần nhanh hơn hoặc theo dõi mở/click thì dùng Mailchimp/Klaviyo / dịch vụ gửi mail.
- **Outlook / Apple Mail / Thunderbird**: **Tải .eml** (có `X-Unsent: 1` → Outlook mở thành bản nháp; Apple Mail/Thunderbird dùng Gửi lại).
- Email dựng bằng `src/shared/mime.ts`: multipart/related (text + HTML) với các lát ảnh nhúng `cid:` nên không cần host ảnh; link `*|UNSUB|*`/`*|UPDATE_PROFILE|*` đổi thành mailto về người gửi, thêm header `List-Unsubscribe`.
- Google Cloud (project `phloem-studio`): Gmail API đã bật, scope `gmail.send` đã khai báo trong Data access. Đây là scope nhạy cảm: đến khi Google duyệt (cần video demo YouTube), người dùng thấy màn hình "Google chưa xác minh ứng dụng" (bấm Nâng cao → Tiếp tục) và app giới hạn 100 người dùng.

## Database (admin)

Email admin (`ADMIN_EMAILS`, mặc định `vankhanh.le@sentryxp.com`) đăng nhập bằng Google một lần → Home hiện **Database** và **Quản lý AI**. Trang Database: số liệu tổng (người dùng, project, ảnh, dung lượng, mã AI, yêu cầu chờ), thẻ Sao lưu (Sao lưu ngay lên R2, Tải file .db bản đầy đủ), thẻ Relay (commit, AI, Google), bảng người dùng (cấp/thu hồi AI, xoá tài khoản kèm toàn bộ dữ liệu), bảng project và ảnh, tìm kiếm. Relay: `GET /admin/db`, `POST /admin/backup`, `GET /admin/db/export`, `POST /admin/user/delete`.

## Kho hàng và gợi ý nên đẩy gì

Trang chủ Studio → **Kho hàng**: nhập sản phẩm từ Google Sheet (share "Anyone with the link" hoặc Publish to web → CSV; relay tải qua `POST /csv`), file CSV, hoặc cửa hàng Shopify. Cột tự nhận (VI/EN): tên, giá, giá cũ, giá vốn, tồn kho, đã bán, danh mục, ảnh, link, mô tả. Bấm **AI gợi ý**: Claude đọc kho (tồn nhiều/bán chậm, bán chạy, sắp hết, biên cao, mùa vụ) và trả 3–5 chiến dịch nên làm, mỗi gợi ý có sản phẩm cụ thể, lý do, loại email, subject. Tick sản phẩm (hoặc bấm "Dựng email từ gợi ý") → mở Dựng bằng AI với đúng tên/giá/link/ảnh sản phẩm. Kho lưu trên máy và đồng bộ lên relay (`/db/kv/catalog`) khi có tài khoản relay. Ảnh sản phẩm trong email hiển thị trọn (contain), không cắt.

## Đăng nhập bằng Google

Nút "Continue with Google" hiện trong hộp Đăng nhập khi relay báo có `GOOGLE_CLIENT_ID` (`GET /` → `google`). Cài một lần (chủ repo làm, ~5 phút):
1. console.cloud.google.com → chọn project → **Google Auth Platform** (giao diện mới; bản cũ là APIs & Services → OAuth consent screen): **Branding** → App name "Phloem Studio", User support email, Developer contact email → Save. **Audience** → External; đang Testing thì thêm email người dùng vào Test users (hoặc Publish app — scope cơ bản openid/email/profile không cần Google duyệt).
2. **Clients → + Create client → Web application**, tên "Phloem Studio". Authorized JavaScript origins: `https://dorisle-uxui.github.io` (và `http://localhost:5173` khi dev). Authorized redirect URIs: để trống (Google Identity Services dùng popup). Create → copy **Client ID**.
3. Copy Client ID (`…apps.googleusercontent.com`) → Render → service `phloem-relay` → Environment → thêm `GOOGLE_CLIENT_ID` → Save. Relay tự deploy lại (~2 phút).
4. Trên Studio: Cài đặt → Relay URL phải là `https://phloem-relay.onrender.com` (bản public tự đổi nếu còn giá trị localhost cũ) → Đăng nhập → Continue with Google. Relay xác minh ID token qua `oauth2.googleapis.com/tokeninfo`, tạo/tìm tài khoản theo email và mở phiên relay; project trên máy có thể "Chuyển vào tài khoản".

Lưu ý gói free Render: SQLite nằm trong container nên **tài khoản và project trên relay bị xoá mỗi lần deploy**. Hai cách giữ dữ liệu:
- **Miễn phí — sao lưu lên bucket S3** (`server/src/backup.mjs`, không phụ thuộc thư viện): lúc khởi động container mới, relay tải `phloem.db` + `auth-secret` từ bucket về; sau đó cứ 10 phút (và khi Render tắt instance cũ, SIGTERM) chụp bản nhất quán (`VACUUM INTO`) và đẩy lên nếu có thay đổi. Cài: Cloudflare → R2 → Create bucket (ví dụ `phloem`) → Manage R2 API Tokens → token quyền Object Read & Write cho bucket đó → Render → Environment thêm `BACKUP_S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `BACKUP_S3_BUCKET=phloem`, `BACKUP_S3_KEY`, `BACKUP_S3_SECRET` (+ `BACKUP_S3_REGION=auto`, mặc định). Backblaze B2 / AWS S3 / MinIO dùng y vậy (region đúng của bucket). Health `GET /` trả `backup: {at, kb, error}` để kiểm tra. Mất tối đa 10 phút dữ liệu nếu instance chết đột ngột.
- **Trả phí** — Render Starter + Persistent Disk 1 GB mount `/var/data` và `DATA_DIR=/var/data` (khoảng 7 USD/tháng): không cần bucket.
Đặt thêm `AUTH_SECRET` (chuỗi ngẫu nhiên dài) trên Render để token/phiên và hồ sơ client mã hoá không phụ thuộc file secret trong container.

## Import từ Figma

Studio → Import Figma cần Personal access token có quyền **File content: Read** (tuỳ chọn thêm Dev resources: Read). Token thiếu quyền này bị Figma trả `403 Invalid scope(s)`; tạo token mới trong Figma → Settings → Security → Personal access tokens và tick quyền đó.
