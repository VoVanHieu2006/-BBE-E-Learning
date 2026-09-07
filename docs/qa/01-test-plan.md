# BBE E-Learning System — Test Plan

> **Phiên bản:** MVP-1 / MVP-2  
> **Người lập:** QA/Tester  
> **Ngày cập nhật:** điền khi dùng

## 1. Mục tiêu kiểm thử

Xác nhận từng module do AI code hoàn thành đúng theo BA document, DBML schema và API design đã đặc tả — đúng luồng nghiệp vụ, đúng phân quyền, đúng các business rule (BR-01 → BR-08), và không phá vỡ các module đã pass trước đó (regression).

## 2. Phạm vi

### Trong phạm vi (MVP-1)

Invitation/đăng nhập, phân quyền theo role (Admin/BĐHU/Member/Khách), quản lý course-session-lesson-video-tài liệu, học viên xem nội dung & tự theo dõi tiến độ, làm bài kiểm tra cuối khóa, BĐHU xem tiến độ chapter mình.

### Trong phạm vi (MVP-2)

Dashboard Admin, Streak, Leaderboard, Chatbot BBE — kiểm thử khi các module này được code, dùng cùng khuôn mẫu test case ở Sheet 'Test Cases'.

### Ngoài phạm vi

Ứng dụng mobile, lớp học livestream, chapter tự tạo bài học nội bộ, chấm tự luận bằng AI, tạo chứng chỉ, tích hợp hệ thống bên ngoài.

## 3. Các mức kiểm thử (Test Levels)

- **Unit test:** AI code tự viết kèm mỗi module (đã yêu cầu ở playbook prompt). Tester không viết lại, chỉ xác nhận có tồn tại và chạy pass trước khi nhận module.
- **API / Integration test:** Tester thực hiện thủ công qua Postman/Thunder Client theo từng Test Case ở Sheet 'Test Cases' — đây là lớp kiểm thử chính của tài liệu này.
- **UI / E2E test:** Sau khi nối UI (Prompt 9), lặp lại các kịch bản chính bằng thao tác tay trên trình duyệt, tối thiểu 1 lần/role (Admin, BĐHU, Member, Khách).
- **Regression test:** Sau mỗi lần AI sửa code (kể cả sửa bug nhỏ), chạy lại toàn bộ Test Case Priority = High của MODULE đó + các module có phụ thuộc trực tiếp (xem cột 'Requirement Ref' ở Sheet Test Cases để biết module nào dùng chung permission/service).

## 4. Môi trường & dữ liệu kiểm thử

- **Môi trường:** Một Supabase project riêng cho staging/test, KHÔNG dùng chung DB với production. Bucket R2 riêng (vd `bbe-elearning-docs-staging`).
- **Tài khoản mẫu cần tạo trước khi test:** 1 Admin, 2 BĐHU (2 chapter khác nhau, để test rule 'không truy cập chapter khác'), 4-5 Member rải ở 2 chapter, 1 Khách (không tài khoản).
- **Dữ liệu mẫu cần có:** Ít nhất: 1 course PUBLISHED+PUBLIC, 1 course PUBLISHED+PRIVATE, 1 course DRAFT, mỗi course có ≥2 session, mỗi session ≥2 lesson kèm video + tài liệu, 1 course có assessment gắn kèm.

## 5. Tiêu chí bắt đầu / kết thúc

- **Entry criteria:** Migration DB chạy thành công, seed data có sẵn, AI xác nhận đã tự chạy qua phần 'Test để tự kiểm tra' trong playbook và pass.
- **Exit criteria:** 100% test case Priority = High ở module đó Pass; không còn bug Severity = Critical/Major đang mở; các bug Minor được ghi nhận lại vào Sheet 'Bug Report' để xử lý sau, không chặn tiến độ.

## 6. Quy ước mức độ

- **Priority:** `High` = luồng chính + business rule cốt lõi; `Medium` = luồng phụ, validate input; `Low` = edge case hiếm gặp.
- **Severity:** `Critical` = sập hệ thống/mất dữ liệu/lộ quyền truy cập; `Major` = sai nghiệp vụ nhưng có workaround; `Minor` = sai lệch nhỏ không ảnh hưởng luồng chính; `Cosmetic` = UI/chính tả.
