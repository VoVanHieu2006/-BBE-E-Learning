# Prompt 03 — Kế hoạch và bàn giao

**Nhánh:** `feat/p03-vai-tro`; worktree `p03`.
**Đặc tả:** `docs/prompts/03-vai-tro-va-ten-goi.md` (quyết định 10/11/2026), `docs/KHBB.md` mục 2–3, 9; bảng tên đầu `docs/KHBB-ky-thuat.md`.
**Cách thực hiện:** tuần tự trong worktree hiện tại; dùng writing-plans/executing-plans và verification-before-completion. Người dùng đã yêu cầu thực hiện toàn bộ, không thêm vòng duyệt kế hoạch.
**Kiến trúc:** đổi trực tiếp role/position/target sang tên chuẩn; dùng helper role chung, chức vụ quyết định nơi quản lý. Tất cả thay đổi tổ chức thay thế trong transaction và có ràng buộc DB bảo vệ.

## Giới hạn
- Không DB thật, không lấy `.env`, không chạy migration/db push/install, không sửa migration cũ, package/lockfile.
- Chỉ `prisma generate` được ngoại lệ sau đổi schema; node_modules riêng.
- Không baseline/bootstrap manifest hoặc sửa seed chạy trên DB trống (prompt 06). Chỉ chuẩn hóa tên trong seed/script/fixture.
- Không đổi công thức hạn, khóa mật khẩu, nhãn Mới, learning_policy hoặc công thức BXH.
- Commit checkpoint nếu sandbox cho phép; nếu bị chặn giữ working tree, không tìm cách vượt sandbox.

## Kế hoạch trước khi sửa
Sau **mỗi mục**: chạy `npx tsc --noEmit`, test liên quan, ghi kết quả thực tế ở dưới và thử checkpoint khi phù hợp.

1. [x] **Role và tên chuẩn (prompt 1,3,4):** schema enum; helper `isLeadRole`; đổi các kiểm tra role, mã chức vụ/ban/18 target trong `src`, `prisma/seed.ts`, `scripts`, `load-tests`. Loại alias cũ và giá trị MEMBER dùng cho chức vụ. Generate Prisma; test business-rules và role/target mới.
2. [x] **LEAD invitation và phiên đăng nhập (prompt 2):** `invitations.ts`, auth/login/refresh/middleware/layout; DNA lead role LEAD, phân tuyến theo chức vụ; chặn MEMBER → LEAD ở gửi/nhận lời mời và bổ nhiệm. Token có auth_version; tên role cũ không được tiếp tục dùng. Test role/routing/invitation.
3. [ ] **Một chức vụ, thay thế (prompt 5):** các nhánh ADD_MEMBERSHIP, ADD_MEMBER, APPOINT_POSITION và luồng chuyển ban/DNA; kết thúc membership/position cũ trong cùng transaction, giữ lịch sử, bảo vệ lead binding. Test chuyển đổi và từ chối bổ nhiệm sai role.
4. [ ] **Quản lý không học (prompt 6):** `learning-assignments.ts`, target/roster và enforce; ADMIN/LEAD không tạo nghĩa vụ, đóng nghĩa vụ hiện có và gỡ riêng khóa quá hạn/restriction DEADLINE. Test có nhiều lý do khóa để không mở nhầm khóa khác.
5. [ ] **Migration một bản (prompt 1–6, thay bản 2):** thêm migration đổi enum, backfill DNA lead, tăng auth_version; gộp position/FK/permission; đổi target/rule/BDHU; cập nhật function/trigger và ràng buộc nhiều chức vụ/ban. Không xóa dữ liệu học, không chạy DB. Test tĩnh SQL và kiểm tra các FK/trigger liên quan; ghi rõ chưa nghiệm thu DB.
6. [ ] **Tài liệu và kiểm chứng cuối:** KHBB mục 9 dòng 1–4, KHBB-ky-thuat, business-rules, CKNK; hướng dẫn triển khai một bản; rg tên cũ đúng phạm vi, toàn bộ unit, tsc, diff-check; rà soát cuối và hoàn thiện bàn giao đúng mẫu.

## Điểm kiểm tra trọng yếu
- DNA lead không bị đưa nhầm vào Chapter; JWT refresh giữ loại quản lý và phiên bị thu hồi không sống lại.
- MEMBER không được nâng thành LEAD qua bất kỳ nhánh mời/bổ nhiệm nào.
- Hai tên position cùng tồn tại: gộp không vi phạm unique permission/FK; target trùng phải xử lý rõ.
- Thay chức vụ kể cả cùng/khác ban và Chapter ↔ DNA không giữ tư cách hoạt động cũ.
- Dọn khóa quá hạn của quản lý vẫn giữ khóa mật khẩu/thủ công/vô hiệu hóa.

## Tiến độ và kiểm chứng
- Ban đầu: working tree sạch; đúng nhánh `feat/p03-vai-tro`; chưa chạy DB hoặc sửa code.
- Đã đọc quy tắc chung/worker ngoài/prompt 03 và chuẩn nghiệp vụ. Không có graphify-out; dùng tìm kiếm mục tiêu theo quy tắc repo, không tạo graph mới.
- Đang làm: mục 1, khảo sát các chỗ đổi tên và test liên quan.

## Xung đột có thể
- Các file auth, invitations, organization, learning-assignments, test/business-rules và tài liệu có thể cùng được worker prompt khác sửa. Chỉ sửa phần role/chức vụ/target/quy tắc một chức vụ, không sửa công thức.
- Prompt 06 phải cập nhật bootstrap snapshot/manifest sau migration mới và nghiệm thu seed/DB trống.

## Rủi ro / chưa kiểm chứng
- Không có DB test; migration và integration DB chỉ đọc/viết, chưa thực thi.
- Commit chưa thử; sẽ ghi rõ nếu sandbox chặn git metadata ở ngoài worktree.

- M?c 4 ho?n t?t: reconcile ki?m tra role tr??c khi t?o cycle, ??ng assignment/supplement/h?n, ch? g? DEADLINE v? m? OVERDUE_LOCK khi kh?ng c?n restriction kh?c. Targets theo m?t position. tsc PASS, manager-learning-exemption 5/5, deadline-enforcement 8/8.
- Ph?t hi?n v? kh?i ph?c fixture array tr?ng b? ??i nh?m t? l?n ??i t?n ban ??u (bulk-invite, deadline-enforcement, test-fb-fixes, monthly-reward-reset, test-p05-assets).
