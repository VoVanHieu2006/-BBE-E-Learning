---
status: accepted
---

# 0001 – Lưu trữ mềm câu hỏi có lịch sử và hẹn chuyển cấu hình số câu/thời gian sang tháng sau

Trong BBE E-Learning, thưởng sao mỗi tháng phụ thuộc vào số câu hỏi của bài kiểm tra (`question_count`) trong `CompetitionMonth`, còn nội dung câu hỏi trong ngân hàng cần được Admin cập nhật tự do (thêm, sửa, xóa, import) tới 200 câu/20 nhóm mà không phá vỡ lịch sử `AttemptQuestion`/`AttemptAnswer` (vốn có khóa ngoại `onDelete: Cascade` tới `questions.id`).

Chúng ta quyết định tách hai cơ chế độc lập thay vì tạo bảng versioning toàn phần cho `LESSON` assessment:
1. **Lưu trữ mềm câu hỏi (`Question.archived_at`)**: Khi câu hỏi đã có lượt làm bị xóa hoặc bị thay đổi nội dung/đáp án/điểm/giải thích, giữ nguyên dòng `Question` và `QuestionOption` cũ với `archived_at = now, pool_id = null`, đồng thời tạo dòng `Question` mới đang hoạt động (nếu là sửa). Mọi truy vấn ngân hàng hiện hành và rút đề mới chỉ đọc `archived_at IS NULL`.
2. **Hẹn chuyển cấu hình tháng sau trên `Assessment` (`scheduled_question_count`, `scheduled_duration_minutes`, `scheduled_effective_at`, `scheduled_effective_month_key`)**: Áp dụng cho cả `LESSON` và `COURSE_FINAL`. Khi bài kiểm tra đã có ít nhất một lượt làm không bị `CANCELLED` trong Tháng thi đua hiện tại (giờ VN UTC+7), mọi thay đổi `question_count` và/hoặc `duration_minutes` được ghi vào các cột `scheduled_*` thay vì ghi đè ngay, và tự động kích hoạt vào đúng 00:00:00 ngày mùng 1 tháng sau (UTC+7) qua cả cron (`reorganizations/apply`) lẫn lazy-apply khi có request đọc/bắt đầu làm bài.

## Considered Options

- **Tạo bảng `LessonAssessmentVersion` sao chép toàn bộ ngân hàng mỗi lần sửa**: Trùng lặp lớn dữ liệu ngân hàng khi Admin chỉ sửa 1–2 câu hoặc thêm câu; phức tạp hóa đồng bộ với `CourseDraft` và `QuestionPool`.
- **Giữ khóa cứng câu hỏi đã có attempt và hẹn cả ngân hàng sang tháng sau**: Không phù hợp nghiệp vụ vì Admin cần sửa lỗi câu hỏi hoặc mở rộng ngân hàng (VD 20 → 100 câu) ngay lập tức, trong khi tính công bằng thưởng sao trong tháng chỉ phụ thuộc vào `question_count` và `duration_minutes`.

## Consequences

- Lịch sử bài thi cũ (`AttemptQuestion`/`AttemptAnswer` và `question_snapshot`) được bảo toàn 100% mà không phải đổi ràng buộc FK nguy hiểm trên dữ liệu production đang chạy.
- Mọi thao tác cập nhật ngân hàng (và kiểm tra sức chứa `FinalExamBank`) phải đồng thời kiểm tra hợp lệ cho cả cấu hình hiện tại lẫn lịch tháng sau (nếu có) để không bao giờ xảy ra lỗi vỡ đề tại 00:00:00 mùng 1.
- Khi `COURSE_FINAL` đến hạn kích hoạt lịch tháng sau, bộ kích hoạt phải tạo `FinalExamVersion` mới từ ngân hàng câu hỏi đang hoạt động (`archived_at IS NULL`) để lịch sử bài thi cuối khóa cũ không bị thay đổi.
