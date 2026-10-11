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

## Bật AI (trợ lý + dựng 3 phương án)

Bản tĩnh trên GitHub Pages không chứa khoá API. Có ba cách để AI chạy:

| Cách | Khi nào dùng | Làm gì |
| --- | --- | --- |
| Bản claude.ai | Nhanh nhất, không cần khoá | Mở artifact Phloem Studio trên claude.ai, AI dùng ngay qua tài khoản của bạn |
| Dán khoá trong Studio | Dùng bản GitHub Pages | Cài đặt → AI → dán `sk-ant-…` và chọn model. Khoá chỉ lưu trong trình duyệt đó |
| Relay cục bộ | Đội nhóm, không muốn chia khoá | `cp server/.env.example server/.env`, điền `ANTHROPIC_API_KEY`, chạy `npm run relay`, trong Studio đặt Relay URL `http://localhost:8787`. Khoá nằm ở máy chạy relay, không bao giờ lên repo |

Relay cũng là nơi giữ khoá Mailchimp/Klaviyo cho OAuth và chặn mọi lệnh gửi/lên lịch.

## Import từ Figma

Studio → Import Figma cần Personal access token có quyền **File content: Read** (tuỳ chọn thêm Dev resources: Read). Token thiếu quyền này bị Figma trả `403 Invalid scope(s)`; tạo token mới trong Figma → Settings → Security → Personal access tokens và tick quyền đó.
