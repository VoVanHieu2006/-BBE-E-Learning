# Audit nhiệm kỳ và thưởng của Chapter mới

**BLOCKED — chưa thực hiện audit trong lượt sửa P0 video.**

Base/HEAD: `c6671286b2b9733cb48fb9b92c3ab67ab72f4509`.

Người dùng xác nhận 12 câu hỏi nằm ở Phase3/mục17 của prompt trước; nội dung nguyên văn không có trong ngữ cảnh mới. Người dùng yêu cầu ưu tiên video MEMBER và không tự sửa tính năng khác. Đã yêu cầu gửi lại mục17, kèm mục6/V01–V15.

Chưa kiểm chứng hai Chapter tạo ngày26/10, chưa chạy ma trận A–E hoặc transaction fixture trên DB, chưa kết luận về APPLIED, nhiệm kỳ đầu hay `reward_suppressed_at`. Những nhận định trong kế hoạch cũ chưa được coi là bằng chứng nghiệm thu ở lượt này.

Không sửa schema, dữ liệu, policy, season, lịch kỳ, cấu hình khóa học, cutover, chuyển giao hoặc reward gate. Không đưa ra quyết định chính sách thay người dùng.

Để tiếp tục cần nguyên văn12 câu hỏi và mô tả A–E. Nếu sau đó cần DB thật, xác định môi trường được phép và phạm vi transaction rollback trước khi mô phỏng. Không cần tài khoản E2E để hoàn tất bản sửa video và unit/integration giả lập.
