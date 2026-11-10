# Prompt 02 — Sửa khóa đã xuất bản: bản nháp thay đổi, nút "Cập nhật khóa học", nhãn "Mới"

Đọc `docs/prompts/00-quy-tac-chung.md` trước. **Chỉ làm sau khi prompt 01 đã xong và được người dùng duyệt.** Nhánh gợi ý: `feat/cap-nhat-khoa-hoc-nhan-moi`.

## Mục tiêu
Đưa code về `docs/KHBB.md` mục 5.6, 6.1, 6.2 và các dòng 10, 11, 12, 15, 18 của bảng mục 9. Cho phép Admin sửa khóa **đã xuất bản** mà không phải hạ về bản nháp; học viên không mất tiến trình và thấy nhãn **Mới**. Không đổi schema, không thêm migration (bảng `course_drafts` đã có). Nếu buộc phải đổi schema thì dừng và hỏi.

## Bối cảnh (code hiện tại)
- Giao diện editor (`src/app/admin/courses/[courseId]/edit/useCourseEditor.ts` và các file cùng thư mục) hiện làm: hủy xuất bản → sửa trực tiếp → xuất bản lại. Nó **không** gọi `GET/PUT /api/v1/courses/[courseId]/draft` hay `POST .../draft/publish`, dù API này đã tồn tại.
- Nhiều route sửa trực tiếp khóa đã xuất bản không có guard: `PATCH/DELETE /sessions/[sessionId]`, `PATCH/DELETE /lessons/[lessonId]`, sắp xếp lại bài/session, quiz (`lessons/[lessonId]/assessment`, `assessments/[assessmentId]`, `pools`), `final-assessment`, tài liệu bài học.
- `draft/publish/route.ts` có lỗi: câu hỏi đã có attempt bị nhân bản (không gán `pool_id`, làm quiz có pool không bắt đầu được), không xóa gì (bài/session/câu hỏi/tài liệu đã bỏ vẫn còn), bỏ qua kiểm tra thời lượng video (`normalizeDurationSeconds`) và dung lượng ngân hàng đề (`assertFinalExamBankCapacity`), không áp dụng `finalAssessment`.
- Thêm bài hiện cộng ngày vào **hạn cũ** (`src/lib/course-requirements.ts`, `executePublishCourseRequirements`) và chỉ tính bài học mới, không tính quiz/bài thi cuối; không mở lại assignment đã `COMPLETED` (`syncCourseAssignmentCompletion` chỉ nâng lên COMPLETED, không hạ xuống).
- Mở khóa bài: `src/lib/lesson-learning-state.ts` (tính mỗi lần đọc, `earnedReview` = đã xong / xem đủ video / có `unlocked_at`) và `src/lib/learning-unlocks.ts` (`persistLearningUnlocks` dừng ở bài đầu tiên chưa xong, nên bài chèn giữa chặn việc mở các bài sau mốc).
- Cache: `src/lib/server-cache.ts`; chi tiết khóa cache 30 giây, chi tiết bài 15 giây.

## Việc cần làm

### A. Bản nháp thay đổi và nút "Cập nhật khóa học"
1. Với khóa `PUBLISHED`, editor ghi mọi thay đổi vào bản nháp (`CourseDraft`) thay vì sửa trực tiếp; học viên vẫn học bản đang chạy. Khóa `DRAFT` thì giữ cách sửa trực tiếp như cũ.
2. Thêm nút **"Cập nhật khóa học"** (và trạng thái "có thay đổi chưa cập nhật", nút bỏ thay đổi): gọi `draft/publish`, áp dụng **một lần** trong một transaction. Bỏ luồng "hủy xuất bản để sửa" khỏi giao diện; hủy xuất bản chỉ còn là thao tác khẩn cấp riêng, có hộp xác nhận nêu hậu quả (xem `docs/KHBB.md` mục 6.3).
3. Sửa `draft/publish`: không nhân đôi câu hỏi và giữ `pool_id`; hỗ trợ xóa bài/session/câu hỏi/tài liệu bị bỏ khỏi bản nháp (chặn xóa nếu đã có attempt, theo quy tắc sẵn có của các route xóa trực tiếp); kiểm tra thời lượng video và dung lượng ngân hàng đề như các route trực tiếp; áp dụng `finalAssessment` (lưu ý đổi đề tạo `FinalExamVersion` mới theo logic của `final-assessment/route.ts`, điểm đạt cũ vẫn tính).
4. Giữ cơ chế khóa lạc quan đang có của draft (kiểm tra phiên bản) và trả lỗi rõ khi hai Admin cùng sửa.

### B. Guard phía server và cache
1. Với khóa `PUBLISHED`, các route sửa trực tiếp liệt kê ở phần bối cảnh phải trả `409 CoursePublished` kèm hướng dẫn dùng bản nháp (route thêm session/bài và PATCH tiêu đề đã có guard, dùng làm mẫu). Admin vẫn sửa được khóa `DRAFT`.
2. Mọi thao tác ghi nội dung phải làm mới cache: `invalidateCoursesServerCache(courseId)`, `invalidateSystemDataCache`, và cache bài học; sửa chỗ đang thiếu (xóa bài chỉ làm mới khi lỗi, `final-assessment`, `assessments/[id]`, reorder...). Ghi `AuditLog` cho thao tác nội dung quan trọng nếu có mẫu sẵn trong dự án.

### C. Cộng ngày khi cập nhật (`src/lib/course-requirements.ts`)
Số ngày của **một bài** `perLesson = max(ceil(T / L_sau), 3)` với T = `mandatory_default_due_days`, L_sau = tổng số bài sau khi cập nhật. Chia đôi: `phầnVideo = ceil(perLesson / 2)` (tối thiểu 1), `phầnQuiz = perLesson - phầnVideo`.
| Thay đổi | Cộng |
|---|---|
| Bài mới có cả video và quiz | `perLesson` |
| Bài mới chỉ có video | `phầnVideo` (khi quiz được thêm sau thì cộng `phầnQuiz`) |
| Thêm riêng video vào bài đã có quiz | `phầnVideo` |
| Thêm riêng quiz vào bài đã có video | `phầnQuiz` |
| Thêm bài thi cuối khóa (khóa trước đó chưa có) | 3 ngày cố định |
| Đổi đề thi cuối (đã có) | 0 |
Cộng tất cả trong một lần cập nhật. **Tính từ lúc cập nhật** chứ không cộng vào hạn cũ:
- Người **đã xong khóa** (assignment `COMPLETED`): hạn = `lúc cập nhật + số ngày cộng`.
- Người **đang học dở**: hạn = `hạn hiện tại + số ngày cộng` (cộng dồn).
- Chỉ áp cho assignment bắt buộc còn hiệu lực; ghi `learning_path_changes` với lý do `LESSONS_ADDED_TO_COURSE`; giữ idempotent (cập nhật lại cùng nội dung không cộng thêm; dùng `course_requirement_versions.fingerprint` hiện có, và mở rộng fingerprint để bao gồm quiz/bài thi cuối nếu hiện chỉ có bài học). Tôn trọng quy tắc gia hạn tay không bị rút ngắn và cửa sổ 3 ngày đã làm ở prompt 01.
- Ví dụ phải chạy: khóa 20 ngày, 5 bài, Lan xong khóa và hạn ngày 20; ngày 30 thêm 2 bài đủ video+quiz (L_sau = 7, perLesson = 3) → +6 ngày → hạn ngày 36. Người đang học dở có hạn ngày 30, ngày 20 thêm 2 bài → ngày 36.
- Gửi `LearningNotice` cho mọi người thuộc khóa (kể cả người đã xong, vì họ phải học phần mới), không trùng khi cập nhật lại.

### D. Mở lại khóa đã xong
Khi cập nhật có bài/quiz/bài thi cuối **mới**, assignment `COMPLETED` của khóa đó chuyển về `ASSIGNED` (xóa `completed_at` nhưng lưu thời điểm hoàn thành cũ vào dữ liệu có sẵn như `learning_path_changes`/thông báo), **cùng transaction** với việc đặt hạn mới (để cron không khóa ngay). Khi người học xong phần mới, `syncCourseAssignmentCompletion` tự đưa về `COMPLETED`. Điểm thi cuối đã đạt vẫn tính, không bắt thi lại; đổi đề thi cuối cũng không mất điểm đạt cũ.

### E. Không chặn phía trước, giữ tiến trình
1. Chèn bài/quiz giữa khóa: bài và quiz đã xong giữ nguyên; bài sau mốc đã mở vẫn mở. Sửa `persistLearningUnlocks` và `readLessonLearningStates` để bài mới chưa học không chặn việc mở các bài sau (bài mới **vẫn bắt buộc** để tính hoàn thành khóa và để thi cuối). Cẩn thận nhánh không có chu kỳ (`earnedReview` luôn false) không bị khóa lại.
2. Thi cuối khóa vẫn bị chặn đến khi mọi video xem đủ và mọi quiz đạt (`checkCourseFinalProgression`), kể cả phần mới.
3. Quiz thêm vào bài đã xong: bài giữ trạng thái xong (`completed_at` sticky), quiz có nhãn Mới.

### F. Nhãn "Mới" (tính phía server, không cần migration)
1. Trong `lesson-learning-state.ts` (và hai nơi select dữ liệu bài: `readCourseLearningStates`, `learning/me`), thêm vào trạng thái từng bài: `isNew`, `quizIsNew`, `assessmentPassed`. Quy tắc: một bài (hoặc quiz) là "mới" với một người nếu `created_at` của nó **sau mốc tương tác đầu tiên của người đó với khóa** (sớm nhất của `unlocked_at`/`completed_at` trong khóa) và người đó **chưa hoàn thành** nó (bài chưa xong / quiz chưa đạt). Người chưa tương tác gì thì không có nhãn. Nhãn tự mất khi hoàn thành. Cần thêm `created_at` vào các select liên quan; lưu ý quiz tạo lại (xóa tạo lại) đặt lại `created_at`.
2. Truyền các trường mới qua `GET /api/v1/courses/[courseId]/my-progress`, `GET /api/v1/lessons/[lessonId]/progress`, `GET /api/v1/learning/me`. **Không** đặt trường theo người vào `courses/[courseId]` hoặc `lessons/[lessonId]` vì hai route này có cache dùng chung.
3. Hiển thị badge "Mới": trang khóa học `src/app/student/courses/[courseId]/page.tsx` (cả khối khóa lẫn khối mở), sidebar và tiêu đề bài trong `src/app/student/learning/[lessonId]/page.tsx` (tab quiz nữa), `src/app/student/learning/[lessonId]/quiz/page.tsx`, `src/components/learning/ProgramCourseTree.tsx` (mở rộng kiểu `lessonStates`). Dùng style chip sẵn có của dự án.
4. Sửa hiển thị sai liên quan: sidebar bài và tab quiz đang hiện "Quiz đạt" dựa vào bài xong (`progress.completed`) → dùng `assessmentPassed`; `allLessonsDone` ở trang khóa học phải tính cả quiz chưa đạt.

## Test phải thêm hoặc sửa
- Hàm thuần cho số ngày cộng (perLesson, chia đôi, bài thi cuối) và hạn mới; ví dụ ở phần C.
- Trạng thái học: chèn bài giữa khóa không khóa lại bài đã mở; mở lại COMPLETED; thi cuối bị chặn đến khi xong phần mới nhưng điểm cũ vẫn tính; `isNew`/`quizIsNew`/`assessmentPassed`.
- Sửa `scripts/test/test-learning-cycles-integration.cjs` (đang khẳng định hành vi cũ "cộng vào hạn cũ", quanh dòng 198-200) và `scripts/audit/audit-handbook-formulas.cjs` (case `HANDBOOK-DEADLINE-ADDED` phải thành PASS), cập nhật `docs/known-issues.md`.
- Test guard `409 CoursePublished`; test `draft/publish` không nhân đôi câu hỏi, giữ `pool_id`, xóa đúng. Nếu không có DB test, tách logic thuần và nói rõ phần chưa kiểm chứng.
- Đăng ký test mới trong `scripts/test/run-tests.cjs`; chạy `npm run test:unit`, `npx tsc --noEmit`, và Playwright cho nhãn Mới nếu chạy được (`playwright.quiz.config.ts` là mẫu mock API).

## Nghiệm thu
Các dòng 10, 11, 12, 15, 18 của bảng mục 9 trong `docs/KHBB.md` đúng với code; liệt kê dòng còn lệch.

## Không được đụng tới
Công thức hạn khi thêm khóa/đổi ban/gỡ khóa (prompt 01, chỉ dùng lại), đổi tên role/nhóm học (prompt 03), `learning_policy` (prompt 04), xóa khóa học và rà soát cache toàn hệ thống ngoài đường nội dung khóa (prompt 05), mọi migration cũ.
