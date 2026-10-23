# BBE E-Learning — báo cáo sửa lỗi và nghiệm thu (2026-10-23)

## 1. Phạm vi và môi trường

- Nhánh: `main`, commit gốc `e90ee10`.
- Database: Supabase hiện tại (được người dùng xác nhận là môi trường dev/test để seed).
- Đã sao lưu 35 bảng liên quan trước khi ghi: `scratch/backup-pre-fix-2026-10-23T07-03-26-904Z.json` (file local, không commit).
- Không đọc hoặc in secret. Các lệnh Prisma/Seed dùng `DATABASE_URL` từ `.env` với `sslmode=disable` do giới hạn TLS của máy chạy kiểm thử.

## 2. Nguyên nhân gốc đã xác định

### P0.1 — Video không lên tiến độ, nặng hơn ở 2x

1. Heartbeat đầu tiên tạo bản ghi replay nhưng `elapsed = 0`; mốc thời gian sau đó bị mất. Khi tốc độ 2x, mất tối đa 20–24 giây nội dung ngay từ nhịp đầu.
2. `heartbeatElapsed` chỉ chấp nhận khoảng cách tối đa 30 giây, nên tab bị throttle, mạng chập chờn hoặc heartbeat bị trễ bị coi là 0.
3. Đổi `viewSessionId` (reload/remount) làm mất mốc thời gian.
4. Frontend tự đặt `completed = true` khi player báo `ENDED`, trước khi backend xác nhận.
5. Player thiếu nút **1.75x**.
6. Key player chỉ gồm YouTube ID, nên hai bài dùng cùng video ID không remount đúng.
7. Loading dùng timeout 3.5 giây rồi cho rằng player đã sẵn sàng dù chưa có `onReady`, dẫn tới khung đen.

### P0/BXH — Bảng Chapter 0 người, 0%

1. `GET /api/v1/leaderboard/chapters` chọn tháng theo **KPI mới nhất**, có thể là tháng tương lai; `asOf` nhỏ hơn `starts_at` nên không có stage, trả `ROSTER_ZERO`.
2. `learning_policy.cutover_at = null`, nên 198/200 thành viên chỉ có `lesson_progress` cũ, không có `learning_cycle`, `cycle_lesson_progress`.
3. Công thức Chapter cũ dùng trọng số và cộng dồn tỷ lệ từng chặng, không phải `A_m / N_m`.
4. Seed cũ ghi trực tiếp `lesson_progress` và `star_ledger` nhưng không tạo cycle/affiliation/interval nhất quán.

### Quiz — số câu và thời gian

1. UI lấy `_count.questions` (toàn ngân hàng) thay vì `assessment.question_count` (số câu mỗi lượt).
2. Đồng hồ fallback tính `questionCount * 2` thay vì `assessment.duration_minutes`.
3. Resume dùng thứ tự đáp án trong DB, trong khi lượt đầu đã xáo đáp án → thứ tự đáp án đổi sau khi tải lại.

### Giao diện lộ trình

1. Danh sách bài bị ẩn bớt và gộp “các bài khóa”, trái yêu cầu hiển thị đủ bài.
2. Accordion mở mặc định, không có thu gọn/mở tất cả theo khóa.
3. Màu chương trình không đồng nhất với Admin (LT dùng tím ở Admin nhưng vàng ở học viên).

## 3. Cơ chế ghi tiến độ video mới

- Mỗi heartbeat gửi thêm `playbackRate` và `event` (`PLAY`, `HEARTBEAT`, `PAUSE`, `ENDED`).
- Server khóa user, đọc cycle hiện tại, lesson, replay tháng, cycle progress.
- Nội dung được cộng tối đa `elapsed × min(rate, 2)`; `elapsed` lấy từ mốc heartbeat server, tối đa 300 giây. Tốc độ 2x được chấp nhận; không có quy tắc “1 giây thực tế = 1 giây video”.
- `ENDED` chỉ được cộng thêm tối đa 6 giây grace; không đủ để nhảy cóc từ đầu đến cuối.
- `completed` do client gửi lên bị bỏ qua. Lesson chỉ hoàn thành khi:
  - video đã đạt đủ duration theo dữ liệu server, và
  - nếu có quiz: có attempt `passed` trong cycle hiện tại.
- Replay tháng được ghi riêng (`monthly_video_replays`), không kế thừa tiến độ cũ; Star chỉ được tạo khi replay đạt đủ và `reward_key` chưa tồn tại.
- Nếu Chapter đang bị tạm dừng thưởng, backend ghi `reward_suppressed_at` và không tạo ledger.
- Heartbeat trùng/retry không tạo thêm Star.
- Khi reload, `viewSessionId` mới vẫn dùng `last_heartbeat_at` đã lưu, nên tiếp tục được tiến độ.
- Video page không còn chờ `/my-progress` và `/stars/me` mới hiển thị player; hai request phụ tải nền. Lesson detail có cache 15 giây, `learning/me` cache 5 giây, bảng Chapter cache 30 giây.
- Player có skeleton riêng cho “đang tải thông tin bài học”, “đang khởi tạo trình phát”, “đang buffering”, nút Thử lại và nút 1.75x.

## 4. Kết quả kiểm thử thực tế

### Video (database thật, user tạm và cleanup)

Video dài **309 giây**, xem liên tục:

| Tốc độ | Nội dung ghi nhận | Star | Heartbeat trùng | Seek gian lận |
|---|---:|---:|---|---|
| 1x | 309/309 giây | 5 | Không cộng lần 2 | — |
| 2x | 309/309 giây | 5 | Không cộng lần 2 | — |
| 2x + nhảy từ 0 đến cuối sau 10 giây | 28 giây | 0 | — | Không hoàn thành |

Lệnh: `scripts/verify-video-heartbeat.ts` (đã chạy PASS).

### Quiz

- Assessment thực tế: **3 nhóm × 10 câu**, mỗi lượt lấy **3 câu/nhóm = 9 câu**, thời gian **30 phút**.
- Mô phỏng 1.000 lượt bằng chính hàm chọn câu:
  - 1.000 bộ câu khác nhau;
  - 1.000 thứ tự câu khác nhau;
  - mỗi nhóm luôn được chọn đúng 3 câu;
  - tần suất từng câu 271–324/1.000, không có câu bị bỏ rơi.
- Gọi API tạo attempt thật: `questionCount = 9`, `questions.length = 9`, `durationMinutes = 30`, `expiresAt` còn 1.789 giây.
- Resume cùng attempt: cùng `attemptId`, cùng thứ tự câu, **cùng thứ tự đáp án**.
- Không có câu trùng trong một attempt (chọn từ 3 nhóm, mỗi câu một lần).

### Bảng xếp hạng Chapter hiện tại (tháng 10/2026)

| Hạng | Chapter | Quân số | % đạt ≥70% | Tổng Star | Điểm A/N | KPI |
|---:|---|---:|---:|---:|---:|---|
| 1 | BBE Seed Xuất sắc | 53 | 86,8% | 1.275 | 24,06 | Xanh |
| 2 | BBE Seed Checkpoint 70 | 50 | 70,0% | 1.100 | 22,00 | Vàng |
| 3 | BBE Seed Đúng 50 | 24 | 50,0% | 504 | 21,00 | Xanh |
| 4 | BBE Seed Cân bằng | 40 | 70,0% | 800 | 20,00 | Vàng |

Bị loại đúng quy tắc:

- KPI Đỏ: 30 người, 80% đạt, 900 Star → `KPI_NOT_ELIGIBLE`.
- Đúng 20 người: 100% đạt, 400 Star → `MEMBER_COUNT_NOT_ABOVE_20`.
- Đang học: 22 người, 36,4% đạt → `CORE_COMPLETION_BELOW_50_PERCENT`.
- Nhỏ: 16 người, 0% đạt → loại quân số + tiến độ.
- Chapter Demo: 0% đạt → loại tiến độ.

### Phân quyền

Đã kiểm tra qua HTTP:

- Khách: cả 8 bảng trả 200; không có email trong payload.
- Lead Chapter: xem Member/LT Chapter mình; Chapter khác trả 403; bảng Chapter/DNA trả 403.
- Lead DNA: xem DNA tháng/nhiệm kỳ; bảng Chapter/Member/LT trả 403; TT bị loại khỏi DNA.
- Admin: xem Chapter và dữ liệu toàn hệ thống.
- Snapshot tháng/nhiệm kỳ đã đóng được lọc theo `chapterId`/`dnaUnitId` trước khi trả về.

### Build và test

- `npx tsc --noEmit -p tsconfig.check.json`: PASS.
- `npm run test:business-rules`: 60/60 PASS.
- `npm run test:learning-cycles`: 24/24 PASS.
- `npm run build`: PASS, 73 trang được generate.
- `git diff --check`: không còn lỗi whitespace.

## 5. Dữ liệu seed

Đã tạo:

- 8 Chapter mô phỏng + Chapter Demo hiện có, quy mô 16–53 thành viên, gồm Chapter đúng 20, đúng 50%, 70%, dưới 50%, KPI Đỏ/Vàng/Xanh.
- 50 bài lõi thuộc ba chương trình CORE_MEMBER/CORE_LEADER/CORE_DNA (42 bài cũ + 8 bài practicum).
- Tiến độ 0%, 10%, 34/50 (68%), 35/50 (70%), 36/50 (72%), 40/50, 50/50.
- Star cho tháng 9 và tháng 10; Star của user seed cũ đã được thay bằng ledger `rich-seed:*` để tổng khớp kịch bản.
- Snapshot tháng 9 và nhiệm kỳ trước; tháng 10 đang mở.
- DNA TT/SGDC/LDC; TT có học và có Star nhưng không lên bảng DNA.
- Chủ tịch Chapter và LT Ban.
- High-water mark quiz mẫu cho `member.exact70@bbe.vn` (assessment 9 câu, tháng 10, tối đa 5 Star).
- Dữ liệu chuyển giao tháng 10 hiện có 46 affiliation kết thúc trong tháng; `dna.member.demo` đã kết thúc affiliation Chapter để sang DNA; Chapter Demo có batch chuyển giao ngày 17/10.

Tài khoản demo: xem trong script `scripts/seed-rich-demo.ts`.

## 6. Đo thời gian tải thực tế (local → Supabase us-west)

| API | Lần đầu | Lần lặp/cache |
|---|---:|---:|
| Lesson detail | ~3,3 s | ~2,1 s |
| Course detail | ~1,1 s | ~1,1 s |
| My progress | ~4,3 s | — |
| Bảng Chapter | ~8,8–10 s | ~3,2 s (cache 30 s) |
| Learning/me | ~10,6 s | ~12 ms (cache 5 s) |
| Star balance-only | ~4,2 s | ~2,1 s |
| Tạo attempt quiz | ~31,8 s | — |

Đây là số đo thật trên máy local kết nối Supabase ở Mỹ, không phải production cùng region. Không đánh dấu PASS cho mục “tải nhanh” nếu chưa có môi trường gần DB hơn.

## 7. Vấn đề còn tồn tại / rủi ro

1. Độ trễ DB remote còn cao; `learning/me`, tạo attempt và bảng Chapter lần đầu còn chậm. Đã giảm bằng Prisma relation joins, cache 5–30 giây và lesson detail cache, nhưng chưa đạt mức tức thời.
2. Bảng Chapter của nhiệm kỳ đang mở chỉ tạm tính tháng hiện tại, chưa cộng dồn các tháng chưa chốt; đã ghi rõ trong payload/UI.
3. Seed dùng thao tác ghi trực tiếp vào ledger/progress để tạo kịch bản; đây là dữ liệu demo, không phải dữ liệu production.
4. Chưa chạy browser E2E tự động; đã kiểm tra HTTP/API, build, unit test và đọc mã. Chưa có screenshot mobile thực tế.
5. Công thức Star quiz hiện tại vẫn là 1 Star/câu đúng theo code cũ, chưa đổi sang 2+bonus trong tài liệu cũ; cần xác nhận nếu muốn thay đổi nghiệp vụ.
6. Một số dữ liệu cũ ngoài phạm vi seed vẫn có thể còn text/encoding cũ; dữ liệu khóa practicum đã được sửa.

## 8. Cách tự kiểm thử

1. Chạy `npm run dev` (hoặc `npm run build && npm run start`) với database dev/test.
2. Đăng nhập tài khoản học viên demo `member.exact70@bbe.vn` (mật khẩu cấu hình trong seed).
3. Mở một bài lý thuyết, xem ở 1x/1.75x/2x; kiểm tra skeleton, buffering, thanh tiến độ, hiệu ứng `+N ⭐`, tổng Star trên header.
4. Cuối video, kiểm tra tab Quiz hiện `9 câu hỏi | 30 phút`; bắt đầu, tải lại trang giữa attempt, xác nhận cùng attempt và cùng thứ tự câu/đáp án.
5. Vào `/leaderboard`, chuyển 4 tab và Tháng/Nhiệm kỳ; kiểm tra 8 bảng.
6. Đăng nhập `leader.seed-small@demo.bbe.vn`, mở `/chapter-manager/leaderboard`: chỉ thấy Chapter Nhỏ.
7. Đăng nhập `leader.dna@bbe.vn`, mở `/organization-manager/leaderboard`: chỉ thấy SGDC/LDC, không có TT.
8. Admin `admin.rich@bbe.vn`: mở `/admin/chapters` xem bảng hiện tại, và `/admin/courses` kiểm tra số câu/thời gian quiz.

