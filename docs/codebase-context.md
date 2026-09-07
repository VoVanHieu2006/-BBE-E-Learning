# E-LEARNING BBE — BẢN ĐỒ CODEBASE & NGHIỆP VỤ

> Tài liệu context tổng hợp để các phiên làm việc sau không phải đọc lại toàn bộ codebase + `docs/ba-document.md`.
> Cập nhật lần cuối: 2026-09-06. Nếu kiến trúc thay đổi lớn, cập nhật file này.

## 1. Nghiệp vụ (nguồn: docs/ba-document.md)

- Sản phẩm: e-learning đào tạo nội bộ CLB BBE. Roles: `ADMIN`, `CHAPTER_LEADER` (BĐHU — Ban Điều Hành), `MEMBER`, Khách (chưa đăng nhập).
- Course = `status` (DRAFT/PUBLISHED) × `visibility` (PUBLIC/PRIVATE).
  - Khách: chỉ PUBLISHED + PUBLIC. Member/BĐHU đăng nhập: PUBLISHED (cả private). Admin: tất cả.
  - Khóa PUBLISHED không sửa nội dung được; muốn sửa phải unpublish (API trả warning ai đang học).
- **BR-03 (tiến độ):** lesson Completed khi xem ≥85% thời lượng; thành viên không tua quá phần đã xem (UI guard + server chặn, trừ ADMIN/guest); heartbeat 8s PATCH tiến độ.
- **BR-04 (bài test):** mỗi khóa tối đa 1 final test; mở khi 100% lesson completed; Pass ≥85/100; <85 chỉ thấy đúng/sai, ≥85 thấy đáp án + giải thích; attempt mới sau 24h; hết giờ tự nộp (server tính giờ).
- **FR-DB-01:** BĐHU chỉ xem dữ liệu thành viên chapter mình (server bắt buộc scope check).
- Invitation hết hạn 24h. Account status: ACTIVE/INACTIVE/LOCKED (BĐHU khóa/mở được member chapter mình, không khóa được leader/admin khác).

## 2. Kiến trúc kỹ thuật

- **Next.js 14 App Router** (`src/app`), TypeScript, Tailwind (không component lib), Prisma 6 + PostgreSQL. Toàn bộ trang là `'use client'` + fetch tới API route handlers `/api/v1/**` (Prisma bên trong). Không dùng server actions, không SWR/react-query.
- **Auth:** Bearer JWT (jose) claims `{sub, role, chapterId}` (chapterId = chapter_members đầu tiên lúc login). Token + profile nằm trong `localStorage`: `accessToken`, `refreshToken`, `user` (gồm chapterId, chapterName). Helper: `src/lib/auth.ts` — `authenticate(request)` (verify + chặn user không ACTIVE, cache 30s `userStatusCache`, `invalidateUserAuthCache()`), `resolveChapterScope()`, `assertChapterAccess()`.
- **Cache client:** `src/lib/api/client.ts` — `apiFetch` (in-memory 30s + sessionStorage 2min + dedupe in-flight + auto refresh khi 401), `getCachedApiData(path)` (đọc cache đồng bộ — pattern SWR thủ công), `clearApiCache(prefix)` sau mutation.
- **Sidebar:** `src/components/layout/Sidebar.tsx` — `NavItem {label, href, icon, prefetchUrls?}` theo role; nav admin có `prefetchUrls` (hover prefetch), nav chapter-manager/student không.
- **Layouts:** `src/app/admin/layout.tsx` ('use client' — Sidebar + idle prefetch `PREFETCH_URLS` qua `requestIdleCallback`) + `src/app/admin/loading.tsx` (skeleton route-level — **đã xóa ngày 2026-09-06** vì gây giật khi chuyển tab). `src/app/chapter-manager/layout.tsx` được tạo ngày 2026-09-06 (Sidebar + idle prefetch CM). Student area không có layout.
- **Tab switching:** các tab là route riêng (App Router `<Link>`), không phải client state.

## 3. Prisma models chính (`prisma/schema.prisma`)

- `User`: id, email @unique, password_hash, role (ADMIN|CHAPTER_LEADER|MEMBER), status (ACTIVE|INACTIVE|LOCKED). **Không có field name — UI hiển thị bằng email.**
- `Chapter` / `ChapterMember` (chapter_id + user_id, @@unique pair). Lưu ý: `acceptInvitation` tạo ChapterMember cho cả CHAPTER_LEADER → leader xuất hiện trong danh sách chapter nếu không lọc role.
- `Course`(status, visibility) → `Session`(sort_order) → `Lesson`(sort_order) → `Video`(provider YOUTUBE, youtube_video_id, duration_seconds) + `Document`. Không có bảng enrollment — "học viên của khóa" suy ra từ LessonProgress join qua lesson→session→course.
- `LessonProgress` (user_id, lesson_id, completed, completed_at, last_position_seconds, furthest_watched_position_seconds, last_watched_at) @@unique(user_id, lesson_id).
  - Tiến độ khóa = số lesson completed / tổng lesson (khóa PUBLISHED) × 100, làm tròn.
- `Assessment` (course_id @unique) → `Question` (question_text, question_type SINGLE/MULTIPLE/TRUE_FALSE, points, duration_seconds, sort_order, **explanation String?** — có sẵn trong DB) → `QuestionOption` (option_text, is_correct).
- `Attempt` (assessment_id, user_id, attempt_number, status IN_PROGRESS/SUBMITTED/AUTO_SUBMITTED/CANCELLED, score Decimal(5,2) 0–1, passed) → `AttemptAnswer`.

## 4. API routes chính (`src/app/api/v1`)

| Route | Ghi chú |
|---|---|
| `POST /auth/login` `/auth/refresh` `/auth/logout` | mint JWT kèm chapterId |
| `GET /courses` | guest: PUBLISHED+PUBLIC; member/leader: PUBLISHED; admin: tất cả (cache 15s theo role) |
| `GET/PATCH/DELETE /courses/[courseId]` | GET cho mọi role đã đăng nhập (PUBLISHED), PATCH/DELETE chỉ ADMIN |
| `POST /courses/[courseId]/publish` `/unpublish` | ADMIN; publish yêu cầu ≥1 session, mỗi session ≥1 lesson |
| `GET/POST /courses/[courseId]/assessment` | GET: mọi role, `isCorrect` + `explanation` chỉ cho ADMIN/CHAPTER_LEADER (canSeeCorrect); POST ADMIN — **delete+recreate toàn bộ questions trong transaction (reset attempts)** |
| `POST /assessments/[id]/attempts`, `POST /attempts/[id]/answers`, `POST /attempts/[id]/submit` | flow làm test; submit trả explanation (từ Question.explanation khi passed) |
| `GET/PATCH /lessons/[lessonId]/progress` | PATCH chặn tua-trước với non-admin (vượt furthest+25s → 400 SeekAheadNotAllowed); completed sticky, tự hoàn thành khi ≥85% |
| `GET /chapters/[chapterId]/dashboard/members` | ADMIN/CHAPTER_LEADER; item: {userId, email, role, status, completedCourses, totalCourses, avgProgress, completedLessons}; `?includeInactive=1` để gồm cả INACTIVE; `?search=` |
| `GET /chapters/[chapterId]/dashboard/courses` | per-course completedCount + completionRate |
| `GET /chapters/[chapterId]/members/[userId]/course-progress` | (mới 2026-09-06) per-user per-course breakdown cho trang chi tiết member |
| `PATCH /users/[userId]` | đổi status ACTIVE/INACTIVE (ADMIN: mọi người trừ admin khác; CHAPTER_LEADER: chỉ member chapter mình) — có gọi invalidateUserAuthCache |
| `DELETE /chapters/[chapterId]/members/[userId]` | xóa ChapterMember (không xóa user) |
| `POST /invitations/member`, `GET /invitations`, `POST /invitations/[id]/resend`, `DELETE /invitations/[id]` | invitation flow |
| `GET /leaderboard` | global (public best-effort auth): point = 40% courseProgress + 60% avgScore; ⚠️ paginate trước sort → page>1 sai thứ hạng (chưa sửa) |
| `GET /leaderboard/chapters`, `/leaderboard/chapters/[chapterId]` | chapters: public; [chapterId]: yêu cầu thuộc chapter (member/leader) hoặc ADMIN; công thức đã thống nhất với global |
| `GET /courses/[courseId]/students` | (mới 2026-09-06) ADMIN: mọi learner; CHAPTER_LEADER: chỉ member chapter mình |

## 5. Video player

- `src/components/YouTubePlayer.tsx` (~530 dòng, component duy nhất). Props: `{youtubeVideoId, lessonId, accessToken?, allowFreeSeek = false, initialPosition = 0, initialFurthest = 0, durationSeconds = 0, onProgress?, onComplete?}`.
- `isGuest = !accessToken` → **không POST progress** (preview mode: truyền thiếu accessToken để không ghi tiến độ).
- Guard tua-trước: interval 500ms, nếu currentTime > furthest + 6s → seekTo(furthest). Bỏ qua khi `allowFreeSeek || isGuest`.
- ≥85% → setIsCompleted + PATCH progress completed:true (chỉ member).
- `/api/v1/lessons/[lessonId]/progress` GET trả `{completed, lastPosition, furthestWatchedPositionSeconds, progressPercentage}`.
- Video là YouTube embed (không có streaming API); Document mới dùng R2 presigned URL (NFR-SEC-01).

## 6. Các trang quan trọng

- Admin: `/admin/dashboard|courses|courses/[id]/edit|users|chapters|invitations` — đều cache-first (`getCachedApiData` → setState → `apiFetch` revalidate).
- Chapter-manager: `/chapter-manager/dashboard|members|members/[userId]|courses|invitations` — cache-first + layout chung (từ 2026-09-06).
- Student: `/student/courses|courses/[id]|courses/[id]/quiz|learning/[lessonId]|dashboard|progress`; kết quả test `/final-quiz-result?attemptId=`.
- Public: `/` (landing), `/leaderboard` (guest + member global; CHAPTER_LEADER tự chuyển sang xếp hạng chapter), `/login`, `/accept-invitation`.

## 7. Quirks đã biết (chưa sửa)

- `GET /leaderboard`: take/skip trước khi sort → trang >1 sai thứ hạng.
- Chapter-manager courses page không có "khóa chưa xuất bản" (chỉ thống kê khóa PUBLISHED).
- `prisma.config.ts.bak`, các file `test-prompt*.js`, `qa-full-suite.js` ở root là script test thủ công hitting API (cần server đang chạy).
