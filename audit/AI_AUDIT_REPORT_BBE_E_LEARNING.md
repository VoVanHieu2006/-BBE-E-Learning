# AI AUDIT REPORT — BBE E-LEARNING

Ngày: 2026-09-17 · Phạm vi: toàn bộ repository tại `C:\Users\Acer\Desktop\E-learning`
Phương pháp: đọc code tĩnh theo user journey (Phase 1–7), đối chiếu `UI → API → DB → permission → business rule`, tham chiếu `docs/ba-document.md` (BR-01…BR-08) làm acceptance criteria.

**Quy ước:** FACT = đọc trực tiếp trong code/DB · INFERENCE = suy luận có cơ sở, chưa chạy thử · RECOMMENDATION = đề xuất.
Các finding đánh dấu ✅ đã được người audit kiểm chứng lại bằng cách đọc chính file đó (không chỉ qua agent).

---

## 1. Executive Summary

Sản phẩm hiện có: nền tảng e-learning 3 vai trò (ADMIN / CHAPTER_LEADER / MEMBER) với course → session → lesson → video YouTube + tài liệu R2, quiz theo từng bài, theo dõi tiến trình chống tua, bình luận, leaderboard, mời thành viên qua email, reset mật khẩu. Chất lượng UI/admin ở mức tốt so với mặt bằng chung: có skeleton, empty state, modal xác nhận, optimistic UI, và một trang quản lý user đã phân trang/filter đầy đủ.

7 vấn đề lớn nhất:

1. **Phân quyền API không đầy đủ và nằm rải rác ở từng handler.** `/api/**` không được middleware bảo vệ; 2 helper gom quyền (`assertChapterAccess`, `resolveChapterScope`) là dead code. Hệ quả: 1 route không có auth, 4 route đọc dữ liệu công khai kèm email.
2. **Tính toàn vẹn điểm quiz bị phá vỡ**: option/đáp án không được ràng buộc với câu hỏi → có thể nộp đáp án đúng của câu khác và vẫn được điểm; không có cooldown 24h → brute-force key.
3. **DB provisioning lệch nhau**: migration khởi tạo thiếu 27/28 FK, thiếu bảng `lesson_comments`, và dùng `assessments.course_id` trong khi code dùng `lesson_id`. *(Đã kiểm chứng sau audit: DB đang chạy khớp `schema.prisma` — drift chỉ nằm trong file migration, rủi ro là khi dựng môi trường mới.)*
4. **Luật nghiệp vụ mâu thuẫn giữa các surface** (80% vs 85%, per-lesson vs toàn course, completion định nghĩa 4 nơi khác nhau).
5. **Hợp đồng tiến trình bị hỏng**: `assessmentId` luôn `null` → dashboard và trang tiến trình nói ngược nhau về cùng một học viên.
6. **Rào cản nghiệp vụ chỉ nằm ở UI**: khóa học đã Published vẫn sửa được qua API; chặn "Bài tiếp theo" bị vòng qua bằng sidebar/URL.
7. **Friction vận hành**: không có bulk/clone ở lesson, quiz, invitation; nhiều danh sách bị cắt ở 20 dòng không phân trang; tạo lesson/session báo "thành công" trước khi request xong → mất dữ liệu đã nhập.

Cơ hội UX/product lớn nhất: bulk nhập lesson & câu hỏi, clone quiz/lesson/course, "Tiếp tục học" trỏ thẳng bài đang dở, hàng đợi hoàn thành + nhắc học, và một dashboard vận hành có filter theo thời gian.

Rủi ro kỹ thuật lớn nhất: drift schema/migration, thiếu FK, cache invalidation không đầy đủ, không có audit trail cho hành động đặc quyền, không có CI và các bộ test hiện có đang assert những hành vi chưa được implement.

---

## 2. Product / System Map

```text
Guest ──┐
Member ─┼─► Next.js App Router (client pages) ─► /api/v1/** route handlers (59 file)
BĐHU ───┤        │  (middleware.ts chỉ chặn PAGE, không chặn /api)
Admin ──┘        │
                 ├─► lib/auth.ts authenticate()  ← JWT access (15m) + refresh cookie
                 ├─► lib/progress/calculator.ts  ← in-memory cache 30s, tính % & leaderboard
                 ├─► lib/server-cache.ts         ← in-memory cache 15–60s
                 ├─► Prisma ─► PostgreSQL (Supabase, pgbouncer pooler)
                 ├─► Cloudflare R2 (presign PUT 600s / GET 300s)
                 ├─► Resend (email mời, reset mật khẩu)
                 └─► YouTube oEmbed + watch page + InnerTube (lấy thời lượng)
Cron ngoài ──► /api/internal/attempts/auto-submit (CRON_SECRET)
```

| Module                | Mục đích                         | Actor         | UI                                                       | API                                           | DB                                           | Trạng thái                                     |
| --------------------- | ----------------------------------- | ------------- | -------------------------------------------------------- | --------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Auth                  | Đăng nhập/refresh/logout/reset   | All           | `login`, `accept-invitation`                         | `auth/*`                                    | users, refresh_tokens, password_reset_tokens | Chạy; lockout có bug (không tự mở)          |
| Chapter & member      | Quản lý chapter, thành viên     | Admin, BĐHU  | `admin/chapters`, `chapter-manager/*`                | `chapters/*`, `users/*`                   | chapters, chapter_members                    | Chạy; thiếu bulk; đếm sai                    |
| Invitation            | Mời BĐHU/member qua email         | Admin, BĐHU  | `*/invitations`                                        | `invitations/*`                             | invitations                                  | Chạy; invite hết hạn không gửi lại được |
| Course/Session/Lesson | Tạo nội dung                      | Admin         | `admin/courses/*`                                      | `courses/*`, `sessions/*`, `lessons/*`  | courses, sessions, lessons                   | Chạy; Published vẫn sửa được qua API       |
| Video YouTube         | Gán video + thời lượng          | Admin         | modal lesson                                             | `youtube/info`, `lessons/*`               | videos                                       | Vừa sửa xong (không còn bịa 180s)           |
| Document              | Upload/tải tài liệu R2           | Admin, Member | modal lesson                                             | `documents/*`                               | documents                                    | Chạy; confirm tin`storageKey` client          |
| Learning & progress   | Xem video, chống tua, hoàn thành | Member, Guest | `student/learning/*`                                   | `lessons/*/progress`                        | lesson_progress                              | Chạy; clamp lỏng, gate vòng qua được       |
| Assessment            | Quiz theo bài                      | Member        | `components/lesson/LessonQuiz`                         | `assessments/*`, `attempts/*`             | assessments, questions, attempts             | Chạy; integrity lỗi                            |
| Comment/Q&A           | Hỏi đáp dưới bài              | All           | `components/lesson/LessonComments`                     | `lessons/*/comments`                        | lesson_comments                              | Chạy; GET công khai, không sửa được       |
| Leaderboard/Stats     | Xếp hạng, dashboard               | All           | `admin/*`, `chapter-manager/*`, `student/progress` | `leaderboard/*`, `*/dashboard/*`          | tổng hợp                                   | Chạy; 2 endpoint công khai; sort sai           |
| Ops                   | Health, auto-submit                 | Ops           | —                                                       | `health`, `internal/attempts/auto-submit` | —                                           | Health lộ cấu hình                            |

---

## 3. User Journey Audit

### 3.1. Admin

- Tạo khóa học: 3 màn hình, **input được giữ khi lỗi** (`admin/courses/new/page.tsx:37-41`). OK.
- Thêm buổi học/bài học: **1 modal cho 1 item**, bài học còn phải chờ round-trip YouTube mới bật được nút Lưu (`admin/courses/[courseId]/edit/page.tsx:533-571,1822-1826`). Khóa 5 buổi × 4 bài = 25 modal.
- **Lỗi nặng:** toast "thành công" + đóng modal phát ra **trước** khi `await apiFetch` (`edit/page.tsx:315-316` cho session, `711-713` cho lesson) → request fail thì báo sai và **mất toàn bộ dữ liệu đã nhập**. ✅ (FACT)
- Không có clone/duplicate cho course/session/lesson/quiz (grep `clone|duplicate` trong `admin/**` = 0 kết quả).
- Sắp xếp chỉ bằng nút ▲/▼ nhỏ, không drag & drop (`edit/page.tsx:1477-1496`, `1897-1919`) — đưa bài 12 lên vị trí 2 tốn 10 click.
- Danh sách khóa học **cắt ở 20** nhưng tiêu đề ghi "tất cả các khóa học" (`admin/courses/page.tsx:95` vs `courses/route.ts:12-14`).
- Danh sách chapter không có search/filter/sort/pagination; drill-down cũng chỉ hiện 20 thành viên (`admin/chapters/page.tsx:42-57`).
- Danh sách lời mời: cột role **hardcode "Trưởng Chapter (BĐHU)"** cho mọi dòng (`admin/invitations/page.tsx:175-179`), không phân trang, lời mời đã hết hạn **không có nút gửi lại** (`:206`).
- Trang `admin/users` là màn hình duy nhất đạt chuẩn (search + 3 filter + page-size + phân trang, `admin/users/page.tsx:74-135,295-353`). Thiếu: đổi role, xoá user, thao tác hàng loạt.

### 3.2. BĐHU (CHAPTER_LEADER)

- Mời member: từng email một (`chapter-manager/members/page.tsx:347-387`), không CSV/bulk.
- Danh sách member: chỉ search email, **không dùng `page/totalItems` mà API đã trả** (`chapter-manager/members/page.tsx:51-69`) → chapter 60 người hiển thị "Tổng thành viên 20" và điểm trung bình tính trên 20 người đầu (`:165-172`).
- Tab trạng thái lời mời lọc **client-side trên 20 dòng đầu** (`chapter-manager/invitations/page.tsx:125-128`) → lời mời cũ "biến mất" khỏi tab.
- Xem tiến trình: dashboard 3 card tĩnh, không filter theo thời gian; modal "Học viên" của course gọi endpoint **không phân trang** (`courses/[courseId]/students/route.ts:38-97`).
- Xoá member khỏi chapter: `window.confirm` + hard delete, không undo (`chapter-manager/members/page.tsx:145-162`).
- Phạm vi dữ liệu: các route dashboard/member của BĐHU **đã** kiểm tra đúng chapter sở hữu (tốt), nhưng BĐHU vẫn đọc được đáp án đúng của **mọi** assessment toàn hệ thống (xem S-3).

### 3.3. Member

- Khám phá khóa học: **không search/filter/pagination**, grid gọi `/api/v1/courses` không tham số → quá 20 khóa học là mất im lặng (`student/courses/page.tsx:35`).
- Card khóa học không có tiến độ, mọi card đều là "Vào học ngay →" → không biết đang học dở khóa nào.
- **Không có "Tiếp tục học"** trỏ thẳng tới bài đang dở: dashboard/progress đều dẫn về trang course, member phải tự chọn buổi → chọn bài.
- Trong bài học: resume đúng vị trí, sidebar hiện ✓/○/▶ + badge quiz (**điểm mạnh nhất của sản phẩm**), có nút tốc độ 1.5x/2x.
- Chống tua: chặn im lặng, không có thông báo; hint "Không thể tua tới" bị `hidden sm:inline` → **trên điện thoại không thấy gì cả** (`YouTubePlayer.tsx:568-570`).
- Gate "Bài tiếp theo" bị vòng qua: sidebar và URL điều hướng không có `disabled` (`student/learning/[lessonId]/page.tsx:660`).
- Quiz: làm trên 1 trang dài, không palette điều hướng; có thể nộp khi mới chọn 1/N câu (`LessonQuiz.tsx:344`); refresh giữa bài → **đồng hồ reset** vì payload attempt đang làm không trả `startedAt`; đáp án chỉ nằm ở `localStorage`, không autosave server (2 endpoint answers đã có sẵn nhưng không được gọi).
- Trang course detail cho member: **2 sidebar chồng nhau** + thụt lề gấp đôi (xem U-1).
- Sau khi hoàn thành: dashboard hiện "Cần làm test" cho khóa đã pass, progress hiện "Làm bài kiểm tra" cho khóa đã xong (xem F-1).

---

## 4. Functional Findings

### [P0] F-1 · Hợp đồng tiến trình bị hỏng — dashboard và trang tiến trình nói ngược nhau

- Area: Functional / Product
- Where: `src/lib/progress/calculator.ts:98` (`assessmentId: null`), `:201` (`latestAttempt: c.assessmentId ? … : null`), consumer `src/app/student/dashboard/page.tsx:60-65,149-155`, `src/app/student/progress/page.tsx:149-187`
- Evidence (FACT ✅): `assessmentId` bị hardcode `null` cho mọi course ⇒ `latestAttempt` **luôn null** ở mọi response của `/api/v1/members/me/courses`.
- Problem: mọi nhánh UI phụ thuộc `latestAttempt` đều chết. Học viên đã pass quiz: dashboard tính `completedCourses` bằng bộ lọc phụ thuộc `latestAttempt` ⇒ hiển thị "Cần làm test"/0 khóa; trang progress dùng `summary.completedCourses` của calculator ⇒ hiển thị đã xong/1 khóa, đồng thời card khóa học mời "Làm bài kiểm tra" cho khóa đã hoàn thành.
- User/Business impact: học viên hoang mang, có thể làm lại bài đã pass, mất niềm tin vào số liệu tiến trình.
- Why it matters: 2 trang cấp cao nhất về tiến độ đang mâu thuẫn trực tiếp, không cần thao tác đặc biệt nào để thấy.
- Recommendation: bỏ hẳn nhánh `latestAttempt`/`assessmentId` khỏi endpoint và suy ra trạng thái khóa học từ `lesson_progress.completed` (đã bao hàm cả quiz-pass), hoặc populate `assessmentId` thật từ lesson tree.
- Effort: S · Confidence: High

### [P0] F-2 · Điểm quiz có thể bị làm giả (option không gắn với câu hỏi)

- Area: Functional / Security / DB
- Where: `src/app/api/v1/attempts/[attemptId]/submit/route.ts:31-56` (batch option lookup không giới hạn theo câu hỏi), `:80` (`ans.selected_option?.is_correct`), `src/app/api/v1/attempts/[attemptId]/answers/route.ts:28-56`
- Evidence (FACT ✅): option được tra bằng `questionOption.findMany({ where: { id: { in: optIds } } })` — **không** kiểm tra option thuộc câu hỏi nào; `attemptAnswer.upsert` ghi `question_id` lấy từ body client; điểm cộng theo `points` của câu hỏi. Vì vậy: gửi option đúng của câu A vào slot câu B ⇒ được điểm cho câu B. Cộng thêm: `score` cộng theo `ans.question.points` nên có thể vượt `totalPoints` ⇒ `scoreRatio ≥ 1` ⇒ chắc chắn pass.
- Problem: bất kỳ member nào biết 1 đáp án đúng (ví dụ từ lượt trước của chính mình khi pass) có thể pass mọi bài.
- User/Business impact: chứng nhận hoàn thành khóa học mất giá trị; dữ liệu điểm sai vĩnh viễn.
- Why it matters: đây là invariant lõi của một nền tảng đào tạo có kiểm tra.
- Recommendation: validate `questionId ∈ attempt_questions` **và** `selectedOption.question_id === questionId`; tính `score` theo `attempt_questions` (không theo bảng answers), bỏ nhánh upsert từ body.
- Effort: S–M · Confidence: High

### [P1] F-3 · Không có cooldown 24h, retake không giới hạn, lại còn hiện đúng/sai từng câu

- Area: Functional / Business rule (BR-04)
- Where: `src/app/api/v1/assessments/[assessmentId]/attempts/route.ts` (chỉ chặn nếu còn attempt `IN_PROGRESS`), `src/components/lesson/LessonQuiz.tsx:243` ("🔄 Làm lại bài kiểm tra ngay"), nút "Làm lại ngay" gọi `initQuiz`
- Evidence (FACT): không tồn tại biến/const nào tên cooldown/retake/86400 trong code attempt; ngược lại API xoá attempt trả message "Bạn cần đợi 24 giờ để bắt đầu lượt mới" (`attempts/[attemptId]/route.ts`) nhưng không enforce.
- Problem: member nộp → xem câu nào đúng/sai → làm lại ngay → lặp tới khi pass. BR-04 yêu cầu 24h (trừ khi điểm tuyệt đối) bị vô hiệu.
- Impact: quiz trở thành trò đoán; điểm không phản ánh năng lực.
- Why it matters: cùng root cause với F-2 (bảo vệ tính toàn vẹn của assessment), nên sửa chung một đợt.
- Recommendation: enforce `submitted_at + 24h` (trừ `score = 100%`) ở server và phản ánh đúng ở UI (đếm ngược tới lượt kế tiếp).
- Effort: S · Confidence: High

### [P1] F-4 · Thời gian làm bài: refresh reset đồng hồ, submit không kiểm tra hết hạn

- Area: Functional
- Where: `src/app/api/v1/assessments/[assessmentId]/attempts/route.ts` (payload attempt đang làm không có `startedAt`), `src/components/lesson/LessonQuiz.tsx:80-83`, `src/app/api/v1/attempts/[attemptId]/submit/route.ts` (chỉ check `status`)
- Evidence (FACT): nhánh "resume active attempt" không trả `startedAt` ⇒ `initialSecs` = full thời lượng; submit route không hề đọc `expires_at`.
- Problem: F5 là reset đồng hồ về đầu; submit sau hạn vẫn được chấp nhận.
- Impact: thời lượng quiz (BR-04: số câu × 2 phút) không còn ý nghĩa.
- Recommendation: trả `startedAt`/`remainingSeconds` trong payload attempt đang làm; chặn submit khi `now > expires_at`.
- Effort: S · Confidence: High

### [P1] F-5 · Trộn câu hỏi bị shuffle 2 lần khác nhau

- Area: Functional
- Where: `src/app/api/v1/assessments/[assessmentId]/attempts/route.ts:113` (persist `display_order`) vs `:121-135` (response shuffle lại)
- Evidence (FACT): hai lần `sort(() => Math.random() - 0.5)` độc lập cho cùng một attempt.
- Problem: thứ tự câu hỏi đã lưu khác thứ tự đang hiển thị; nếu client re-fetch attempt đang làm (`:65`, đọc theo `display_order`) thì thứ tự đổi giữa chừng.
- Impact: trải nghiệm sai, khó tái lập khi debug, ảnh hưởng cảm nhận "đề bị nhảy".
- Recommendation: shuffle một lần, dùng chính mảng đã persist cho cả response.
- Effort: S · Confidence: High

### [P1] F-6 · Khóa học Published vẫn sửa được qua API (FR-ASM-01 chỉ nằm ở UI)

- Area: Functional / Security
- Where: `src/app/api/v1/courses/[courseId]/route.ts:108-110` (PATCH chặn đúng), nhưng các route nội dung chỉ check `role === 'ADMIN'`: `courses/[courseId]/sessions/route.ts`, `sessions/[sessionId]/route.ts` PATCH/DELETE, `sessions/[sessionId]/lessons/route.ts`, `lessons/[lessonId]/route.ts` PATCH/DELETE, `lessons/[lessonId]/assessment/route.ts` POST/DELETE, `documents/*`
- Evidence (FACT): không route nào trong số trên đọc `course.status`.
- Problem: mọi ràng buộc "khóa học đã công khai thì không sửa" bị vòng qua bằng gọi API trực tiếp.
- Impact: học viên đang học có thể bị đổi đề/đổi video giữa chừng; dữ liệu attempt trỏ tới câu hỏi đã bị xoá.
- Recommendation: middleware/helper `assertCourseDraft(courseId)` dùng chung cho mọi route nội dung.
- Effort: M · Confidence: High

### [P1] F-7 · Unpublish chỉ cảnh báo, không chặn + học viên đang học bị mất quyền truy cập

- Area: Functional / Product
- Where: `src/app/api/v1/courses/[courseId]/unpublish/route.ts` (tính `activeAttempts`, `inProgressLearners` nhưng chỉ trả về `warnings[]` rồi vẫn hạ DRAFT)
- Evidence (FACT): BA yêu cầu kiểm tra điều kiện trước khi hạ xuất bản; code luôn thực hiện chuyển trạng thái.
- Problem: admin có thể hạ xuất bản giữa lúc học viên đang làm bài; theo `lessons/[lessonId]/route.ts:50` khóa học không PUBLISHED ⇒ member nhận 403.
- Impact: học viên đang học dở bị chặn giữa chừng, attempt đang làm có thể hỏng.
- Recommendation: chặn khi có attempt IN_PROGRESS (hoặc bắt buộc admin xác nhận rõ ràng qua modal có liệt kê số người bị ảnh hưởng).
- Effort: S · Confidence: High

### [P2] F-8 · Hoàn thành bài học có quiz phụ thuộc quiz, nhưng UI thông báo xong ở 85% video

- Area: Functional / UX
- Where: `src/app/api/v1/lessons/[lessonId]/progress/route.ts:75-77` (`completed = assessment ? watched85 && isQuizPassed : watched85`) vs `src/components/YouTubePlayer.tsx:333` (bắn `onComplete` ở 85%) và `student/learning/[lessonId]/page.tsx` (patch sidebar thành done)
- Evidence (FACT ✅): server giữ `completed=false` cho tới khi pass quiz, nhưng UI đã tick ✓ ở sidebar.
- Problem: trạng thái UI lệch DB; reload mới lộ ra.
- Recommendation: ở lesson có quiz, `onComplete` chỉ nên mở tab quiz + toast, không tick sidebar cho tới khi server trả `completed=true`.
- Effort: S · Confidence: High

### [P2] F-9 · Publish không kiểm tra "mỗi lesson có đúng 1 video"

- Area: Functional
- Where: `src/app/api/v1/courses/[courseId]/publish/route.ts:16-23`
- Evidence (FACT): chỉ kiểm tra có ≥1 session và mỗi session có ≥1 lesson.
- Problem: BA FR 5.2 yêu cầu lesson bắt buộc có đúng 1 video; lesson tạo qua API cũ có thể thiếu video ⇒ publish thành công nhưng bài học trống.
- Recommendation: thêm điều kiện video trong cùng query publish.
- Effort: S · Confidence: Medium

### [P2] F-10 · Member thuộc nhiều chapter (vi phạm giả định A-01) và số đếm không nhất quán

- Area: Functional / DB
- Where: `prisma/schema.prisma:146-158` (`@@unique([chapter_id,user_id])` nhưng không unique `user_id`), `src/lib/invitations.ts` (`acceptInvitation` không rời chapter cũ, `sendMemberInvitation` không kiểm tra membership hiện có); đếm khác nhau ở `chapters/route.ts`, `chapters/[chapterId]/dashboard/members/route.ts`, `users/route.ts`
- Evidence (FACT): 3 định nghĩa "thành viên" khác nhau (ACTIVE+MEMBER / MEMBER / role≠ADMIN).
- Impact: leaderboard và thống kê chapter sai; "100% thành viên được theo dõi" (OBJ-03) không đo được.
- Recommendation: chốt 1 định nghĩa duy nhất + ràng buộc một chapter/user ở tầng nghiệp vụ.
- Effort: M · Confidence: High

---

## 5. UX / Product Findings

### [P1] U-1 · Member thấy 2 sidebar chồng nhau ở trang chi tiết khóa học

- Area: UX
- Where: `src/app/student/layout.tsx:93-100` (route public + đã đăng nhập ⇒ bọc `Sidebar` + `main.ml-64`) và `src/app/student/courses/[courseId]/page.tsx:262-263` (tự render `Sidebar` + `ml-64`)
- Evidence (FACT ✅): hai sidebar `fixed left-0` chồng lên nhau, nội dung bị thụt lề gấp đôi.
- User impact: giao diện trông hỏng ngay khi member mở khóa học; trên mobile càng nặng.
- Recommendation: xoá `Sidebar`/wrapper ở cấp page, chỉ giữ ở layout (hoặc ngược lại).
- Effort: S · Confidence: High

### [P1] U-2 · Tạo lesson/session báo "thành công" trước khi lưu — thất bại thì mất sạch dữ liệu đã nhập

- Area: UX / Functional
- Where: `src/app/admin/courses/[courseId]/edit/page.tsx:315-316` (session), `711-713` (lesson) — `closeLessonModal()` + `showToast('success', …)` **trước** `await apiFetch(...)`
- Evidence (FACT ✅): đọc trực tiếp thứ tự lệnh trong handler; `handleSaveAssessment` cùng file làm đúng (await → ok mới toast) ⇒ đã có pattern chuẩn trong repo.
- CURRENT: bấm Lưu → toast xanh + modal đóng → hiện toast đỏ → phải nhập lại từ đầu.
- BETTER: `await` trước, chỉ đóng modal + toast khi `res.ok`; lỗi thì giữ nguyên form và hiện lỗi inline.
- Effort: S · Confidence: High

### [P1] U-3 · Chuỗi thao tác lặp lại không có bulk/clone ở 4 nơi

- Area: UX / Product
- Where: lesson (`edit/page.tsx:446-455`), câu hỏi quiz (`973-993`), mời member (`invitations/member/route.ts` — 1 email/lần), lesson/session reorder (`1477-1496`)
- Evidence (FACT): grep `clone|duplicate|bulk` trong `admin/**` và `chapter-manager/**` = 0.
- CURRENT: khóa 5 buổi × 4 bài = 25 modal + 20 round-trip YouTube; quiz 20 câu = 20 lần "＋ Thêm câu hỏi" + ~80 lần sửa text; mời 40 người = 40 modal.
- BETTER: (a) ô dán nhiều dòng `Tiêu đề | link YouTube` cho lesson; (b) khung dán câu hỏi dạng `Câu hỏi / A* / B / C / D`; (c) textarea danh sách email cho invitation; (d) nút "Nhân bản" trên lesson/session/quiz.
- Effort: M (từng phần) · Confidence: High · Evidence volume: đây là friction tốn thời gian nhất của admin/BĐHU.

### [P1] U-4 · Nhiều danh sách bị cắt ở 20 dòng mà không có phân trang, có chỗ còn hiện số liệu sai

- Area: UX / Product
- Where: `admin/courses/page.tsx:31-37` (header nói "tất cả"), `admin/invitations/page.tsx:40-46`, `admin/chapters/page.tsx:42-57` (drill-down), `chapter-manager/members/page.tsx:51-69` (card "Tổng thành viên" đếm 20), `chapter-manager/invitations/page.tsx:125-128`, `chapter-manager/courses/page.tsx:59-75`
- Evidence (FACT): API đã trả `page/totalPages/totalItems` nhưng client không truyền/không dùng.
- User impact: admin tưởng hệ thống chỉ có 20 khóa học; BĐHU thấy tiến độ trung bình sai; tab lời mời bỏ sót bản ghi cũ.
- Recommendation: dùng lại đúng pattern đã có ở `admin/users` (filter bar + paginator); hiển thị "x–y / tổng".
- Effort: M · Confidence: High

### [P2] U-5 · Lời mời hết hạn trở thành ngõ cụt

- Area: UX
- Where: `admin/invitations/page.tsx:206`, `chapter-manager/invitations/page.tsx:242` (nút gửi lại chỉ render khi `status === 'PENDING'`); backend `resendInvitation` (`src/lib/invitations.ts:199-243`) đã hỗ trợ cấp token mới
- CURRENT: hết hạn → không còn action nào, admin phải nhớ email và mở lại modal mời mới.
- BETTER: luôn hiện "Gửi lại" cho mọi trạng thái chưa accept.
- Effort: S · Confidence: High

### [P2] U-6 · Chống tua chặn im lặng, hint bị ẩn trên mobile

- Area: UX
- Where: `src/components/YouTubePlayer.tsx:406-420` (seek bị chặn → return), `:373-388` (tua ngược lại), `:568-570` (`hidden sm:inline`)
- CURRENT: member bấm tua → không có gì xảy ra, không giải thích (mobile không thấy hint).
- BETTER: toast ngắn "Chỉ tua được trong đoạn đã xem" + hint luôn hiển thị.
- Effort: S · Confidence: High

### [P2] U-7 · Gate "Bài tiếp theo" bị vòng qua bằng sidebar và URL

- Area: UX / Functional
- Where: `src/app/student/learning/[lessonId]/page.tsx:251,388-419` (nút bị khóa) vs `:660` (sidebar `switchLesson` không có `disabled`)
- CURRENT: nút bị khóa nhưng sidebar cho nhảy thẳng tới bài sau / bài có quiz.
- BETTER: đồng bộ khóa ở sidebar + enforce điều kiện tiên quyết ở server.
- Effort: S · Confidence: High

### [P2] U-8 · Quiz một trang dài, không palette, nộp được khi bỏ trống

- Area: UX
- Where: `src/components/lesson/LessonQuiz.tsx:258-353` (render tất cả), `:344` (chỉ disable khi 0 câu trả lời), `:337-339`
- CURRENT: 10 câu = cuộn dài, không biết còn câu nào chưa làm, có thể nộp 1/10 mà không cảnh báo.
- BETTER: palette số câu (đã/chưa làm), cảnh báo "Còn N câu chưa trả lời" trước khi nộp.
- Effort: M · Confidence: High

### [P2] U-9 · Đáp án chỉ nằm ở localStorage — mất khi đổi thiết bị/xoá storage

- Area: UX / Functional
- Where: `src/components/lesson/LessonQuiz.tsx:69-73,116-120` (localStorage) — API `POST /api/v1/attempts/[attemptId]/answers` và `PUT .../[questionId]` đã tồn tại nhưng **không được gọi**
- CURRENT: refresh cùng máy thì còn, đổi máy/incognito là mất hết.
- BETTER: autosave debounce mỗi lần chọn lên server, hydrate lại khi load.
- Effort: S–M · Confidence: High

### [P3] U-10 · Nút "Kích hoạt tài khoản & Đăng nhập" nhưng lại đẩy về trang đăng nhập

- Area: UX
- Where: `src/app/accept-invitation/page.tsx:183` (label) vs `:84-88` (`router.push('/login')`)
- CURRENT: member vừa tạo mật khẩu xong phải nhập lại.
- BETTER: tự đăng nhập sau khi kích hoạt, hoặc đổi label + nói rõ bước tiếp theo.
- Effort: S · Confidence: High

### [P3] U-11 · Empty/loading/error state: đa số tốt, còn vài lỗ hổng

- Area: UX
- Where: tốt ở `admin/users:398-403`, `admin/courses:102-110`, `admin/invitations:142-147`, `admin/chapters:124-129`, `LessonComments:353-365`
- Evidence (FACT): thiếu làn sóng "đã lưu tiến trình" cho member (`YouTubePlayer.tsx:126` nuốt lỗi heart‑beat) — nếu PATCH fail, học viên **không biết** thời gian xem không được ghi.
- Recommendation: hiện cảnh báo nhỏ khi heartbeat fail (giống pattern `emailSent`/`emailError` của email).
- Effort: S · Confidence: Medium

---

## 6. Security Findings

### [P0] S-1 · GET session không có xác thực — rò rỉ nội dung khóa chưa công khai

- Area: Security
- Where: `src/app/api/v1/sessions/[sessionId]/route.ts:5-44` ✅ (đọc trực tiếp: handler `GET` không hề gọi `authenticate`)
- Evidence (FACT): trả về title/description của buổi, danh sách lesson + `youtube_video_id` + `duration_seconds` + tên tài liệu đính kèm, **không kiểm tra course status/visibility**. PATCH/DELETE cùng file lại có guard ADMIN ⇒ đây là handler bị bỏ sót.
- Attack path: bất kỳ ai có/đoán được session UUID → `GET /api/v1/sessions/{id}` → toàn bộ nội dung khóa DRAFT/PRIVATE.
- Why it matters: `/api/**` không nằm trong middleware nên lỗ hổng loại này không có lưới an toàn nào.
- Recommendation: thêm guard theo đúng logic `lessons/[lessonId]/route.ts` (visibility + status + ACTIVE).
- Effort: S · Confidence: High

### [P0] S-2 · Đề thi đọc được ẩn danh và không kiểm tra khóa học

- Area: Security
- Where: `src/app/api/v1/lessons/[lessonId]/assessment/route.ts:28` (`authenticate(...).catch(...)` rồi không reject khi `!auth.ok`), `:53`; `src/app/api/v1/courses/[courseId]/assessment/route.ts:11,37`
- Evidence (FACT): không có nhánh nào kiểm tra `course.status`/`visibility`; `canSeeCorrect` chỉ quyết định có trả `isCorrect` hay không, còn `questionText` + toàn bộ option vẫn trả cho khách.
- Attack path: khách ẩn danh gọi trực tiếp 2 endpoint trên với UUID bất kỳ → đọc toàn bộ câu hỏi của khóa chưa publish.
- Impact: rò rỉ nội dung đào tạo nội bộ; đề thi có thể bị sao chép.
- Recommendation: dùng chung một helper `assertLessonReadable`/`assertCourseReadable` cho mọi endpoint nội dung.
- Effort: S · Confidence: High

### [P1] S-3 · Đáp án đúng mở cho **mọi** CHAPTER_LEADER (BOLA theo chapter)

- Area: Security
- Where: `lessons/[lessonId]/assessment/route.ts:53`, `assessments/[assessmentId]/route.ts:35`, `courses/[courseId]/assessment/route.ts:37`
- Evidence (FACT): điều kiện chỉ là `role === 'CHAPTER_LEADER' || role === 'ADMIN'`, không so chapter sở hữu của course.
- Attack path: BĐHU chapter A gọi `GET /api/v1/assessments/{id}` của khóa thuộc chapter B → nhận `isCorrect` + `explanation` của mọi câu.
- Why it matters: trái tuyên bố "BĐHU chỉ thấy dữ liệu chapter mình"; làm lộ toàn bộ ngân hàng câu hỏi.
- Recommendation: chỉ mở đáp án khi assessment thuộc course mà actor sở hữu (hoặc bỏ hẳn nhánh `canSeeCorrect` cho leader nếu không cần thiết).
- Effort: S · Confidence: High

### [P1] S-4 · Leaderboard và comments đọc công khai kèm email thành viên

- Area: Security / Privacy
- Where: `src/app/api/v1/leaderboard/route.ts:23` ✅ (`await authenticate(request).catch(() => null)` — kết quả bị vứt bỏ), `leaderboard/chapters/route.ts:24`; comment GET `lessons/[lessonId]/comments/route.ts:9` (không gọi `authenticate`) trả `userEmail`/`userRole`
- Evidence (FACT): cả hai endpoint đều trả dữ liệu bất kể kết quả auth; leaderboard còn set `Cache-Control: public, max-age=30`.
- Attack path: khách ẩn danh → liệt kê toàn bộ email member đang ACTIVE + xếp hạng, và đọc mọi bình luận trên mọi bài học (kể cả khóa DRAFT/PRIVATE).
- Recommendation: enforce auth (leaderboard: yêu cầu đăng nhập; comments: yêu cầu auth + kiểm tra quyền đọc lesson) và bỏ email khỏi payload (dùng tên hiển thị).
- Effort: S · Confidence: High

### [P1] S-5 · `/api/v1/health` tiết lộ cấu hình bí mật cho người ẩn danh

- Area: Security
- Where: `src/app/api/v1/health/route.ts:31-39`
- Evidence (FACT): trả về boolean `!!process.env.*` cho `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOKEN_HASH_PEPPER`, kèm trạng thái DB và R2 (và trả cùng chi tiết trong body 503).
- Attack path: kẻ tấn công biết chính xác lớp credential nào đang được cấu hình và hạ tầng nào đang sống.
- Recommendation: chỉ trả `{status:'ok'}`; chi tiết chỉ khi có `CRON_SECRET`/ADMIN.
- Effort: S · Confidence: High

### [P1] S-6 · Tài liệu của khóa PRIVATE tải được bởi **bất kỳ** tài khoản ACTIVE

- Area: Security
- Where: `src/app/api/v1/documents/[documentId]/download/route.ts:45-51`
- Evidence (FACT): nhánh không-public chỉ yêu cầu `auth.ok` + `user.status === 'ACTIVE'`, không kiểm tra chapter/course membership.
- Attack path: member chapter A lấy signed URL (300s) cho tài liệu của khóa PRIVATE thuộc chapter B.
- Recommendation: dùng cùng logic scope như `courses/[courseId]/my-progress` (đối chiếu membership/chapter).
- Effort: S · Confidence: High

### [P1] S-7 · Không có rate limiting ở bất kỳ đâu

- Area: Security
- Where: toàn bộ `src/app/api/v1/**` (grep `rate-limit|ratelimit|429|throttle|upstash` trong `src/` = 0 kết quả)
- Evidence (FACT): cụ thể ở `auth/login`, `auth/password-reset/request` (bom mail), `invitations/member` + `invitations/chapter-leader` (mỗi call gửi 1 email Resend), `lessons/[lessonId]/comments` (spam), `assessments/[assessmentId]/attempts` (tạo attempt vô hạn), `documents/presign` (xin URL upload vô hạn), `youtube/info` (proxy ra ngoài).
- Impact: spam email/comment, lạm dụng quota R2/Resend, brute-force mật khẩu.
- Recommendation: limiter theo IP + theo user cho 6 nhóm endpoint trên (đủ dùng: in-memory/Upstash đơn giản).
- Effort: M · Confidence: High

### [P1] S-8 · Lockout tài khoản không bao giờ tự mở — DoS bằng cách khoá tài khoản người khác

- Area: Security / Functional
- Where: `src/app/api/v1/auth/login/route.ts:54-63` (set `locked_until`), `src/app/api/v1/auth/password-reset/confirm/route.ts:61` (chỉ reset khi đổi mật khẩu)
- Evidence (FACT ✅): grep `locked_until` trong `src/` chỉ ra **2 chỗ ghi**, **không chỗ nào đọc** ⇒ hết 30 phút tài khoản vẫn LOCKED.
- Attack path: 10 lần sai mật khẩu cho một email đã biết ⇒ chủ tài khoản bị chặn vĩnh viễn cho tới khi tự reset mật khẩu.
- Recommendation: đọc `locked_until` khi kiểm tra đăng nhập và tự mở khi đã hết hạn; đồng thời giới hạn theo IP.
- Effort: S · Confidence: High

### [P1] S-9 · `/api/v1/health` + `/api/v1/youtube/info` là 2 endpoint ngoài vòng quản lý

- Area: Security
- Where: `health/route.ts` (không auth), `youtube/info/route.ts:10` (không auth, `Cache-Control: public, max-age=86400`)
- Evidence (FACT): youtube/info cho phép bất kỳ ai dùng server làm proxy metadata YouTube miễn phí.
- Recommendation: giới hạn youtube/info cho role đã đăng nhập (chỉ admin dùng) hoặc thêm throttle.
- Effort: S · Confidence: High

### [P2] S-10 · `documents/confirm` tin `storageKey` do client gửi

- Area: Security / DB
- Where: `src/app/api/v1/lessons/[lessonId]/documents/confirm/route.ts:20-35`
- Evidence (FACT): chỉ kiểm tra có `fileName`/`storageKey`, rồi `prisma.document.create` với `storage_key` nguyên văn; không xác minh object tồn tại, không kiểm tra prefix `docs/{lessonId}/`, không bind với lần presign trước đó.
- Impact (chỉ ADMIN khai thác được): gán tài liệu của lesson khác vào lesson mình, hoặc tạo bản ghi trỏ tới key không tồn tại; `fileSize` có thể khai sai.
- Recommendation: sinh `storageKey` ở server và trả về trong presign, ký kèm HMAC/nonce; confirm chỉ nhận key đã cấp.
- Effort: S · Confidence: High

### [P2] S-11 · Không giới hạn loại/kích thước file khi cấp presign; upload server đọc cả file vào RAM

- Area: Security / Performance
- Where: `documents/presign/route.ts` (không validate mime/size), `documents/upload/route.ts` (`await file.arrayBuffer()` không cap)
- Evidence (FACT): cả 3 thông báo giới hạn kích thước đang mâu thuẫn (25MB ở copy, 100MB ở code, 4.5MB ở message lỗi — `edit/page.tsx:1365,785-786,894-897`).
- Impact: bucket R2 có thể chứa file thực thi; 1 request lớn có thể OOM function.
- Recommendation: allowlist mime + cap size ở server; thống nhất 1 con số và hiển thị đúng ở UI.
- Effort: S · Confidence: High

### [P2] S-12 · Email chèn dữ liệu người dùng vào HTML không escape

- Area: Security
- Where: `src/lib/email.ts:77` (`${chapterName}`), `:189` (`${to}`)
- Evidence (FACT): template nội suy trực tiếp; tên chapter là free-text do admin/BĐHU nhập.
- Impact: HTML/email injection vào nội dung thư (không phải XSS trình duyệt, nhưng có thể chèn link/ảnh giả mạo).
- Recommendation: escape HTML khi nội suy.
- Effort: S · Confidence: Medium

### [P2] S-13 · Member không có scope theo chapter ở tầng dữ liệu

- Area: Security / Architecture
- Where: `prisma/schema.prisma:183-199` — `Course` chỉ có `created_by`, **không có `chapter_id`**; hệ quả ở `courses/[courseId]/route.ts:42` và `lessons/[lessonId]/route.ts:39` (chỉ cần bất kỳ role hợp lệ), `courses/route.ts:31-34` (filter PRIVATE chỉ theo `status`)
- Evidence (FACT): khái niệm "khóa học PRIVATE" hiện được hiện thực đúng nghĩa "chỉ cần đăng nhập là xem được", không liên quan chapter.
- Impact: nếu nghiệp vụ là "khóa nội bộ của chapter", mô hình dữ liệu chưa diễn đạt được ý đó ⇒ không thể enforce.
- Recommendation: làm rõ với BA; nếu cần, thêm `chapter_id` (nullable) cho Course và enforce khi đọc.
- Effort: M–L · Confidence: Medium (phụ thuộc ý định nghiệp vụ)

---

## 7. Database / Data Integrity Findings

### [P0] D-1 · Migration khởi tạo lệch schema — thiếu FK, thiếu bảng, sai cột

- Area: DB
- Where: `prisma/migrations/20250831_init/migration.sql` ✅
- Evidence (FACT ✅): trong toàn bộ migration chỉ có **1** `REFERENCES` (dòng 269, `refresh_tokens.user_id`), trong khi `schema.prisma` khai báo **28** quan hệ ⇒ 27 FK/cascade không được tạo. Không tồn tại `CREATE TABLE "lesson_comments"` (grep = 0) dù model và route đang dùng. `assessments` được tạo với `"course_id" UUID UNIQUE NOT NULL` (dòng 160) + index `assessments_course_id_idx` (167), trong khi code dùng `lesson_id` (`schema.prisma:294`, `lessons/[lessonId]/assessment/route.ts`).
- Problem: hai đường tạo DB (`apply-migration.js` chạy SQL này vs `prisma db push` từ schema) cho ra 2 database khác nhau.
- Impact: DB tạo từ migration ⇒ mọi truy vấn assessment theo `lesson_id` sẽ lỗi; xoá course/lesson/user để lại orphan ở `lesson_progress`, `attempts`, `documents`, `comments`; comment mất bảng hoàn toàn.
- Why it matters: đây là root cause của phần lớn rủi ro toàn vẹn dữ liệu, và nó chỉ biểu hiện tuỳ môi trường.
- Recommendation: xác định DB hiện tại thuộc đường nào bằng 1 truy vấn (`\d assessments` / `pg_constraint`), rồi tạo migration mới bù FK + tạo `lesson_comments` + đổi `course_id`→`lesson_id`; từ đó chỉ dùng `prisma migrate`.
- Effort: M · Confidence: High (drift) / Medium (mức ảnh hưởng production — INFERENCE vì chưa truy vấn DB production trong audit này)
- **Cập nhật sau audit (đã kiểm chứng trên DB production):** DB thật **khớp `schema.prisma`** — `assessments` có cột `lesson_id` (không phải `course_id`), bảng `lesson_comments` TỒN TẠI, và có **57** khoá ngoại. Tức là DB đang chạy được cấp qua `prisma db push`, không phải qua file migration. ⇒ Mức ảnh hưởng hạ từ P0 xuống **P2**: đây là rủi ro công cụ/tái lập môi trường (file migration sai sẽ phá DB nếu ai đó chạy `apply-migration.js` hoặc `migrate deploy` trên DB mới), không phải rủi ro dữ liệu đang chạy. Việc cần làm vẫn là tạo lại migration đúng với schema.

### [P1] D-2 · Không có ràng buộc chống trùng attempt; attempt_number = count + 1

- Area: DB / Functional
- Where: `src/app/api/v1/assessments/[assessmentId]/attempts/route.ts:57,96`; `schema.prisma:363-367` (không có `@@unique([assessment_id,user_id,attempt_number])`)
- Evidence (FACT): chống trùng chỉ bằng `findFirst` rồi `count + 1` trong transaction.
- Problem: 2 request đồng thời có thể tạo 2 attempt cùng số/đang làm song song (transaction không khoá logic này).
- Recommendation: thêm unique (assessment_id, user_id, attempt_number) và partial unique cho `IN_PROGRESS`.
- Effort: S · Confidence: High

### [P1] D-3 · Sửa/xoá assessment làm mất lịch sử trả lời

- Area: DB
- Where: `assessments/[assessmentId]/route.ts:84,120-121` (xoá hết option rồi tạo lại), `schema.prisma:394` (`selected_option_id ... onDelete: SetNull`)
- Evidence (FACT): mọi `attempt_answers.selected_option_id` cũ bị set NULL; PATCH còn xoá câu hỏi mà không dọn attempt_question/answer trước (cascade xoá mất lịch sử).
- Impact: báo cáo "học viên chọn đáp án nào" mất vĩnh viễn; dữ liệu attempt trở nên không đối chiếu được.
- Recommendation: đặt `Restrict` cho option đang được tham chiếu (hoặc version hoá câu hỏi thay vì xoá).
- Effort: M · Confidence: High

### [P1] D-4 · Nhiều thao tác nhiều-bước không nằm trong transaction

- Area: DB
- Where: `attempts/[attemptId]/submit/route.ts` (update attempt → upsert lesson_progress), `internal/attempts/auto-submit/route.ts:65,76,81` (loop từng attempt, 3 query/attempt, không transaction), `auth/login/route.ts:112` (`Promise.all` 2 ghi), `lessons/[lessonId]/route.ts:123-145` (lesson → video), `users/[userId]/route.ts:40,48` (update → audit), `chapters/[chapterId]/members/[userId]/route.ts:30,33`, `auth/password-reset/request/route.ts`
- Evidence (FACT): liệt kê ở trên; các chỗ **đã** dùng transaction được ghi nhận (lesson+video create, reorder, accept invitation, assessment create/delete, attempt create).
- Impact: trạng thái nửa vời (bài đã nộp nhưng bài học không được đánh dấu hoàn thành; đổi trạng thái user mà không có audit).
- Recommendation: bọc `$transaction` cho 7 vị trí trên.
- Effort: M · Confidence: High

### [P2] D-5 · Thiếu index cho các truy vấn nóng

- Area: DB / Performance
- Where: `lesson_progress.completed` (lọc ở `admin/overview`, `courses/[courseId]/students:63`, dashboard), `invitations.created_at`, `chapter_members.joined_at`, `attempts.submitted_at`, `assessments` (không có index nào trong schema dù join qua `lesson.session.course_id`)
- Evidence (FACT): so khớp danh sách `@@index` trong `schema.prisma` với các cột dùng trong `where`/`orderBy` của các route tương ứng.
- Recommendation: thêm index đúng theo truy vấn thực tế (đo bằng `EXPLAIN` trước khi thêm).
- Effort: S · Confidence: Medium

### [P2] D-6 · `audit_logs` gần như không được ghi

- Area: DB / Operations
- Where: chỉ 2 chỗ ghi: `users/[userId]/route.ts:48`, `chapters/[chapterId]/members/[userId]/route.ts:33`
- Evidence (FACT): đăng nhập/khoá tài khoản, reset mật khẩu, publish/unpublish, xoá course/lesson, upload/xoá tài liệu, sửa/xoá assessment, nộp/huỷ attempt, đổi quyền — **không** ghi audit.
- Impact: không trả lời được "ai đã xoá khóa học này" — đúng mục đích tồn tại của bảng.
- Recommendation: helper `writeAudit(action, entityType, entityId, metadata)` và gọi ở các mutation đặc quyền.
- Effort: M · Confidence: High

### [P2] D-7 · `metadata` lưu dạng JSON string trong cột Json

- Area: DB / Code quality
- Where: `users/[userId]/route.ts:39,54`, `chapters/[chapterId]/members/[userId]/route.ts:39`
- Evidence (FACT): `JSON.stringify({...})` truyền vào cột `Json?` ⇒ giá trị lưu là string, không phải object ⇒ query theo field bên trong không dùng được.
- Effort: S · Confidence: High

---

## 8. Performance / Scale Findings

### [P1] P-1 · Truy vấn không giới hạn ở các đường nóng

- Area: Performance
- Where: `leaderboard/route.ts:39` (toàn bộ member ACTIVE mỗi 30s), `leaderboard/chapters/route.ts:40`, `chapters/[chapterId]/dashboard/courses/route.ts:39,72`, `courses/[courseId]/students/route.ts:41,52,63`, `streak/route.ts:17,23`, `lessons/[lessonId]/comments/route.ts:16`, `assessments/[assessmentId]/attempts/me/route.ts:10`, `lib/progress/calculator.ts` (nạp toàn bộ progress + attempts của tập user)
- Evidence (FACT): không có `take`/`skip`; pagination (nếu có) làm bằng cách slice trong JS sau khi nạp hết.
- Impact: độ trễ và bộ nhớ tăng tuyến tính theo số member/attempt; ở quy mô vài nghìn member các dashboard/leaderboard sẽ là bottleneck đầu tiên.
- Why it matters: đây là các màn hình mở thường xuyên nhất của cả 3 vai trò.
- Recommendation: đẩy sort + phân trang xuống SQL (aggregate thay vì nạp bảng), thêm `take` cứng cho streak/comments.
- Effort: M · Confidence: High

### [P1] P-2 · Leaderboard chapter lấy top-50 rồi mới sort → sai kết quả

- Area: Performance / Functional
- Where: `leaderboard/chapters/[chapterId]/route.ts:23` (`take: 50` rồi `results.sort()`)
- Evidence (FACT): sắp xếp một trang thay vì toàn bộ tập ⇒ thứ hạng sai khi chapter > 50 người.
- Recommendation: sort trong SQL rồi mới lấy top N.
- Effort: S · Confidence: High

### [P2] P-3 · N+1 ở cron auto-submit

- Area: Performance
- Where: `internal/attempts/auto-submit/route.ts:48-84` (mỗi attempt: 1 update + 1 findUnique + 1 upsert)
- Recommendation: batch bằng `updateMany` + `createMany`/`upsert` theo lô, gom assessment lookup 1 lần.
- Effort: S · Confidence: High

### [P2] P-4 · Cache invalidation không đầy đủ sau mutation

- Area: Performance / Correctness
- Where: `invalidateCoursesServerCache()` chỉ được gọi ở `courses/route.ts:101` (POST); publish/unpublish chỉ gọi `invalidateSystemDataCache()`; PATCH/DELETE course không gọi cache nào; thêm/xoá session/lesson cũng không invalidate cache system-data 30s
- Evidence (FACT): đối chiếu các call site invalidate với danh sách mutation.
- Impact: sau khi publish, member có thể vẫn không thấy khóa học (tối đa 15s/instance); denominator tiến trình (tổng số lesson) sai trong 30s sau khi thêm bài.
- Recommendation: gọi invalidate tương ứng trong mọi mutation nội dung; hoặc chuyển sang tag-based cache.
- Effort: S–M · Confidence: High

### [P3] P-5 · Cache in-memory theo instance không chia sẻ giữa các lambda

- Area: Performance / Correctness
- Where: `lib/server-cache.ts`, `lib/progress/calculator.ts:50-55`, `lib/auth.ts:28-38`, `leaderboard/route.ts:11`
- Evidence (INFERENCE): trên Vercel serverless, mỗi instance có Map riêng ⇒ TTL thực tế dài hơn danh nghĩa và hành vi read-after-write không xác định.
- Recommendation: chấp nhận (đơn giản, rẻ) nhưng không được dựa vào cache để đảm bảo tính đúng; nơi cần chính xác thì bypass cache như `my-progress` đang làm.
- Effort: — · Confidence: Medium

---

## 9. Architecture / Code Quality Findings

### [P1] A-1 · Phân quyền nằm rải rác, helper gom quyền là dead code

- Area: Architecture
- Where: `src/lib/auth.ts:145` (`assertChapterAccess`), `:155` (`resolveChapterScope`) — **0 file import**; mỗi route tự viết lại `if (role !== 'ADMIN')`; `/api/**` không có trong `middleware.ts:184-196`
- Evidence (FACT): grep usage của 2 helper = 0; matcher của middleware chỉ gồm page routes.
- Impact: đây là root cause chung của S-1…S-4, S-6, F-6; thêm route mới là thêm cơ hội bỏ sót guard.
- Recommendation: một `withAuth(handler, { roles, requireCourseAccess, requireLessonReadable })` wrapper cho toàn bộ `/api/v1/**`.
- Effort: M · Confidence: High

### [P2] A-2 · Logic tiến trình/hoàn thành bị định nghĩa trùng ở ≥4 nơi

- Area: Architecture / Domain
- Where: `lib/progress/calculator.ts:180-181`, `courses/[courseId]/my-progress/route.ts`, `courses/[courseId]/students/route.ts:73`, `lessons/[lessonId]/progress/route.ts:75-77`, `attempts/[attemptId]/submit/route.ts:107-127`
- Evidence (FACT): mỗi nơi một định nghĩa "hoàn thành khóa học" khác nhau; hằng số pass/watch lặp lại (`0.85` vs `0.8` vs `85`).
- Recommendation: một module domain duy nhất export `isLessonCompleted`, `isCourseCompleted`, các hằng số ngưỡng.
- Effort: M · Confidence: High

### [P2] A-3 · Hai mô hình quiz khác nhau (BA course-level vs code per-lesson)

- Area: Architecture / Domain
- Where: `docs/ba-document.md` BR-04 (1 quiz cuối khóa) vs `schema.prisma:294` (`Assessment.lesson_id @unique`) + `lessons/[lessonId]/assessment`
- Evidence (FACT): sai khác mô hình; các rule BR-04 ("chỉ bắt đầu khi tất cả lesson hoàn thành", "24h", "shuffle") được viết cho mô hình cũ.
- Impact: tranh chấp "đúng/sai" giữa BA và sản phẩm sẽ tái diễn ở mọi lần nghiệm thu.
- Recommendation: cập nhật BA doc theo mô hình per-lesson, hoặc xác nhận lại yêu cầu; sau đó rà các rule BR-04 còn treo.
- Effort: S (tài liệu) · Confidence: High

### [P3] A-4 · Trang quiz cấp khóa là dead-end

- Area: Code quality / UX
- Where: `student/courses/[courseId]/quiz/page.tsx` (chỉ hiển thị thông báo "đã chuyển vào trong bài học") nhưng `student/progress/page.tsx:177,191` vẫn link tới đó kèm `?assessmentId=`
- Recommendation: bỏ link hoặc chuyển hướng về đúng lesson.
- Effort: S · Confidence: High

### [P3] A-5 · Animation không tồn tại trong config

- Area: Code quality
- Where: `animate-fade-in` (`YouTubePlayer.tsx:518`), `animate-fadeIn` (`LessonQuiz.tsx:220`, `LessonComments.tsx:442`) — không có trong `tailwind.config.ts`, `globals.css` chỉ có `fadeInPage`
- Impact: các banner "hoàn thành/đạt" không chạy animation như thiết kế (nhỏ nhưng là điểm chạm cảm xúc).
- Effort: S · Confidence: High

---

## 10. Testing / Operations Findings

### [P1] T-1 · Không có CI; các bộ test không được wiring và đang assert hành vi chưa tồn tại

- Area: Testing
- Where: `package.json:5-18` (không script test), không có `.github/`, `vercel.json`, `Dockerfile`; `test-all-final-suite.js:637-638` & `test-qa-master-suite.js:346` kỳ vọng `400 SeekAheadNotAllowed` (code thật trả 200 + clamp); `test-all-final-suite.js:805-809` kỳ vọng `403 CooldownActive` (không tồn tại trong `src/`)
- Evidence (FACT ✅ một phần): grep `SeekAheadNotAllowed`/`CooldownActive` trong `src/` = 0; có force-pass (`test-all-final-suite.js:603,808-809`).
- Impact: "test xanh" không chứng minh điều gì; regression lọt không bị chặn.
- Recommendation: (1) thêm script `npm test` + 1 job CI chạy `tsc` + bộ suite; (2) sửa/xoá các assertion sai; (3) bổ sung test cho 6 invariant đang trống: scoring theo câu hỏi, gate video trước quiz, cooldown, download authorization, presign/confirm binding, cache invalidation.
- Effort: M · Confidence: High

### [P2] T-2 · Không có structured log / correlation ID

- Area: Operations
- Where: chỉ `console.log/error`; grep `requestId|correlation|logger|pino|winston` = 0
- Impact: truy vết 1 lỗi 500 xuyên nhiều serverless invocation phải làm thủ công.
- Recommendation: thêm request id vào context và log JSON tối thiểu ở route wrapper.
- Effort: S–M · Confidence: High

### [P2] T-3 · Lỗi bị nuốt ở nhiều nơi

- Area: Operations
- Where: server `lib/auth.ts:77,138`, `api/v1/auth/logout/route.ts:20`, `documents/[documentId]/route.ts` (xoá R2 fail vẫn xoá DB), `auth/password-reset/request/route.ts:51` (bỏ qua kết quả gửi mail, luôn trả `sent:true`); client `YouTubePlayer.tsx` (13 chỗ), `LessonQuiz.tsx:73,119`
- Impact: thất bại thật (mail, R2, refresh token, ghi tiến trình) không để lại dấu vết nào.
- Recommendation: tối thiểu log warn có ngữ cảnh; với mail/R2 trả cờ `emailSent`/`storageDeleted` như pattern đã dùng ở invitation.
- Effort: M · Confidence: High

### [P2] T-4 · Fallback env nguy hiểm và thiếu `.env.example`

- Area: Operations / Security
- Where: `src/lib/email.ts:6-7` (`EMAIL_FROM || 'onboarding@resend.dev'`, `NEXT_PUBLIC_APP_URL || 'http://localhost:3000'`), `tokens.ts:12` (`TOKEN_HASH_PEPPER || ''`), `prisma/seed.ts:65-66` (mật khẩu admin mặc định), `test-qa-master-suite.js:507` (fallback `CRON_SECRET`), `health/route.ts:31`
- Evidence (FACT): các giá trị fallback hardcode nằm trong repo; không có `.env.example`.
- Impact: môi trường thiếu biến vẫn "khởi động khoẻ" nhưng link email trỏ localhost / token hash không pepper.
- Recommendation: fail-fast khi thiếu biến bắt buộc ở production; thêm `.env.example` liệt kê tên biến.
- Effort: S · Confidence: High

### [P3] T-5 · Chiến lược migration rủi ro

- Area: Operations
- Where: `apply-migration.js` (chạy lại nguyên file init SQL), `scripts/migrate_data.js` (`ON CONFLICT DO NOTHING`, mismatch chỉ warn), `package.json:11-12` (`db:migrate` + `db:push` cùng tồn tại)
- Evidence (FACT): chỉ có 1 migration trong repo trong khi schema đã tiến hoá (comments, assessments per-lesson…).
- Impact: thay đổi schema sau này không có file migration ⇒ không tái lập được môi trường; `DO NOTHING` che giấu mất dữ liệu.
- Recommendation: chốt một đường duy nhất (`prisma migrate`), generate migration cho phần đã drift.
- Effort: M · Confidence: High

---

## 11. Quick Wins (nhỏ, impact rõ)

1. Thêm guard cho `GET /api/v1/sessions/[sessionId]` (copy logic từ `lessons/[lessonId]`). — S
2. Yêu cầu đăng nhập cho 2 endpoint leaderboard + bỏ `email` khỏi payload; yêu cầu auth cho GET comments. — S
3. `/api/v1/health` chỉ trả `{status}` công khai. — S
4. Đọc `locked_until` khi đăng nhập để tài khoản tự mở khoá. — S
5. `await` trước khi toast/đóng modal ở `handleSaveLesson` & `handleSaveSession`. — S
6. Xoá `Sidebar` + `ml-64` trùng ở `student/courses/[courseId]/page.tsx:262-263`. — S
7. Validate `selectedOption.question_id === questionId` + `questionId ∈ attempt_questions` trong submit. — S
8. Trả `startedAt` trong payload attempt đang làm; chặn submit khi quá `expires_at`. — S
9. Hiện nút "Gửi lại" cho lời mời hết hạn. — S
10. Thống nhất copy giới hạn tài liệu (25/100/4.5MB → 1 con số). — S
11. Sửa link ô chapter trong `admin/users` trỏ về filter user theo chapter. — S
12. Thêm `role` thật thay vì hardcode "Trưởng Chapter (BĐHU)" ở danh sách lời mời. — S
13. Hiện cảnh báo khi heartbeat tiến trình thất bại. — S
14. Thêm `htmlFor`/`id` cho input, `aria-live` cho toast/kết quả quiz. — S
15. Xoá/bỏ link tới trang quiz cấp khóa dead-end. — S

---

## 12. Larger Improvements

1. **Route wrapper phân quyền dùng chung** (`withAuth` + scope course/lesson/chapter) thay cho việc tự viết guard ở 59 handler; xoá dead code hoặc dùng lại `assertChapterAccess`/`resolveChapterScope`.
2. **Sửa drift migration + bù FK/bảng** và chuyển hẳn sang `prisma migrate` (kèm kịch bản kiểm tra DB production).
3. **Module domain duy nhất cho tiến trình/hoàn thành** + chốt lại các ngưỡng (85% watch, 85% pass, cooldown 24h) và đồng bộ mọi surface.
4. **Bulk authoring**: dán nhiều lesson, dán nhiều câu hỏi, clone lesson/session/quiz, mời nhiều email, drag & drop reorder.
5. **Paginator + filter đồng nhất** cho 5 danh sách quản trị đang bị cắt ở 20.
6. **Observability**: audit log cho mọi mutation đặc quyền, structured logging + request id, cảnh báo khi email/R2 fail.
7. **CI tối thiểu**: `tsc --noEmit` + bộ smoke suite chạy trên PR; sửa các assertion sai và force-pass.
8. **Scope dữ liệu theo chapter** (nếu BA xác nhận cần) — thêm `chapter_id` cho Course và enforce khi đọc/ghi.

---

## 13. Priority Table

| Priority | Finding                                          | Impact                                         | Frequency                           | Effort | Evidence                                                |
| -------- | ------------------------------------------------ | ---------------------------------------------- | ----------------------------------- | ------ | ------------------------------------------------------- |
| P0       | S-1 Session GET không auth                      | Rò rỉ nội dung DRAFT/PRIVATE                | Mỗi lần gọi                      | S      | `sessions/[sessionId]/route.ts:5-44`                  |
| P0       | F-2 Điểm quiz bị làm giả                    | Sai lệch chứng nhận, dữ liệu điểm hỏng | Mỗi lượt thi                     | S–M   | `attempts/[attemptId]/submit/route.ts:31-56,80`       |
| P2 | D-1 Drift migration ⇄ schema (đã kiểm chứng: DB thật khớp schema, drift chỉ trong file) | Phá DB mới nếu ai đó chạy migration | Khi dựng môi trường mới | M | `migration.sql:158-167,269`; DB thật: `lesson_id`, 57 FK |
| P0       | F-1`assessmentId`/`latestAttempt` luôn null | Dashboard vs progress mâu thuẫn              | Hằng ngày                         | S      | `calculator.ts:98,201`                                |
| P1       | S-2 Đề thi đọc ẩn danh                      | Rò rỉ đề + đáp án                       | Mỗi lần gọi                      | S      | `lessons/[lessonId]/assessment:28,53`                 |
| P1       | S-3 Đáp án cho mọi BĐHU                     | Lộ ngân hàng câu hỏi                      | Mỗi lần gọi                      | S      | `assessments/[assessmentId]:35`                       |
| P1       | S-4 Leaderboard/comments công khai + email      | Rò rỉ PII                                    | Mỗi lần gọi                      | S      | `leaderboard/route.ts:23`                             |
| P1       | S-8 Lockout vĩnh viễn                          | DoS tài khoản                                | Khi bị tấn công                  | S      | `login/route.ts:63` (không nơi nào đọc)          |
| P1       | S-7 Không rate limiting                         | Spam mail/comment, brute force                 | Khi bị tấn công                  | M      | không có limiter trong`src/`                        |
| P1       | F-3 Không cooldown 24h                          | Brute-force key                                | Mỗi lượt thi                     | S      | `assessments/[assessmentId]/attempts`                 |
| P1       | F-6 Published vẫn sửa được qua API          | Học viên bị đổi đề giữa chừng         | Khi admin lạm dụng/script         | M      | các route nội dung chỉ check role                    |
| P1       | U-2 Toast trước khi lưu                       | Mất dữ liệu nhập + báo sai                | Mỗi lần tạo                      | S      | `edit/page.tsx:315-316,711-713`                       |
| P1       | A-1 Guard rải rác, helper dead code            | Root cause của nhóm S                        | Thường trực                      | M      | `auth.ts:145,155` unused                              |
| P1       | U-1 Hai sidebar                                  | Giao diện hỏng                               | Mỗi lần xem khóa học            | S      | `layout.tsx:93-100` + `[courseId]/page.tsx:262-263` |
| P1       | P-1 Truy vấn không giới hạn                  | Chậm khi dữ liệu lớn                       | Hằng ngày                         | M      | leaderboard/students/streak/comments                    |
| P1       | T-1 Không CI + test assert sai                  | Regression lọt                                | Thường trực                      | M      | `package.json`, `test-all-final-suite.js:637`       |
| P2       | U-4 Danh sách cắt ở 20                        | Admin hiểu sai quy mô dữ liệu              | Hằng ngày                         | M      | `admin/courses/page.tsx:31-37`                        |
| P2       | U-3 Không bulk/clone                            | Tốn thời gian tạo nội dung                 | Mỗi khóa học                     | M      | `edit/page.tsx:446-455,973-993`                       |
| P2       | F-8 UI tick xong trước khi pass quiz           | Lệch trạng thái                             | Mỗi bài có quiz                  | S      | `progress/route.ts:75-77`                             |
| P2       | D-4 Thiếu transaction                           | Trạng thái nửa vời                         | Khi có lỗi                        | M      | 7 vị trí liệt kê                                    |
| P2       | S-6 Tài liệu PRIVATE cho mọi user ACTIVE      | Rò rỉ tài liệu                             | Mỗi lần gọi                      | S      | `download/route.ts:45-51`                             |
| P2       | S-5 Health lộ cấu hình                        | Trinh sát hạ tầng                           | Mỗi lần gọi                      | S      | `health/route.ts:31-39`                               |
| P2       | U-9 Đáp án chỉ ở localStorage               | Mất bài làm                                 | Khi đổi thiết bị                | S–M   | `LessonQuiz.tsx:69-73`                                |
| P3       | U-10, U-11, A-4, A-5, D-7, T-5                   | Polish                                         | —                                  | S      | xem mục tương ứng                                   |

---

## 14. Top 10 Actions

1. Thêm guard auth + scope cho `GET /api/v1/sessions/[sessionId]` — lỗ hổng nghiêm trọng nhất, sửa trong vài dòng.
2. Sửa tính toàn vẹn chấm điểm quiz: ràng buộc option với đúng câu hỏi và chỉ nhận câu hỏi thuộc attempt.
3. Bỏ `assessmentId: null` trong calculator để dashboard và trang tiến trình thống nhất.
4. Áp auth cho 2 endpoint leaderboard + GET comments và loại email khỏi payload công khai.
5. Xác định drift migration/schema trên DB thật rồi tạo migration bù FK, `lesson_comments`, và cột `assessments.lesson_id`.
6. Đảo thứ tự `await → toast → đóng modal` ở tạo lesson/session để không mất dữ liệu đã nhập.
7. Enforce cooldown 24h + kiểm tra `expires_at` khi nộp bài, trả `startedAt` cho client.
8. Đóng khả năng sửa nội dung khóa đã Published ở tầng API (helper dùng chung).
9. Bổ sung rate limiting cho login, password-reset, invitation, comments, presign.
10. Dựng CI tối thiểu (`tsc` + smoke suite) và sửa các test đang assert hành vi chưa tồn tại.

---

## 15. Missing Features / Product Opportunities

Chỉ nêu khi có lý do nghiệp vụ rõ ràng.

1. **Bulk Authoring (lesson + câu hỏi)**
   Problem → admin tạo từng item một, mỗi lesson còn phải chờ round-trip YouTube.
   Evidence → 25 modal cho 1 khóa 5×4; 20 lần "＋ Thêm câu hỏi" cho 1 quiz 20 câu; không có clone/paste.
   Proposed capability → ô dán nhiều dòng cho lesson, khung dán câu hỏi A*/B/C/D, nút Nhân bản lesson/session/quiz.
   Expected benefit → giảm ~80% thao tác khi soạn nội dung; giảm lỗi nhập tay.
2. **"Tiếp tục học" trỏ thẳng bài đang dở**
   Problem → member phải tự tìm lại bài giữa chừng qua 3 lớp điều hướng.
   Evidence → dashboard/progress đều link về `/student/courses/{id}` (`dashboard/page.tsx:132`, `progress/page.tsx:165-167`); không có endpoint trả "last lesson".
   Proposed capability → CTA "Tiếp tục học: {bài}" trên dashboard/progress, deep-link `/student/learning/{lessonId}` kèm resume.
   Expected benefit → tăng tỉ lệ quay lại học, giảm thao tác thừa mỗi phiên.
3. **Bulk invitation + trạng thái lời mời đầy đủ**
   Problem → mời 40 người = 40 modal; lời mời hết hạn không gửi lại được.
   Evidence → `invitations/member/route.ts` nhận 1 email/lần; `admin/invitations/page.tsx:206` chỉ hiện nút khi PENDING.
   Proposed capability → textarea danh sách email + bảng kết quả từng dòng; luôn có "Gửi lại".
   Expected benefit → onboarding chapter mới trong 1 thao tác thay vì 40.
4. **Hàng đợi "Bài cần làm" cho member**
   Problem → member không biết bài nào đang chờ quiz/bài nào bị khoá.
   Evidence → sidebar có badge quiz (`learning/[lessonId]/page.tsx:668-690`) nhưng không có màn hình tổng hợp; không có nhắc nhở.
   Proposed capability → khối "Cần hoàn thành" trên dashboard: bài chưa xem, quiz chưa pass, khóa học gần xong.
   Expected benefit → tăng tỉ lệ hoàn thành khóa, giảm bỏ dở.
5. **Dashboard vận hành có filter thời gian + export**
   Problem → mọi số liệu là all-time, không xuất được để báo cáo.
   Evidence → `admin/overview`, `dashboard/members`, `dashboard/courses` không nhận tham số ngày; không có nút export.
   Proposed capability → filter "Từ ngày – Đến ngày" + xuất CSV cho bảng chapter/member/tiến trình.
   Expected benefit → BĐHU/admin báo cáo được định kỳ mà không đụng DB.
6. **Quiz palette + cảnh báo câu chưa trả lời** *(đã mô tả ở U-8, nêu lại như cơ hội sản phẩm)*
   Problem → quiz dài một trang, nộp được khi bỏ trống.
   Evidence → `LessonQuiz.tsx:258-353,344`.
   Proposed capability → palette số câu + xác nhận trước khi nộp.
   Expected benefit → giảm nộp nhầm, tăng chất lượng dữ liệu điểm.

---

## Phụ lục — Những điểm đã kiểm chứng trực tiếp trong audit này

| Khẳng định                                                         | Cách kiểm chứng                                                   | Kết quả                                                    |
| --------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/sessions/[sessionId]` không có auth                  | Đọc toàn bộ file                                                 | ✅ xác nhận                                                |
| Submit quiz không ràng buộc option với câu hỏi                  | Đọc`submit/route.ts:25-124`                                      | ✅ xác nhận                                                |
| `latestAttempt` luôn null                                          | grep`assessmentId` trong `calculator.ts`                         | ✅ xác nhận (`:98`, `:201`)                            |
| Leaderboard bỏ kết quả`authenticate`                             | Đọc`leaderboard/route.ts:22-23`                                  | ✅ xác nhận                                                |
| `locked_until` không được đọc                                 | grep toàn`src/`                                                   | ✅ chỉ 2 chỗ ghi                                           |
| Migration thiếu FK / thiếu`lesson_comments` / dùng `course_id` | grep`migration.sql`                                                | ✅ 1`REFERENCES`, 0 `lesson_comments`, `course_id:160` |
| Hai sidebar ở trang course detail                                    | Đọc`student/layout.tsx:93-100` + `[courseId]/page.tsx:262-263` | ✅ xác nhận                                                |
| Toast "thành công" trước`await`                                 | Đọc`edit/page.tsx` khi sửa tính năng thời lượng            | ✅ xác nhận                                                |

**Chưa kiểm chứng (INFERENCE, cần đo trước khi hành động):** ảnh hưởng thực tế của drift schema trên DB production (cần truy vấn `pg_constraint`/`information_schema`); tỉ lệ tương phản màu (chưa đo bằng công cụ); hành vi cache trên nhiều instance Vercel; giới hạn kết nối pgbouncer dưới tải thật (cần benchmark theo `load-tests/`).
