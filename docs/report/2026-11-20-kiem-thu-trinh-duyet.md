# Kiểm thử trình duyệt — phiên 1, 2, 7, 8 (20/11/2026)

Nhánh `fix/security-audit-batch-1` sau khi gộp 3 nhánh phiên 2, 7, 8 (merge `198a16b`). Typecheck sạch, 72 suite unit đạt.

**Môi trường:** web chạy `next dev` ở `localhost:3005` (cấu hình `e2e-localdb` trong `.claude/launch.json`), database **local riêng** `bbe_test_e2e` trong container Docker `bbe-test-pg` (baseline + migrate + `db:seed` + `db:seed-rich`). `RESEND_API_KEY` để trống nên không gửi email thật. Không đụng Supabase thật.

Dữ liệu demo đã chỉnh cho test (chỉ trong DB test): 1 khóa bỏ ảnh bìa và gán chương trình; video bài 1 đổi sang video YouTube nhúng được (213 s).

## Kết quả

| # | Kịch bản | Kết quả |
|---|---|---|
| 1 | Đăng nhập email không tồn tại vs email đúng + mật khẩu sai | ✅ Cùng status 401, body giống hệt; thời gian ~430–520 ms cả hai |
| 2 | Màn hình đăng nhập sau khi sai mật khẩu | ✅ Không còn "Bạn còn N lần thử" |
| 3 | Sai 5 lần → khóa | ✅ Vẫn khóa. Sai mật khẩu khi đã khóa → báo chung; đúng mật khẩu → "Tài khoản đã bị khóa…" (403) |
| 4 | Đăng nhập đúng (học viên, admin) | ✅ |
| 5 | Kiểu dữ liệu sai (`password: 123`) | ✅ 400, không lỗi 500 |
| 6 | Quên mật khẩu, email không tồn tại (giao diện) | ✅ "Nếu email tồn tại trong hệ thống, link … đã được gửi" |
| 7 | Quên mật khẩu, gửi 4 lần liên tiếp cho 1 tài khoản | ✅ Chỉ tạo 1 link (DB đếm 1); 5 phản hồi giống hệt, không có `sent` |
| 8 | BXH chapter `?month=1990-01 / 2020-05 / 9999-12` khi không đăng nhập | ✅ `PERIOD_UNAVAILABLE`; số tháng thi đua trong DB giữ nguyên 2 |
| 9 | BXH thành viên công khai | ✅ 200, header `public, s-maxage=30, stale-while-revalidate=60`; `page=abc&limit=-5` không lỗi |
| 10 | Trang `/leaderboard` khi chưa đăng nhập | ✅ Tải được (báo "kỳ chưa mở" vì dữ liệu demo chỉ tới tháng 10, phần code không đổi) |
| 11 | `youtube/info`: không đăng nhập / học viên / admin | ✅ 401 / 403 / 200 |
| 12 | Trình sửa khóa học: mở trang | ✅ Không còn nút "Đã lưu"; nhãn "Đã cập nhật", nút Cập nhật/Bỏ thay đổi bị khóa |
| 13 | Thêm bài khi bản nháp lưu lỗi | ✅ Nhãn "Lỗi lưu nháp, thử lại" (trước đây vẫn hiện "Đã lưu") |
| 14 | Thêm bài khi lưu nháp được | ✅ "Có thay đổi chưa cập nhật", nút Cập nhật bật |
| 15 | Bấm Cập nhật khi khóa chưa phân loại chương trình | ✅ Báo "Hãy phân loại chương trình trước khi xuất bản." (toast) |
| 16 | Bấm Cập nhật hợp lệ | ✅ Nhãn về "Đã cập nhật"; bài mới có trong DB, thời lượng 19 s đúng |
| 17 | Học viên xem video 213 s ở tốc độ 2x | ✅ Heartbeat đúng **mỗi 20 s**; heartbeat cuối ở giây 198, ENDED đưa lên **213/213, hoàn thành**; giao diện "✓ Đã xem hết video (100%)", +3 sao, mở bài tiếp |
| 18 | Học viên xem video 19 s ở 1x | ✅ Heartbeat giữ **3 s/lần**; ENDED **19/19, hoàn thành**; 2/2 bài |

## Phát hiện mới

1. **Ảnh bìa đường dẫn tương đối làm hỏng lưu nháp** (`src/lib/course-draft.ts:50` chỉ nhận `https://`). Cả 11 khóa demo có ảnh bìa `/images/course-covers/...` nên **mọi** chỉnh sửa trên các khóa này lưu nháp thất bại. Lỗi có từ khi làm tính năng bản nháp (`394a927`), không do đợt sửa này. Ảnh upload thật đi qua Cloudinary (`https://`), nên site thật chỉ bị nếu có khóa còn dùng ảnh bìa mặc định kiểu tương đối. Nhãn mới ở phiên 8 giờ đã báo lỗi này thay vì "Đã lưu".
2. Màn hình học, cột danh sách bài vẫn ghi 12:00 cho bài 1 sau khi đổi video trong DB test. Đây là do chỉnh DB tay, không phải lỗi app.

## Chưa kiểm trên trình duyệt
- Tạm dừng gần cuối rồi xem tiếp, ẩn tab rồi quay lại (đã có unit test ở phiên 7).
- Giao diện điện thoại.
- Đo CPU thật trên Vercel sau khi deploy (cần deploy rồi xem Observability 12 giờ).
