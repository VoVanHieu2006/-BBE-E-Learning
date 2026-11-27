# BBE E-Learning — Domain Glossary

Thuật ngữ chuẩn cho miền quản trị khóa học, ngân hàng câu hỏi bài kiểm tra và lịch thay đổi cấu hình theo tháng thi đua.

## Language

**Ngân hàng câu hỏi** (*Question Bank*):
Tập hợp các câu hỏi đang hoạt động (`archived_at IS NULL`) thuộc một Quiz bài học, tối đa 200 câu chia vào 1–20 nhóm câu hỏi.
_Avoid_: Bộ đề thi, danh sách câu cố định

**Câu hỏi đang hoạt động** (*Active Question*):
Câu hỏi chưa bị lưu trữ mềm (`archived_at IS NULL`), được hiển thị cho Admin biên tập, tham gia rút đề cho lượt thi mới và được tính vào tổng ngân hàng cho Bài thi cuối khóa.
_Avoid_: Câu hỏi hiện tại, câu chưa xóa

**Câu hỏi đã lưu trữ mềm** (*Archived Question*):
Câu hỏi đã từng có lượt làm của học viên nên không bị xóa vật lý khi Admin sửa nội dung/đáp án hoặc xóa khỏi ngân hàng; câu được đánh dấu `archived_at` để bảo toàn toàn vẹn lịch sử `AttemptQuestion`/`AttemptAnswer`.
_Avoid_: Câu hỏi đã xóa, câu hỏi cũ

**Nhóm câu hỏi** (*Question Pool*):
Phân nhóm chủ đề trong một Quiz bài học (1–20 nhóm), dùng để rút đề cân bằng giữa các nhóm theo quy tắc `số nhóm ≤ questionCount ≤ số nhóm × min(câu/nhóm)`.
_Avoid_: Pool, danh mục câu hỏi

**Cấu hình thi đang áp dụng** (*Active Assessment Config*):
Cặp thông số `question_count` (số câu mỗi lượt) và `duration_minutes` (thời gian làm bài) đang có hiệu lực cho các lượt làm bài trong Tháng thi đua hiện tại.
_Avoid_: Thiết lập quiz

**Lịch chuyển cấu hình tháng sau** (*Scheduled Monthly Config*):
Cặp thông số `scheduled_question_count` và `scheduled_duration_minutes` chờ tự động thay thế Cấu hình thi đang áp dụng vào đúng 00:00:00 ngày mùng 1 tháng kế tiếp (giờ Việt Nam UTC+7) khi bài kiểm tra đã có ít nhất một lượt làm hợp lệ trong tháng hiện tại.
_Avoid_: Bản nháp tháng sau, phiên bản tháng tới

**Tháng thi đua** (*Competition Month*):
Khoảng thời gian nửa mở `[00:00:00 mùng 1, 00:00:00 mùng 1 tháng kế tiếp)` theo múi giờ Việt Nam (`Asia/Ho_Chi_Minh`, UTC+7), quyết định ranh giới tính sao thưởng và thời điểm kích hoạt Lịch chuyển cấu hình tháng sau.
_Avoid_: Tháng dương lịch UTC, chu kỳ học

**Lượt làm tính khóa tháng** (*Current-Month Locking Attempt*):
Lượt làm (`Attempt`) có `started_at` thuộc Tháng thi đua hiện tại và trạng thái thuộc `IN_PROGRESS`, `SUBMITTED` hoặc `AUTO_SUBMITTED` (không tính `CANCELLED`). Khi có ít nhất một lượt như vậy, thay đổi `question_count` hoặc `duration_minutes` phải hẹn sang tháng sau.
_Avoid_: Mọi attempt trong lịch sử
