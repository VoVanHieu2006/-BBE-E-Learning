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

## 2. Đã sửa ở phiên 1 (commit f454634)

| File | Sửa gì |
|---|---|
| `src/app/api/v1/leaderboard/chapters/route.ts` | GET không còn tạo "tháng thi đua" tùy ý từ `?month=` (người lạ tạo được ~96 nghìn dòng, cron đóng tháng sẽ ôm hết). Chỉ tạo tháng hiện tại bằng `ensureCompetitionMonth`. |
| `src/app/api/v1/auth/password-reset/request/route.ts` | Giới hạn 1 email/phút và 3 email/giờ cho mỗi tài khoản (đếm trong DB). Body sai không còn lỗi 500. |
| `src/app/api/v1/auth/login/route.ts` | Kiểm tra kiểu/độ dài email, mật khẩu; lỗi 500 không còn trả chi tiết nội bộ. |
| `src/app/api/v1/leaderboard/route.ts` | BXH công khai: bỏ truy vấn xác thực vô ích, cho CDN Vercel cache 30 s (spam không chạy function), chặn `page`/`limit` bất thường. |
| `src/app/api/v1/youtube/info/route.ts` | Chỉ Admin được gọi (trước đây ai cũng gọi được, tốn quota YouTube). |

Typecheck đạt; 70 suite unit đạt.

## 3. Các phiên tiếp theo

Mỗi phiên chạy riêng, có kiểm tra riêng, commit riêng. Phiên đánh dấu **Codex** có thể giao cho `codex exec` model gpt-6.2-astra; Claude review diff, chạy tsc + test trước khi merge.

### Phiên 1 — Kiểm tra và commit phần đã sửa — XONG (20/11)
- Nhánh `fix/security-audit-batch-1`, commit `f454634`. 70 suite unit đạt.
- Thêm test: `?month=` cũ không tạo tháng mới (`scripts/test/test-p05-routes.cjs`); giới hạn email đặt lại mật khẩu (`src/test/password-reset-request-throttle.test.ts`).
- Đã thu hẹp sửa `leaderboard/chapters`: chỉ tạo tháng khi `?month=` đúng tháng hiện tại, giữ nguyên hành vi cũ khi không có `?month=`.

### Phiên 2 — Chống spam đăng nhập và lộ email (Claude, ~1 giờ)
Quyết định của chủ dự án (20/11):
- Giữ khóa vĩnh viễn sau 5 lần sai (không đổi luật).
- **Bỏ dòng "Bạn còn N lần thử"**: hiện tại email sai chỉ báo "Tài khoản hoặc mật khẩu không đúng", email đúng thì thêm "Bạn còn N lần" → lộ email nào tồn tại.
- Trang Quên mật khẩu đổi sang **thông báo chung** (bỏ "Không tìm thấy email").

Các bước:
1. `src/app/api/v1/auth/login/route.ts`: bỏ `remainingAttempts` khỏi response; chạy bcrypt giả khi email không tồn tại để thời gian phản hồi giống nhau. Kiểm tra khóa trước bcrypt như hiện tại.
2. `src/app/login/page.tsx`: bỏ hiển thị "Bạn còn N lần thử".
3. `password-reset/request/route.ts`: bỏ trường `sent`; `src/app/forgot-password/page.tsx`: luôn hiện "Nếu email tồn tại, link đã được gửi".
4. Xem lại các mã lỗi riêng (`AccountInactive`, `NoActiveAffiliation`, `AccountLocked`): chỉ trả khi mật khẩu đúng, để email + mật khẩu sai không lộ trạng thái tài khoản. Không đổi luật khóa.
5. Chủ dự án tự thêm 1 rule Rate Limit trên Vercel Firewall (hướng dẫn ở báo cáo cuối phiên).
6. Test: `src/test/login-lock.test.ts` cập nhật; thêm test: email không tồn tại và email đúng/mật khẩu sai trả body giống hệt nhau.

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

### Phiên 7 — Giảm tốn quota video: heartbeat 20 giây (Claude) — đã duyệt
Yêu cầu bắt buộc của chủ dự án: **không được làm hỏng đánh dấu hoàn thành**. Xem hết video phải ghi nhận đúng 100%, không được kẹt ở 98% như lỗi cũ; video dưới 20 giây phải đúng.
1. Đọc kỹ luồng hiện tại trước khi sửa: `src/components/YouTubePlayer.tsx` (heartbeat dòng 688–700, sự kiện `ENDED` dòng ~600, PLAY/PAUSE/ẩn tab), `src/lib/video-heartbeat.ts`, `src/lib/video-progress-rules.ts`, `heartbeatElapsed`/`MAX_HEARTBEAT_GAP_SECONDS = 300` trong `src/lib/learning-cycle-rules.ts`.
2. Chỉ đổi nhịp: video ≥ 30 giây gửi 20 s/lần; video < 30 giây giữ 3 s/lần như cũ. PLAY, PAUSE, ẩn tab, đổi tốc độ, `ENDED` vẫn gửi ngay như hiện tại.
3. Chứng minh `ENDED` tự đủ: server cộng thời gian thực từ heartbeat cuối (≤ 20 s, nhỏ hơn giới hạn 300 s) nên lần gửi cuối vẫn đẩy tiến độ lên 100%. Viết test cho đúng tình huống: heartbeat cuối cách điểm kết thúc 19 s → `ENDED` phải hoàn thành bài.
4. Test hiện có: `test:video-progress-session`, `test:video-guard`, `video-continuity-security`, `test:video-player-browser` (Playwright) — tất cả phải đạt.
5. Thêm test: video 15 s, video 25 s, video dài xem liền đến hết, tạm dừng gần cuối rồi xem tiếp, tốc độ 2x.
6. `playbackRate` thiếu ở `lessons/[lessonId]/progress/route.ts:40` mặc định 2 → đổi thành 1 (chỉ ảnh hưởng client cũ không gửi tốc độ).
7. Cập nhật `docs/performance.md` bằng số đo Vercel thật (36 ms/heartbeat). Dự kiến: 1 giờ xem ≈ 6–7 s CPU thay vì 13 s → ~7 giờ học/người/tháng với 250 người.

### Phiên 8 — Nút "Đã lưu" trong trình sửa khóa học (Claude) — việc mới
Hiện tượng (ảnh chụp 20/11): admin thêm bài học, nút trên cùng vẫn hiện "Đã lưu" dù chưa lưu thật; phải bấm "Cập nhật khóa học" mới lưu.
1. Đọc `src/app/admin/courses/[courseId]/edit/useCourseEditor.ts` và component thanh trên cùng: tìm trạng thái "Đã lưu" lấy từ đâu (bản nháp tự lưu `courses/[courseId]/draft` hay bản chính).
2. Xác định nguyên nhân: có thể "Đã lưu" nghĩa là đã lưu **bản nháp** chứ không phải đã cập nhật khóa học cho học viên.
3. Đề xuất (chờ duyệt sau khi đọc code): bỏ nút "Đã lưu"; thay bằng nhãn trạng thái rõ ràng: "Có thay đổi chưa cập nhật" (màu cam) khi khác bản đang xuất bản, "Đã cập nhật" khi trùng.
4. Test: unit test cho hàm tính trạng thái; Playwright: thêm bài → nhãn "chưa cập nhật" → bấm Cập nhật → nhãn đổi.

## 4. Hỏi đáp
**Nhãn "Mới" ở danh sách bài tồn tại bao lâu?** Không tính theo thời gian. Bài được gắn "Mới" với một học viên khi bài đó được tạo **sau** lần đầu học viên bắt đầu khóa, và nhãn mất khi học viên **hoàn thành bài đó** (`isNewForLearner`, `src/lib/lesson-learning-state.ts:48`). Học viên chưa từng học khóa thì không thấy nhãn.

## 5. Những gì đã kiểm tra và ổn
- SQL injection: chỉ dùng truy vấn tham số hóa.
- Chấm điểm quiz làm ở server, chống nộp lặp; tiến độ video không tua vượt được.
- Mật khẩu bcrypt cost 12; cookie httpOnly + secure; `.env` không bị commit.
- Admin route đều kiểm tra vai trò; route chapter/tổ chức kiểm tra phạm vi.
