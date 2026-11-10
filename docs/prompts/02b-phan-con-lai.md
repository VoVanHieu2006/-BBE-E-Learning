# Prompt 02b — Phần còn lại của prompt 02 (bản nháp thay đổi, nút Cập nhật, nhãn Mới trên giao diện)

Đọc `docs/prompts/00-quy-tac-chung.md`, `docs/prompts/00b-worker-ngoai.md`, rồi `docs/prompts/02-sua-khoa-da-xuat-ban-va-nhan-moi.md` (đặc tả đầy đủ, vẫn là nguồn chính). Đích đến nghiệp vụ: `docs/KHBB.md` mục 5.6, 6.1, 6.2.

## Đã làm sẵn (đã commit trong nhánh nền, đừng làm lại; chỉ dùng lại)
- `src/lib/course-update-rules.ts`: số ngày mỗi bài, chia đôi video/quiz, bài thi cuối +3, `updatedDueAt`, fingerprint yêu cầu.
- `src/lib/course-requirements.ts`: cộng ngày khi cập nhật, từ lúc cập nhật, mở lại assignment COMPLETED.
- `src/lib/course-edit-guard.ts`: guard `409 CoursePublished` và làm mới cache cho các route sửa trực tiếp (sessions, lessons, assessments, pools, final-assessment, documents, reorder).
- `src/lib/final-exam-version.ts`, `src/lib/learning-unlocks.ts`, `src/lib/lesson-learning-state.ts`: không chặn phía trước, `isNew`/`quizIsNew`/`assessmentPassed` tính phía server.
- Test: `src/test/course-update-rules.test.ts`, `src/test/lesson-new-label.test.ts`.
Đọc các file này và test của chúng trước để hiểu cái đã có. Không viết lại.

## Việc còn lại (prompt 02, phần A, F.2-F.4, test)

### 1. Bản nháp thay đổi và nút "Cập nhật khóa học" (phần A của prompt 02)
- Editor `src/app/admin/courses/[courseId]/edit/` (`useCourseEditor.ts` và các component): với khóa `PUBLISHED`, mọi sửa đổi ghi vào bản nháp qua `GET/PUT /api/v1/courses/[courseId]/draft` (model `CourseDraft` đã có, giữ khóa lạc quan theo phiên bản). Khóa `DRAFT` giữ nguyên sửa trực tiếp. Thêm nút **"Cập nhật khóa học"** (gọi `POST .../draft/publish`), hiển thị "có thay đổi chưa cập nhật", nút bỏ thay đổi, xử lý lỗi hai Admin cùng sửa. Bỏ luồng "hủy xuất bản để sửa" khỏi giao diện; hủy xuất bản chỉ còn là nút khẩn cấp riêng có hộp xác nhận nêu hậu quả (`docs/KHBB.md` 6.3). Dùng thuật ngữ "xuất bản / bản nháp".
- Server đã chặn sửa trực tiếp khóa đã xuất bản (409), nên giao diện bắt buộc đi qua bản nháp.

### 2. Sửa `src/app/api/v1/courses/[courseId]/draft/publish/route.ts`
Không nhân đôi câu hỏi và giữ `pool_id` (câu hỏi đã có attempt: không clone, cập nhật tại chỗ hoặc theo quy tắc an toàn); hỗ trợ xóa bài/session/câu hỏi/tài liệu đã bỏ khỏi bản nháp (chặn nếu đã có attempt, như các route xóa trực tiếp); kiểm tra thời lượng video (`normalizeDurationSeconds`) và dung lượng ngân hàng đề (`assertFinalExamBankCapacity`) như route trực tiếp; áp dụng `finalAssessment` bằng `createFinalExamVersion` (điểm đạt cũ vẫn tính); làm mới cache đủ; gọi lại `executePublishCourseRequirements` đúng một lần trong cùng transaction/khóa như hiện có. Thêm test cho logic thuần tách ra `src/lib/` (không cần DB).

### 3. Truyền nhãn Mới qua API (F.2)
Kiểm tra `GET /api/v1/courses/[courseId]/my-progress`, `GET /api/v1/lessons/[lessonId]/progress`, `GET /api/v1/learning/me` đã trả `isNew`, `quizIsNew`, `assessmentPassed` (các route này spread trạng thái; xác nhận bằng đọc code và test). **Không** thêm trường theo người vào `courses/[courseId]` hoặc `lessons/[lessonId]` (cache dùng chung).

### 4. Badge "Mới" và sửa hiển thị sai (F.3, F.4)
- Hiển thị chip "Mới" (dùng style chip có sẵn của dự án) ở: `src/app/student/courses/[courseId]/page.tsx` (khối khóa lẫn khối mở), sidebar và tiêu đề bài + tab quiz trong `src/app/student/learning/[lessonId]/page.tsx`, `src/app/student/learning/[lessonId]/quiz/page.tsx`, `src/components/learning/ProgramCourseTree.tsx` (mở rộng kiểu `lessonStates`).
- Sidebar bài và tab quiz đang hiện "Quiz đạt" theo `progress.completed`: đổi sang `assessmentPassed`. `allLessonsDone` ở trang khóa học phải tính cả quiz chưa đạt.
- Trang quiz `quiz/page.tsx` đã có phần điều hướng "bài tiếp theo" (đừng làm hỏng; có test `src/test/lesson-navigation.test.ts`).

### 5. Test
- Sửa `scripts/test/test-learning-cycles-integration.cjs` (đang khẳng định "cộng vào hạn cũ" quanh dòng 198-200) và `scripts/audit/audit-handbook-formulas.cjs` (case `HANDBOOK-DEADLINE-ADDED` phải PASS khi chạy được), cập nhật `docs/known-issues.md`.
- Thêm test hàm thuần cho draft/publish và nhãn Mới ở các nơi còn thiếu. Đăng ký trong `scripts/test/run-tests.cjs`. Chạy `npm run test:unit` và `npx tsc --noEmit`; Playwright nếu chạy được.

## Nghiệm thu
Dòng 10, 11, 12, 15, 18 của bảng mục 9 trong `docs/KHBB.md` đúng với code. Ghi trong `HANDOFF.md` và báo cáo những dòng còn lệch.

## Không được đụng tới
Đổi tên role/nhóm học (prompt 03), `learning_policy`/cutover (prompt 04), xóa khóa học và chuẩn hóa thuật ngữ ngoài các màn hình nêu trên (prompt 05), công thức hạn của prompt 01, mọi migration, `package.json`.
