# Audit bảo mật, chống DDoS và sức chịu tải — kế hoạch chia phiên

Ngày 20/11/2026. Phạm vi: toàn bộ `src/app/api` (105 route), middleware, đăng nhập, cron, cấu hình Vercel.
Nguồn số liệu: dashboard Vercel 12 giờ (người dùng chụp) + đọc code. Chưa chạy load test thật.

## 1. Sức chịu tải — trả lời ngắn

**Giới hạn thật của web là quota CPU 4 giờ/tháng của gói Hobby, không phải số người vào cùng lúc.** Vercel tự mở thêm function khi đông; với 200–300 học viên, số người online cùng lúc không phải vấn đề. Nhưng hết 4 giờ CPU thì Vercel **tạm dừng web tới tháng sau**.

Chi phí CPU đo trên Vercel thật (12h, 20/11):

| Việc | CPU mỗi lần | Ghi chú |
|---|---:|---|
| Gửi tiến độ video (`lessons/[id]/progress`) | ~36 ms | 59 lần / 2,13 s; gửi mỗi 10 s khi xem |
| Đăng nhập (`auth/login`) | ~390 ms | bcrypt cố ý chậm |
| Danh sách khóa học, BXH, `auth/me` | 35–100 ms | |

Quy đổi:

- 1 giờ xem video ≈ 360 lần gửi × 36 ms ≈ **13 s CPU**, cộng mở trang ≈ **15 s/giờ học**.
- 4 giờ = 14.400 s → khoảng **950 giờ học/tháng cho cả hệ thống**.
- Với 250 học viên ≈ **3,8 giờ học/người/tháng**. Vượt mức này là chạm trần.
- Spam đăng nhập: 14.400 / 0,39 ≈ **37.000 lần là cạn quota**. 10 lần/giây → cạn trong ~1 giờ.

Không bắn tải thật vào Vercel: chính sách Vercel không cho load test gói Hobby và sẽ đốt đúng quota này. Muốn đo sâu hơn thì chạy bộ k6 có sẵn trong `load-tests/` trên máy local (phiên 7).

## 2. Đã sửa trong phiên này (chưa commit)

| File | Sửa gì |
|---|---|
| `src/app/api/v1/leaderboard/chapters/route.ts` | GET không còn tạo "tháng thi đua" tùy ý từ `?month=` (người lạ tạo được ~96 nghìn dòng, cron đóng tháng sẽ ôm hết). Chỉ tạo tháng hiện tại bằng `ensureCompetitionMonth`. |
| `src/app/api/v1/auth/password-reset/request/route.ts` | Giới hạn 1 email/phút và 3 email/giờ cho mỗi tài khoản (đếm trong DB). Body sai không còn lỗi 500. |
| `src/app/api/v1/auth/login/route.ts` | Kiểm tra kiểu/độ dài email, mật khẩu; lỗi 500 không còn trả chi tiết nội bộ. |
| `src/app/api/v1/leaderboard/route.ts` | BXH công khai: bỏ truy vấn xác thực vô ích, cho CDN Vercel cache 30 s (spam không chạy function), chặn `page`/`limit` bất thường. |
| `src/app/api/v1/youtube/info/route.ts` | Chỉ Admin được gọi (trước đây ai cũng gọi được, tốn quota YouTube). |

Typecheck: đạt (chỉ lỗi cũ trong `scratch/`). Chưa chạy unit test, chưa commit.

## 3. Các phiên tiếp theo

Mỗi phiên chạy riêng, có kiểm tra riêng, commit riêng. Phiên đánh dấu **Codex** có thể giao cho `codex exec` model gpt-6.2-astra; Claude review diff, chạy tsc + test trước khi merge.

### Phiên 1 — Kiểm tra và commit phần đã sửa (Claude, ~15 phút)
1. Chạy `npm test` (unit) và các test liên quan: `src/test/login-lock.test.ts`, test leaderboard, test password reset nếu có.
2. Thêm test nhỏ: GET `leaderboard/chapters?month=1990-01` không tạo dòng mới; reset mật khẩu lần 2 trong 1 phút không gửi mail.
3. Commit trên nhánh mới `fix/security-audit-batch-1`.

### Phiên 2 — Chống spam đăng nhập (Claude, ~1 giờ) — cần bạn quyết định trước
1. **Bạn tự làm trên dashboard Vercel (5 phút, miễn phí):** Firewall → Rules → thêm 1 rule Rate Limit: path `/api/v1/auth/login` và `/api/v1/auth/password-reset/request`, 10 request/60 s mỗi IP, hành động Deny 429. Bị chặn ở đây thì không tốn CPU.
2. Code: kiểm tra trạng thái khóa trước khi chạy bcrypt; chạy bcrypt giả khi email không tồn tại (không lộ email qua thời gian phản hồi).
3. **Quyết định:** hiện sai 5 lần là khóa vĩnh viễn, chỉ mở bằng email. Kẻ xấu có thể cố ý khóa tài khoản người khác. Đề xuất: khóa tạm 15 phút, tăng dần nếu tiếp tục sai.
4. **Quyết định:** trang Quên mật khẩu đang báo "không tìm thấy email" → lộ email nào có trong hệ thống. Giữ (tiện cho học viên) hay đổi thành thông báo chung?
5. Tùy chọn: Cloudflare Turnstile (ô "tôi không phải robot", miễn phí) hiện sau 3 lần sai.
6. Test: `login-lock.test.ts` + test mới cho khóa tạm.

### Phiên 3 — XSS và Content-Security-Policy (Codex gpt-6.2-astra, Claude review)
1. `sourceUrl` chuyển đội (`chapters/[chapterId]/reorganizations/route.ts:243`, hiển thị ở `TransferHistory.tsx:135`): chỉ nhận link `https://docs.google.com/...` khi lưu, chỉ render khi bắt đầu bằng `https:`. Đây là lỗi nặng nhất của audit phân quyền: Chapter Lead cài link `javascript:` → Admin bấm vào là bị chiếm phiên.
2. Thêm header CSP vào `next.config.js` (cho phép YouTube, R2, Google Fonts nếu có); bỏ `X-XSS-Protection` lỗi thời. Chạy chế độ `Report-Only` trước, kiểm tra trình phát video, upload tài liệu, đăng nhập rồi mới bật thật.
3. Test: unit test cho hàm kiểm tra URL; mở thử các trang chính trong trình duyệt.

### Phiên 4 — Token ra khỏi localStorage (Claude, ~2 giờ, rủi ro cao nhất)
1. Login/refresh ngừng trả `accessToken`/`refreshToken` trong JSON; chỉ dùng cookie httpOnly đã có.
2. `refresh` không nhận token từ body; xoay vòng refresh token mỗi lần dùng.
3. Sửa client: `src/lib/api/client.ts`, `login/page.tsx`, các layout admin/chapter-manager/student đang đọc localStorage.
4. Test: Playwright đăng nhập → xem bài → hết hạn token → tự refresh → đăng xuất, cho cả 3 vai trò.

### Phiên 5 — Lộ dữ liệu và lỗi nhỏ (Codex gpt-6.2-astra, việc lặp lại)
1. `sessions/[sessionId]` GET: thêm kiểm tra đăng nhập/xuất bản/mở khóa như `lessons/[lessonId]`.
2. Bình luận bài học trả `userEmail` của người khác → đổi sang tên hiển thị; thêm `take: 50` và giới hạn đăng bình luận.
3. ~20 route trả `err.message` cho client → log server, trả câu cố định.
4. `health`: người lạ chỉ nhận `{ok}`; bản chi tiết cần `CRON_SECRET`.
5. `request.json()` không bắt lỗi → thêm `.catch`; `courses` chặn `page` bất thường.
6. Test: `npm test` + typecheck.

### Phiên 6 — Cron và bí mật (Codex gpt-6.2-astra)
1. So sánh `CRON_SECRET` bằng `crypto.timingSafeEqual` ở 3 route `/api/internal/*`.
2. `attempts/auto-submit`: bỏ `GET = POST` khi dùng cookie Admin (chống CSRF).
3. Thiếu `JWT_*_SECRET` thì báo lỗi rõ ràng thay vì dùng chuỗi rỗng.
4. Khóa API Google trong `src/lib/youtube/duration.ts:49` chuyển sang biến môi trường.

### Phiên 7 — Giảm tốn quota video và đo tải local (Claude) — cần bạn quyết định
1. **Quyết định:** đổi nhịp gửi tiến độ từ 10 s lên 20–30 s → giảm 2–3 lần CPU video (≈ 7–11 giờ học/người/tháng). Server vẫn chặn tua nhanh vì tính theo thời gian thực; cần kiểm tra lại quy tắc `MAX_HEARTBEAT_GAP_SECONDS = 300` và test video.
2. `playbackRate` thiếu đang mặc định 2 → đổi thành 1.
3. Tùy chọn: chạy bộ k6 `load-tests/` trên bản build local + DB local để vẽ đường cong tải (0 quota Vercel).
4. Cập nhật `docs/performance.md` bằng số đo Vercel thật ở mục 1.

## 4. Những gì đã kiểm tra và ổn
- SQL injection: chỉ dùng truy vấn tham số hóa.
- Chấm điểm quiz làm ở server, chống nộp lặp; tiến độ video không tua vượt được.
- Mật khẩu bcrypt cost 12; cookie httpOnly + secure; `.env` không bị commit.
- Admin route đều kiểm tra vai trò; route chapter/tổ chức kiểm tra phạm vi.
