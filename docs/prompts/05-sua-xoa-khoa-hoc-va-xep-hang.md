# Prompt 05 — Sửa/xóa khóa học và kiểm chứng xếp hạng người đã rời

Đọc `docs/prompts/00-quy-tac-chung.md` trước. **Chỉ làm sau khi prompt 01-04 đã xong và được duyệt.** Nhánh gợi ý: `fix/xoa-khoa-hoc-va-xep-hang`.

## Mục tiêu
Xử lý các lỗi còn lại khi Admin xóa/sửa khóa học (đã khảo sát), và đối chiếu code với quy tắc lịch sử xếp hạng trong `docs/CKNK.md` mục 5.10 (dòng 19 của bảng mục 9 trong `docs/KHBB.md`). Phần sửa khóa đã xuất bản qua bản nháp đã làm ở prompt 02, đừng làm lại.

## Việc cần làm

### A. Xóa khóa học (`src/app/api/v1/courses/[courseId]/route.ts`, DELETE)
1. Hiện xóa cứng không điều kiện và cascade cả bài làm (`attempts`), assignment, rule. Chặn xóa khi khóa đã có attempt hoặc tiến độ học viên (trả `409` có hướng dẫn); với khóa chưa có học viên thì cho xóa. Nếu muốn giữ khả năng "gỡ khóa đã dùng", chỉ đề xuất soft-delete trong báo cáo, **không tự thêm cột/migration** (hỏi người dùng).
2. Làm mới cache đầy đủ khi xóa: `invalidateCoursesServerCache` và `invalidateSystemDataCache`, cache bảng xếp hạng thành viên/chapter nếu có liên quan.
3. Khi xóa khóa chưa có học viên mà có rule/assignment: reconcile lại (enqueue) và đóng rule liên quan thay vì để cascade âm thầm; không để `learning_paths.due_at` treo.

### B. Dữ liệu mồ côi và nhật ký
1. Các bảng không có khóa ngoại tới bài/video/quiz/khóa và bị bỏ lại khi xóa: `cycle_lesson_progress`, `monthly_video_replays`, `quiz_reward_high_water_marks`, `supplemental_learning_requirements`, `course_requirement_versions`, `course_publication_events`. Đề xuất cách dọn **an toàn** (khi xóa bài/khóa chưa có học viên thì xóa dòng liên quan trong cùng transaction; không động tới dữ liệu của khóa đã có học viên). Không xóa `star_ledger`.
2. Tài liệu tệp đính kèm (R2) và ảnh bìa (Cloudinary) bị bỏ lại khi xóa bài/session/khóa: xóa object tương ứng sau khi giao dịch DB thành công, lỗi xóa object chỉ ghi log.
3. Ghi `AuditLog` cho thao tác nội dung quan trọng (xóa khóa/session/bài, hủy xuất bản, cập nhật khóa) nếu dự án đã có mẫu ghi audit; nếu chưa có mẫu thì chỉ nêu trong báo cáo.
4. `PATCH sessions/reorder`: kiểm tra các session thuộc đúng `courseId`, kiểm tra đầu vào, bắt lỗi thay vì trả 500; áp guard `CoursePublished` nếu prompt 02 chưa phủ.

### C. Quiz bài học và lỗi nhỏ đã biết
1. `PUT assessments/[assessmentId]/pools` ép đúng 5 pool trong khi `POST` cho 1-20: thống nhất, và kiểm tra `question_count` so với `số pool × cỡ pool nhỏ nhất` như `attempts/route.ts` làm, đưa vào cùng transaction/khóa với kiểm tra số attempt.
2. Quiz bài học bị khóa sửa sau lần làm đầu tiên (`AssessmentVersionRequired`). Chỉ nêu trong báo cáo hướng versioning cho quiz bài học, **không tự làm**.
3. `GET assessments/[assessmentId]` cho phép `CHAPTER_LEADER`/`LEAD` xem ngân hàng đề của quiz bài học (lộ đáp án): siết lại chỉ Admin, trừ khi có lý do nghiệp vụ rõ ràng (hỏi).

### D. Bảng xếp hạng người đã rời (đối chiếu với `docs/CKNK.md` mục 5.10)
Quy tắc: một người xuất hiện trong bảng nếu còn hoạt động đến lúc chụp bảng; bảng đã chốt (snapshot) giữ nguyên người đã rời; bảng đang diễn ra ẩn người đã vô hiệu hóa và không tính vào quân số từ lúc rời; chuyển giao/reset giữ snapshot. Đọc `src/lib/competition-snapshots.ts`, `src/lib/period-leaderboard.ts`, các route `leaderboard/**`, `chapters/[chapterId]/dashboard/members` và `current-roster`:
1. Kiểm tra bảng đã chốt có còn hiện người đã `INACTIVE`/đã rời không (đừng lọc theo trạng thái hiện tại khi đọc snapshot).
2. Kiểm tra bảng đang diễn ra có loại người đã vô hiệu hóa và khỏi quân số không.
3. Sửa nếu lệch; thêm test; nếu thấy trường hợp mơ hồ (tài khoản ẩn danh hóa hiển thị tên gì, điểm tháng của người rời giữa nhiệm kỳ) thì ghi vào báo cáo để hỏi người dùng, không tự quyết.
4. Cập nhật mục cuối `📄 Chưa kiểm chứng trong code` của `CKNK.md` 5.10 thành kết quả thật.

### E. Thuật ngữ trên giao diện — KHÔNG làm trong lượt này
Việc chuẩn hóa "xuất bản / bản nháp" trên giao diện bị bỏ qua ở đây vì trùng file với prompt 02b (đang chạy song song); người điều phối sẽ làm sau khi gộp nhánh.

### Phối hợp với worker khác (đang chạy song song)
- Prompt 02b sửa editor khóa học, `draft/publish`, các trang học viên: không sửa các file đó.
- Prompt 04 sở hữu mọi chỗ liên quan mốc sàn cutover trong `src/lib/competition-snapshots.ts` và `src/lib/period-leaderboard.ts`: ở phần D chỉ **đọc** hai file này; chỉ sửa khi chứng minh được lỗi cụ thể và sửa tối thiểu, rồi ghi vào `HANDOFF.md` mục "xung đột có thể".

## Test và nghiệm thu
Test cho: xóa khóa có/không có attempt, reorder sai `courseId`, pools PUT, quyền xem ngân hàng đề, bảng đã chốt/đang diễn ra với người đã rời. Chạy `npm run test:unit`, `npx tsc --noEmit`. Đóng dòng 19 của bảng mục 9 (hoặc ghi rõ còn lệch) và cập nhật `docs/known-issues.md`.

## Không được đụng tới
Công thức hạn và khóa (01), cập nhật khóa và nhãn Mới (02), đổi tên role/nhóm học (03), `learning_policy` (04), mọi migration cũ, `star_ledger`.
