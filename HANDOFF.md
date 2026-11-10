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
3. [x] **Một chức vụ, thay thế (prompt 5):** các nhánh ADD_MEMBERSHIP, ADD_MEMBER, APPOINT_POSITION và luồng chuyển ban/DNA; kết thúc membership/position cũ trong cùng transaction, giữ lịch sử, bảo vệ lead binding. Test chuyển đổi và từ chối bổ nhiệm sai role.
4. [x] **Quản lý không học (prompt 6):** `learning-assignments.ts`, target/roster và enforce; ADMIN/LEAD không tạo nghĩa vụ, đóng nghĩa vụ hiện có và gỡ riêng khóa quá hạn/restriction DEADLINE. Test có nhiều lý do khóa để không mở nhầm khóa khác.
5. [x] **Migration một bản (prompt 1–6, thay bản 2):** thêm migration đổi enum, backfill DNA lead, tăng auth_version; gộp position/FK/permission; đổi target/rule/BDHU; cập nhật function/trigger và ràng buộc nhiều chức vụ/ban. Không xóa dữ liệu học, không chạy DB. Test tĩnh SQL và kiểm tra các FK/trigger liên quan; ghi rõ chưa nghiệm thu DB.
6. [x] **Tài liệu và kiểm chứng cuối:** KHBB mục 9 dòng 1–4, KHBB-ky-thuat, business-rules, CKNK; hướng dẫn triển khai một bản; rg tên cũ đúng phạm vi, toàn bộ unit, tsc, diff-check; rà soát cuối và hoàn thiện bàn giao đúng mẫu.

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
- Migration `20261110_standardize_roles_positions` đã được chạy thử trên Postgres 16 tạm (docker, đã xóa) nạp từ `prisma/bootstrap/20261110_schema.sql` + dữ liệu mẫu dùng tên cũ: rỗng và có dữ liệu đều chạy được; kiểm tra gộp chức vụ/permission/rule, đổi 18 target, BDH→BDHU, role LEAD, đóng nghĩa vụ + gỡ khóa DEADLINE của quản lý, và các ràng buộc mới (MEMBER→LEAD, hai chức vụ, hai ban, Chapter+DNA bị chặn). Chưa chạy trên DB thật/production, chưa chạy các test tích hợp DB (`scripts/test/test-*.cjs|mjs`).
- Migration dừng và hoàn tác nếu dữ liệu có người giữ hai chức vụ/hai ban hoặc chức vụ sai role (cố ý: không tự chọn thay người dùng). Dữ liệu seed cũ cấp hai vị trí cùng lúc sẽ gặp lỗi này; người dùng xóa dữ liệu trước khi triển khai.
- Các danh sách loại trừ trong mã vẫn có mã `TT`/`TRAINEE` (vô hại, mã đã gộp vào `DNA_MEMBER`; nhóm DNA TT vẫn bị loại BXH theo mã đơn vị).
- Prompt 06 phải cắt lại snapshot/manifest baseline sau migration này.

## Ghi chú của Claude (tiếp quản sau khi Codex hết hạn mức)
- Codex đã làm xong cả mục 1–5 và phần lớn mục 6 trong commit WIP; checkbox cũ chưa được tick.
- Sửa lỗi phát hiện khi rà soát: (1) chữ Việt bị hỏng thành dấu `?` trong 8 file (migration, UI, thông báo lỗi) — đã khôi phục; (2) migration: `END $;` thiếu `$` và `status` mơ hồ trong UPDATE user_learning_assignments — đã sửa, kiểm chứng trên DB tạm; (3) `learning-cycles.test.ts` thiếu `user` trong DB giả — đã thêm.
- Thêm `src/test/standardize-migration.test.ts` (kiểm tra tĩnh SQL, đăng ký trong `scripts/test/run-tests.cjs`).
- Tài liệu đã cập nhật: KHBB mục 9 dòng 1–4, KHBB-ky-thuat (bảng tên + thứ tự triển khai), business-rules, CKNK, api.md, operations.md, known-issues.md.

## Vòng sửa theo review chéo Qoder (chưa xong — hết hạn mức)
Quyết định chủ sản phẩm: (A) mỗi Chapter 1 PRESIDENT; bổ nhiệm người mới thì PRESIDENT cũ kết thúc chức vụ và thành "thành viên Chapter không ban" (hợp lệ). (B) không lên lịch bổ nhiệm/đổi ban; chuyển giao THAY THẾ toàn bộ (đóng mọi hàng đang hiệu lực HOẶC có ngày bắt đầu/kết thúc tương lai); API bổ nhiệm luôn hiệu lực ngay.
- [x] 7. Route APPOINT_POSITION: precheck scope cho DNA_MEMBER dùng DNA_GROUP.
- [x] 12. `scripts/db/backfill-organization.ts`, `scripts/db/seed-rich-demo.ts`: mã `DEPARTMENT_MEMBER` thay `MEMBER` (seed-rich-demo vẫn tạo `leader.dna` với role MEMBER — nên là LEAD, chưa sửa).
- [ ] 1. `chapter-reorganizations.ts`: chuyển giao đóng mọi hàng position/membership còn hiệu lực hoặc tương lai (zero-length cho hàng bắt đầu tương lai); chỉ tạo position cho item có ban hoặc position_id (người không ban = thành viên Chapter không ban).
- [ ] 5. `position-replacement.ts`: bổ nhiệm PRESIDENT thì đóng PRESIDENT hiện tại của Chapter (lock + enqueueAssignmentSync cho người bị thay).
- [ ] 6. cùng file: bỏ lịch tương lai (từ chối startsAt > now ở route và helper), đóng membership tương lai trùng ban đích.
- [ ] 2. migration: đóng (effective_until = now) rule trùng trước khi đổi mã (`learning_rules_active_scope_key`), thử lại trên Postgres tạm.
- [ ] 3. `admin/learning-rules/[ruleId]/materialize/route.ts`: bỏ qua ADMIN/LEAD.
- [ ] 4. `middleware.ts`: phiên bị từ chối thì xóa cookie và cho vào /login.
- [ ] 8. UI mời hàng loạt/Members: chọn ban. [ ] 9. lọc danh sách lời mời theo organization_unit_id. [ ] 10. quyền MANAGE_DNA_MEMBERS cho DNA LEAD ở `api/v1/invitations`. [ ] 11. `dna-leaderboard`: xác định thành viên theo DNA_GROUP, cập nhật danh sách loại trừ.
- [ ] 13. test hành vi thuần (position-replacement thay PRESIDENT/membership tương lai, chuyển giao thay thế, scope DNA_GROUP) và test kịch bản rule trùng.
