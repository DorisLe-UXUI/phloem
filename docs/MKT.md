# Phloem MKT

Bộ công cụ tự động hoá marketing cho agency, chạy chung bundle với Phloem Email.
Mở tại `mkt/` (GitHub Pages: https://dorisle-uxui.github.io/phloem/mkt/). Mỗi khách hàng là một workspace riêng.

Prompt gốc và lộ trình: [PROMPT-PHLOEM-MKT.md](PROMPT-PHLOEM-MKT.md).

## Đã xong

| Giai đoạn | Có gì |
|---|---|
| 0. Nền tảng | Trang Tổng quan (việc cần duyệt, bài sắp đăng 7 ngày, bảng theo khách), danh sách khách hàng, **Tạo khách hàng** (tên, website, ngành → mở ngay bước Thương hiệu), workspace có 9 tab, chuyển khách ⌘K, thành viên + vai trò theo từng khách (owner, quản lý, thiết kế, nội dung, quảng cáo, khách xem), nhật ký thao tác, xuất ZIP, xoá vĩnh viễn (gõ lại tên), tab Email = Phloem Email lọc theo khách, email mới tự gắn khách và dùng brand kit. |
| 1. Thương hiệu | Nguồn: website (đọc qua relay: màu, font, logo, nội dung, trang con), Google Sheet (chia sẻ công khai), link Drive (lưu làm nguồn), file tải lên (PDF guideline gửi thẳng cho Claude, ảnh, .txt/.md). AI viết brand book (JSON có kiểm tra) → trang brand book theo đúng màu/font khách, sửa từng phần, lịch sử phiên bản, gửi khách duyệt, brand kit (màu, font, logo, hashtag, CTA) áp vào email mới. |
| 2. Kế hoạch | Thiết lập 1–12 tháng, kênh (Meta, TikTok, Google, LinkedIn), mục tiêu, ngân sách, tần suất, sự kiện riêng; tự thêm dịp Việt Nam (Tết, 8/3, 30/4, 2/9, 20/10, 11.11, Black Friday, Trung thu, sale đôi…). AI lập chiến lược + trụ cột + KPI, lịch đăng tính sẵn (giờ đẹp theo kênh), AI viết từng bài theo tháng (3 tháng song song). Lưới kiểu Sheets (đầu bảng và cột # cố định, nhóm theo tháng/kênh/trạng thái/trụ cột, lọc, tìm, sửa ô bằng bấm đúp/Enter, tô màu theo kênh), Lịch (kéo thả đổi ngày), Kanban (kéo đổi trạng thái), Tóm tắt 1 trang, Ngân sách (biểu đồ chồng theo kênh), KPI. Xuất XLSX (4 trang), CSV, PDF. Link duyệt cho khách: duyệt/cần sửa từng bài, bình luận, duyệt toàn bộ; phản hồi tự đổ ngược vào kế hoạch. Bài đã duyệt hiện ở Thiết kế và Lịch đăng (đăng tay: copy caption, đánh dấu Đã lên lịch / Đã đăng). |

## Dữ liệu và cách ly

- Relay (`server/src/db.mjs`): `clients`, `client_items` (brand, plan, review, …), `client_audit`, `client_shares`, `client_members`; `projects.client_id`.
- Mọi route `/db/client/:id/...` tính quyền của người gọi với **đúng khách đó** trước (owner hoặc thành viên), rồi mới đọc/ghi bằng câu lệnh có điều kiện chủ sở hữu. `client_id` từ trình duyệt không bao giờ tự mở được dữ liệu.
- Link duyệt `/share/:token`: chỉ lưu hash của token, hết hạn (mặc định 30 ngày), thu hồi được; token nằm sau `#` của URL nên không vào log máy chủ. Khách chỉ ghi được bản ghi `review` của đúng mục đó, mỗi lần ghi vào nhật ký là "Khách: tên".
- Tài khoản local (không có relay): khách hàng lưu trong trình duyệt theo tài khoản; chưa có link duyệt, thành viên.
- Test: `test/clients.test.mjs` (lớp db), `test/clients-api.test.mjs` (HTTP thật: A không đọc/ghi/xuất/xoá được khách của B, vai trò chặn ghi, link duyệt chỉ ghi vào đúng khách), `test/mkt-plan.test.mjs` (phân bổ ngân sách cộng đúng tổng, lịch đăng, ngày lễ Việt Nam, CSV/XLSX).

## API relay

```
GET    /db/clients                          khách của tôi + khách được mời (kèm vai trò)
PUT    /db/clients/:id                      tạo / sửa (owner, quản lý)
DELETE /db/clients/:id?confirm=<tên>        xoá khách và mọi thứ thuộc khách (chỉ owner)
GET    /db/client/:id/items[?kind=]         dữ liệu của khách
PUT    /db/client/:id/items/:kind/:itemId   ghi (vai trò có quyền ghi)
DELETE /db/client/:id/items/:kind/:itemId
GET    /db/client/:id/audit                 nhật ký
GET    /db/client/:id/export                toàn bộ dữ liệu (owner, quản lý)
GET|POST /db/client/:id/share               link duyệt   DELETE /db/client/:id/share/:linkId
GET|PUT|DELETE /db/client/:id/members[/:email]
GET    /share/:token                        (công khai) nội dung cần duyệt
POST   /share/:token/review                 (công khai) {name, rows:{id:'approved'|'changes'}, comments, overall}
```

## Chạy thử local

```bash
npm ci && npm test
node build.mjs --studio
PORT=8788 node server/src/index.mjs     # relay (ANTHROPIC_API_KEY trong server/.env cho AI thật)
PORT=5174 node dev/serve.mjs            # mở http://localhost:5174/mkt/
```

Trong Cài đặt của Studio, `API key = mock` chạy AI giả lập để thử giao diện không tốn tiền.

## Còn lại / việc cần làm tay

- Relay trên Render: bấm **Manual Deploy** sau khi merge (route mới và bảng mới nằm ở relay).
- Google Drive riêng tư và xuất thẳng Google Sheets cần thêm scope Google (`drive.readonly`, `spreadsheets`) vào OAuth app `phloem-studio` và Google duyệt; hiện tại tải file Drive lên tay, xuất XLSX rồi mở bằng Google Sheets.
- Thành viên chỉ thêm được người đã có tài khoản Phloem; email của khách vẫn nằm trong tài khoản chủ workspace (thành viên chưa sửa được email).
- Giai đoạn 3–7 (Phloem Design, đăng qua API, Quảng cáo, Video, Báo cáo + cổng khách) chưa làm.
