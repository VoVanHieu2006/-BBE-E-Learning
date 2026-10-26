# Kiến trúc và mô hình tải BBE E-Learning

Khảo sát source ngày 25/10/2026 (UTC+7). [API_INVENTORY.md](API_INVENTORY.md) liệt kê handler thực tế, method, tham chiếu xác thực và model qua import. Đây là phân tích tĩnh; danh sách model không phải số SQL đo bằng tracing. Không gọi các endpoint admin hoặc scheduler để tạo tải.

## Kiến trúc

- Next.js 14.2.35, App Router `src/app`, React 18, TypeScript. API dưới `src/app/api/v1`; tác vụ định kỳ dưới `src/app/api/internal` và `scripts/learning-scheduler.mjs`. Khảo sát directive không tìm thấy Server Action `use server`; các luồng học khảo sát gọi Route Handlers.
- `src/middleware.ts` kiểm tra cookie JWT và chuyển hướng theo vai trò cho các trang được matcher bảo vệ. API dùng `authenticate()` và kiểm tra quyền tại handler/helper; middleware không thay thế authorization API.
- Authentication tự xây dựng bằng bcryptjs + jose, **không phải Supabase Auth**. Login tra `User`, affiliation, membership/position, so mật khẩu và lưu hash refresh token trong `RefreshToken`. Access JWT 15 phút, refresh JWT 7 ngày; Bearer hoặc cookie. `authenticate` cache trạng thái user 30 giây theo process. Cần kiểm thử luồng refresh và thu hồi riêng, không suy ra từ k6 HTTP cookie jar.
- Prisma Client 6.19.3, PostgreSQL, `relationJoins`; một instance cache trên `globalThis` **trong từng process**. `.env` hiện trỏ tới Supabase transaction pooler cổng 6543 (`pgbouncer=true`); DIRECT_URL cổng 5432. Không in hostname/credential. Không có `connection_limit` trong URI khảo sát; không được suy ra số connection thực tế từ điều này.
- Danh mục: Course → Session (chương/buổi) → Lesson → Video/Assessment/Document. Quyền và trình tự học còn phụ thuộc affiliation, assignments, LearningCycle, LearningPath, policy và lịch sử.
- `recordVideoHeartbeat` giữ khóa hàng user `FOR UPDATE` trong transaction, cập nhật tiến độ và replay theo tháng; kiểm tra elapsed bằng giờ server, tốc độ phát và sự kiện ENDED. Hoàn thành video không đồng nghĩa hoàn thành bài nếu còn quiz.
- Quiz: mở Attempt, chọn câu/ngân hàng và snapshot AttemptQuestion, lưu đáp án qua submit hoặc route answers. Submit giữ khóa user rồi attempt, chấm trên snapshot, ghi AttemptAnswer, progress, high-water mark và ledger trong transaction. Nộp lại phải không trả thêm sao. Bộ test dùng đáp án fixture, không đọc đáp án production.
- Sao: `StarLedger.reward_key` unique; quiz dùng `QuizRewardHighWaterMark`; học theo chu kỳ/tháng và reward eligibility. Không áp công thức tiện ích cũ thay cho code ghi sao hiện tại. `LearningOutbox` phục vụ reconciliation bền vững; runner không tự bật scheduler nên cần theo dõi tồn đọng và test scheduler độc lập sau này.
- Media YouTube được trình duyệt tải trực tiếp; R2/S3 dùng tài liệu/ảnh, Resend gửi email. k6 suite này chỉ phát tải API, không gọi YouTube/R2/Resend. `GET /api/v1/health` truy vấn DB và HeadBucket R2: không dùng làm health-check phát tải.

## Endpoint và tần suất mô hình

Các bảng ghi theo Prisma model name để đối chiếu schema; ánh xạ tên SQL ở `@@map`. Các helper có thể đọc thêm quyền/chu kỳ. Tần suất dưới đây là source + giả định mô hình, **chưa phải traffic thực đo**.

| Endpoint | Method | Auth | Model chính | Khi gọi trong UI / suite |
|---|---|---|---|---|
| `/api/v1/auth/login` | POST | email/password | User, ChapterMember, OrganizationMembership, PositionAssignment, RefreshToken | Một lần/session; spike login đo riêng |
| `/api/v1/auth/refresh` | POST | refresh token/cookie | RefreshToken, User, membership/position | Khi thiếu/hết access token; suite làm mới sau 12 phút |
| `/api/v1/members/me/courses` | GET | MEMBER/Bearer/cookie | ChapterMember + các model của progress calculator | Dashboard và khóa học; suite 30–60 giây/lượt dashboard |
| `/api/v1/streak` | GET | Bearer/cookie | LessonProgress, Attempt | Dashboard; không phải request mỗi giây |
| `/api/v1/stars/me` | GET | Bearer/cookie | StarLedger, CompetitionMonth, LearningCycle và kiểm tra manager | Dashboard/trang sao; suite đọc cùng dashboard và recovery |
| `/api/v1/members/me/deadlines` | GET | Bearer/cookie | UserLearningAssignment, Course | Trang khóa học; 30–60 giây ở nhóm dashboard |
| `/api/v1/courses` | GET | GET có nhánh khách; ghi yêu cầu quyền | Course, Session, Lesson, Video, Assessment và helper cache/quyền | Trang khóa học/prefetch; suite cùng dashboard |
| `/api/v1/courses/[courseId]` | GET | GET có nhánh public/optional auth | Course, Session, Lesson và quan hệ media/quiz | Mở khóa; spike course đo riêng |
| `/api/v1/lessons/[lessonId]` | GET | Handler kiểm tra actor/quyền | Lesson, Video, Session, Assessment, Document và progression | Lúc mở/chuyển bài; suite lúc bắt đầu xem |
| `/api/v1/lessons/[lessonId]/progress` | GET | Bearer/cookie | LessonProgress, LearningCycle, CycleLessonProgress, MonthlyVideoReplay, CompetitionMonth, StarLedger | Lúc mở bài/đọc lại trạng thái |
| `/api/v1/lessons/[lessonId]/progress` | PATCH, POST | Bearer/cookie, learner | Các model trên + User lock, policy, assignment, outbox, eligibility/unlocks | PLAY/PAUSE/ENDED và heartbeat 10s; video <30s dùng 3s |
| `/api/v1/learning/me` | GET | Bearer/cookie | LearningCycle/Path/Policy/Program, Course, StarLedger, replay/progress, Notice, SupplementalLearningRequirement, Assignment | Snapshot trạng thái học; suite phục hồi đọc lại |
| `/api/v1/assessments/[assessmentId]/attempts` | POST | Bearer/cookie + progression | Assessment, Question/Option/Pool, Attempt/AttemptQuestion, progress/replay/cycle, mark | Một lần mở bài; không tạo attempt liên tục |
| `/api/v1/attempts/[attemptId]/answers` | POST | Owner + attempt còn hiệu lực | Attempt, AttemptQuestion, QuestionOption, AttemptAnswer | API có thật; UI LessonQuiz lưu nháp tại client và gửi đáp án lúc submit. Không giả định autosave backend mỗi giây |
| `/api/v1/attempts/[attemptId]/submit` | POST | Owner + kiểm tra nghiệp vụ | Attempt/Question/Answer, User lock, Cycle/Policy, Progress, StarLedger, HighWaterMark, Assignment, Outbox | Một lần sau 120–180s suy nghĩ; suite cố tình gửi lại một lần để kiểm tra idempotency |
| `/api/v1/attempts/[attemptId]/cancel` | POST | Owner | Attempt và helper vòng đời | UI thoát/đóng tab; chưa có trong workload tải hiện tại |
| `/api/v1/leaderboard/chapters/[chapterId]` | GET | Auth + membership/permission | Chapter, User, ChapterMember, OrganizationMembership, PositionAssignment, StarLedger và progress calculator | Nhóm bảng xếp hạng 30–60s/lượt |
| `/api/v1/leaderboard` | GET | Auth theo handler | User, StarLedger và progress helpers | Fallback khi không có chapter; không phải endpoint bảng chapter đang đo |
| `/api/v1/leaderboard/chapters` | GET | Theo handler | CompetitionMonth, Chapter và helpers | Bảng chapter tổng; không phát tải mặc định |

## Cache, polling, request ngầm

`src/lib/api/client.ts`: GET cache trong memory 30s, sessionStorage tới 120s khi đọc cache, khử request in-flight và refresh token. `src/app/student/layout.tsx`/Sidebar prefetch courses, member courses, streak và bảng chapter. Bộ k6 không chạy JavaScript trình duyệt, không tự động tái hiện tất cả prefetch/RSC, navigation, SWR, ảnh hoặc tài liệu. Tần suất 30–60s là giả định bảo thủ; cần HAR thực từ tài khoản test để hiệu chỉnh, không phải bằng chứng analytics.

Timer đếm ngược quiz mỗi giây, timer giao diện video 500ms và polling player 150ms phần lớn là thao tác client/player, không được đếm thành backend RPS. Heartbeat 10s/3s mới là request học tập chủ đạo. Learning/me có cache 5s/user, auth 30s/user; leaderboard toàn thành viên có cache 30s, course detail cache khoảng 30s. Không áp TTL của leaderboard tổng cho endpoint bảng từng chapter khi code không có cache tương ứng. Cache memory tách biệt giữa process/serverless instances; cần so cold/warm và cache-expiry stampede riêng.

## A, B, C và ý nghĩa 1.000 VU

Test A dùng `ramping-vus`, mỗi VU sở hữu một tài khoản synthetic và state riêng. Ở 1.000 VU: 250 dashboard, 400 video, 200 quiz, 150 leaderboard bằng phân nhóm modulo 20; mức nhỏ hơn có sai số làm tròn. VU là máy trạng thái có cả thời gian ngủ, không phải một HTTP request đang bay và chưa tự động tương đương một người học thật.

400 người xem video dài ở tốc độ 1x tương ứng **kỳ vọng** khoảng 40 heartbeat/s, cộng PLAY/ENDED, auth, mở bài; nếu tất cả xem video ngắn thì khoảng 133/s. Những số này là phép tính mô hình, không phải kết quả đo. Số HTTP đang xử lý còn phụ thuộc RPS và latency. Không dùng 1.000 socket hay 1.000 request tức thời để kết luận 1.000 người học.

Generator local tạo 1.000 learners thuộc một DNA, 1 admin synthetic, 3 khóa công khai với bài đầu riêng: video dài 30 phút, video đã xem 10 phút để mở quiz 10 câu, video 20s cho completion spike. Mỗi learner có affiliation, assignment, cycle/path, tiến độ quiz và lịch sử sao. Không gán đồng thời Chapter+DNA: trigger `SingleOrganizationAffiliationRequired` cấm điều đó. Video quiz được seed là trạng thái lịch sử; không giả vờ vừa xem đủ video qua API. Đây là baseline nhỏ về nội dung, chưa đại diện toàn bộ số khóa/lịch sử của production.

Theo chỉ thị bổ sung, profile Supabase thực tế tạo đúng 10 learners thuộc DNA, dùng nguyên khóa/bài công khai đang có: video xem 812s, video quiz 153s, quiz 6 câu với hạn 3 phút. Không sửa policy, câu hỏi, khóa học hoặc migration. Chapter rỗng từ bước chuẩn bị được giữ cho audit, không có member test; nhóm DNA xem leaderboard tổng thay vì endpoint chapter. Rủi ro cắt 500 thành viên/chapter chưa được tái hiện bằng cohort này.

Nhóm quiz làm một bài trong phiên rồi xem sao/nghỉ; tỷ lệ 200 là phân công ban đầu, không có nghĩa 200 người luôn đang gửi submit trong toàn stability. Video dài đủ để nhóm video vẫn xem trong stability 15 phút. Chuyển nhiều bài, mixed thiết bị và rớt mạng cần bổ sung sau khi có smoke nghiệp vụ hợp lệ.

Test B chạy từng mode riêng: spike-login dùng arrival-rate (mặc định 10 phiên/s, tổng tối đa 1.000 tài khoản); các spike course/heartbeat/submit/completion chuẩn bị session rồi dùng mốc chung 120s. Chạy tối đa 1.000 VU không chứng minh 1.000 login đồng thời; login-rate là biến độc lập. Có metric missed_barrier để loại run không chuẩn bị kịp. Completion phải heartbeat đều 3s trong 20s xem thật trước ENDED, không nhảy từ 0 tới cuối video.

Test C: hạ dần về 1 VU, giữ 120s; đọc learning/stars, tiếp tục heartbeat, audit DB trước/sau. Quan sát CPU, RAM, connection, lock, request treo và outbox. Audit phát hiện tiến độ lùi, bản ghi mất, key sao trùng, quiz nhận >10 sao, submit được ACK nhưng không thấy trong DB hoặc chấm sai. **Chưa chứng minh mọi heartbeat không mất** vì API ghi đè trạng thái, chưa có event ID bền vững. Không đánh dấu đúng toàn bộ dữ liệu chỉ vì HTTP 200.

## Rủi ro qua source, chưa phải bottleneck thực nghiệm

1. Heartbeat transaction giữ khóa user và nhiều truy vấn tuần tự; timeout transaction 60s trong khi suite timeout HTTP 10s. Nhánh progression gọi helper dùng Prisma global trong lúc transaction đang giữ connection, có thể cần thêm connection; phải đo pool wait/SQL count trước khi tối ưu.
2. Submit upsert đáp án tuần tự, giữ user + attempt lock và ghi nhiều bảng. Mô hình một tài khoản cho mọi VU sẽ tạo hotspot sai thực tế. Cần thêm race test cùng user trên hai tab với kiểm tra reward_key/high-water, không bỏ khóa để giảm latency.
3. Endpoint bảng từng chapter có `take: 500` trên User trước khi tính/sắp xếp sao. Với Chapter có >500 thành viên, có nguy cơ bỏ người đáng lẽ nằm top. Bài test 1.000 user cùng chapter phải kiểm tra tính đúng đắn bảng, không chỉ latency; đây là vấn đề cần xác minh nghiệp vụ riêng, không tự sửa.
4. Leaderboard tổng tải user/ledger và tổng hợp trong process; star history lớn tăng dữ liệu truyền và CPU. Chapter board cũng đọc ledger và batch progress. Code đã có batching; chưa đủ bằng chứng gắn nhãn toàn bộ là N+1.
5. Learning/me phát nhiều truy vấn/aggregate song song khi cache miss; prefetch và cache 5s có thể làm tăng áp lực pool. Streak đọc toàn bộ completion/submission theo user; lịch sử dài chưa được fixture mô phỏng đủ.
6. Unique reward_key, row locks, question snapshots và transaction là biện pháp bảo vệ có thật; vẫn cần chạy integration/race test để xác nhận dưới tải, không thể tuyên bố không cộng sao trùng chỉ từ source.
