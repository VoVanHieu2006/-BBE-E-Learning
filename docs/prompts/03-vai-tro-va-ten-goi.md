# Prompt 03 — Vai trò, chức vụ và tên nhóm học (có migration, rủi ro cao)

Đọc `docs/prompts/00-quy-tac-chung.md` trước. **Chỉ làm sau khi prompt 01 và 02 đã xong và được duyệt.** Nhánh gợi ý: `feat/chuan-hoa-vai-tro`. **Bắt đầu ở chế độ Plan** (chỉ đọc), trình kế hoạch chi tiết rồi mới sửa.

## CẬP NHẬT QUYẾT ĐỊNH (10/11/2026) — thay thế các điểm mâu thuẫn bên dưới
Chủ sản phẩm xác nhận: **dữ liệu học tập hiện có trên DB (chapter, học viên, tiến độ, bảng xếp hạng) không quan trọng và sẽ bị xóa trước khi triển khai.** Điều bắt buộc là: **sau khi xóa dữ liệu và triển khai lại thì không được lỗi.** Hệ quả:
- **Bỏ mô hình "hai bản phát hành" và việc chấp nhận song song tên cũ và mới.** Đổi tên trực tiếp trong một bản; token/cookie cũ mang `CHAPTER_LEADER` cho phép mất hiệu lực (buộc đăng nhập lại, tăng `auth_version`).
- **Bỏ Bước 0 khảo sát dữ liệu production.** Thay bằng kiểm tra triển khai trên DB trống (xem nghiệm thu).
- Vẫn viết migration đúng và an toàn cho DB đã có schema (đổi enum, gộp mã chức vụ, đổi `learning_targets.code`/`learning_rules.target_code`/`organization_units.code`), nhưng **không cần bảo toàn dữ liệu học tập**; không tự thêm lệnh xóa dữ liệu vào migration (người dùng tự xóa).
- Cập nhật `prisma/seed.ts`, `prisma/bootstrap/*` (snapshot schema và manifest nếu cần), `scripts/db/*`, `load-tests/fixtures/*` để dùng tên mới. Seed phải chạy được trên DB trống.
- **Nghiệm thu bổ sung:** (a) `rg "CHAPTER_LEADER|CHAPTER_MANAGER|DEPARTMENT_LEADER|CHAPTER_PRESIDENT|MEMBER_BTV|LEADER_BTV|BDH\b"` trong `src`, `prisma/seed.ts`, `scripts`, `load-tests` chỉ còn trong migration cũ và tài liệu lịch sử; (b) migration mới phải hợp lệ khi áp dụng lên DB đã có schema hiện tại (không cần chạy được ở đây). **Việc cắt lại baseline DB trống, sửa seed chạy được và kiểm tra triển khai từ DB trống thuộc prompt 06, KHÔNG làm ở prompt này** (chỉ đổi tên trong `prisma/seed.ts` nếu có, không cố làm seed chạy).

## Mục tiêu
Chuẩn hóa tên theo `docs/KHBB.md` mục 2-3 và bảng đối chiếu ở đầu `docs/KHBB-ky-thuat.md`, và các dòng 1, 2, 3, 4 của bảng mục 9. Đây là thay đổi lớn nhất: dữ liệu production đang dùng tên cũ, nên phải đổi **theo hai bản phát hành** (chấp nhận cả tên cũ và mới, rồi mới chuyển dữ liệu).

## Quy tắc nghiệp vụ cần đạt
- Role: `ADMIN`, `LEAD`, `MEMBER`. `LEAD` có hai chức vụ `CHAPTER_LEAD`, `DNA_LEAD`. ADMIN và LEAD không học: không được gán khóa bắt buộc, không bị khóa quá hạn, không tính vào học tập.
- Không có đường nào đổi `MEMBER` thành `LEAD` (hiện `APPOINT_POSITION` trong `admin/organization/route.ts` và `sendDnaLeaderInvitation` trong `src/lib/invitations.ts` cho phép; chặn lại, LEAD chỉ được tạo qua lời mời LEAD).
- Chức vụ của MEMBER: `PRESIDENT`, `DEPARTMENT_LEAD`, `DEPARTMENT_MEMBER`, `DNA_MEMBER` (thuộc nhóm DNA TT/SGDC/LDC).
- **Một người đúng một chức vụ tại một thời điểm**: không hai ban, không vừa Chapter vừa DNA. Đổi là thay thế.
- 18 nhóm học: `DEPARTMENT_MEMBER_<ban>`, `DEPARTMENT_LEAD_<ban>`, `PRESIDENT`, `DNA_MEMBER_<TT|SGDC|LDC>` với bảy ban `BTV, BTK, BND, BCL, BDHU, BKM, BTTSK` (mã ban Định Hướng đổi `BDH` → `BDHU`).

## Bước 0 — Khảo sát dữ liệu thật (bắt buộc, làm trước, báo cáo rồi DỪNG chờ người dùng duyệt)
Không chạy gì lên DB production. Viết truy vấn **chỉ đọc** (script trong `scripts/audit/` theo mẫu `audit-organization-integrity.mjs`) và chạy trên DB local/test nếu có; nếu không có DB để chạy, đưa truy vấn cho người dùng tự chạy và dừng. Cần biết:
1. Các giá trị `positions.code` đang có và số `position_assignments` mỗi mã (đặc biệt `CHAPTER_LEAD` và `CHAPTER_MANAGER`, `DEPARTMENT_LEAD` và `DEPARTMENT_LEADER`, `PRESIDENT` và `CHAPTER_PRESIDENT`, `MEMBER`, `TRAINEE`, `TT`).
2. Số `learning_rules` có `target_code` khác null, nhóm theo mã (kể cả rule đã đóng).
3. Số người có hơn một membership ban đang hiệu lực, hoặc nhiều chức vụ đang hiệu lực.
4. Số người role `CHAPTER_LEADER`, số người giữ `DNA_LEAD`, và số người giữ cả chức vụ lead lẫn role `MEMBER`.
5. Các `organization_units.code` của ban và của nhóm DNA (`BDH` có đang tồn tại không).
6. Số `user_learning_assignments` và khóa quá hạn đang mở của người sẽ thành LEAD.
Báo cáo kết quả và kế hoạch migration chi tiết; **dừng chờ duyệt** trước khi viết migration.

## Việc cần làm (sau khi được duyệt)

### Bản phát hành 1 — chấp nhận cả hai tên
1. **Role `CHAPTER_LEADER` → `LEAD`**: migration mới đổi enum `user_role` và `invitation_role` (`ALTER TYPE ... RENAME VALUE`), **định nghĩa lại `assert_organization_integrity`** (so sánh `actor_role = 'CHAPTER_LEADER'` ở `20261025_organization_integrity` dòng ~105 và đoạn vá bằng `pg_get_functiondef` ở `20261025_lead_binding_guards`) và các trigger/hàm khác nhắc tới chuỗi này (`record_learning_account_state` sao chép `role::text` vào `account_state_intervals.role`; cập nhật giá trị cũ nếu cần). Sửa code (~68 file: middleware, layout, login, các route có kiểm tra role, `chapter-lead.ts`, `manager-learning-access.ts`, `user-status-rules.ts`, `member-invite-scope.ts`, `active-chapters.ts`, seed, test, script): dùng một hằng số/hàm kiểm tra role dùng chung (ví dụ `isLeadRole`) thay vì rải chuỗi. **JWT và cookie `userRole` đang lưu giá trị cũ**: trong bản này mọi nơi đọc role phải chấp nhận cả `CHAPTER_LEADER` và `LEAD` (chuẩn hóa về `LEAD` khi đọc) để phiên đang đăng nhập không hỏng.
2. **DNA lead thành role `LEAD`**: backfill role cho người giữ `DNA_LEAD`; đổi `sendDnaLeaderInvitation`/chấp nhận lời mời (`src/lib/invitations.ts`) tạo role `LEAD`; định tuyến dựa vào kết hợp role + chức vụ (middleware chỉ đọc cookie role, nên cần thêm tín hiệu như `managerKind` vào JWT/cookie, hoặc quyết định đích đến sau đăng nhập). Chapter lead đi `/chapter-manager`, DNA lead đi `/organization-manager`.
3. **Gộp mã chức vụ** (migration dữ liệu có kiểm soát vì `positions.code` unique): `CHAPTER_MANAGER` → `CHAPTER_LEAD`, `DEPARTMENT_LEADER` → `DEPARTMENT_LEAD`, `CHAPTER_PRESIDENT` → `PRESIDENT`, thành viên ban `MEMBER` → `DEPARTMENT_MEMBER`. Khi cả mã cũ và mới cùng tồn tại: chuyển `position_assignments`/`position_permissions` sang bản ghi mới rồi xóa bản ghi cũ trong cùng transaction. Cập nhật mọi danh sách loại trừ/alias trong code (`chapter-members.ts`, `competition-ranking-rules.ts`, `competition-snapshots.ts`, `learning-targets.ts`, `learning-periods.ts`, `current-roster`, leaderboard routes) và hàm plpgsql hard-code `'CHAPTER_LEAD','CHAPTER_MANAGER'` (`20261025_organization_integrity` dòng ~26/60/112/119, `20261025_lead_binding_guards` dòng ~43). Sửa `MEMBER` dùng làm "không có chức vụ" trong `mandatory-matrix/route.ts`.
4. **Nhóm học**: ở bản này code **chấp nhận cả tên cũ lẫn mới** khi đọc (`learningTargetsForUser`, `LEARNING_TARGETS` trong `src/lib/learning-catalog.ts`, ma trận, `learning-policy` route), nhưng chuyển ghi sang tên mới. Chuẩn hóa `BDH` → `BDHU` ở `organization_units.code` và `chapter-departments.ts`, `learning-catalog.ts`, trang `admin/courses/mandatory`.
5. **Ràng buộc DB một chức vụ**: mở rộng `assert_organization_integrity` để từ chối hai membership ban đang hiệu lực và nhiều chức vụ đang hiệu lực của cùng một người; sửa `ADD_MEMBERSHIP`, `ADD_MEMBER`, `APPOINT_POSITION` thành "thay thế" (kết thúc cái cũ trong cùng transaction, theo mẫu `chapter-department-update.ts`). Sửa `prisma/seed.ts` đang cấp hai vị trí cùng lúc (và sai ràng buộc Chapter+DNA).
6. **LEAD/ADMIN không học**: `reconcileAssignments` không tạo assignment cho role `LEAD`/`ADMIN`; kết thúc assignment hiện có; gỡ `OVERDUE_LOCK`/restriction `DEADLINE` còn mở của họ. Cron `enforce` đã bỏ qua LEAD từ prompt 01; hoàn thiện cho role mới.

### Bản phát hành 2 — chuyển dữ liệu rồi bỏ tên cũ
Migration thứ hai (chỉ viết, chưa cần chạy): `UPDATE` `learning_targets.code` và `learning_rules.target_code` sang tên mới (không có khóa ngoại, đổi trực tiếp), cập nhật `learning_targets.position_code`; sau đó bỏ nhánh "chấp nhận tên cũ" trong code. Ghi rõ thứ tự triển khai: code bản 1 → chạy migration → kiểm tra → code bản 2. Cảnh báo trong báo cáo: nếu code mới đi trước dữ liệu thì `reconcileAssignments` sẽ kết thúc oan các assignment (hậu quả đã ghi ở `docs/KHBB-ky-thuat.md`).

### Tài liệu và test
- Cập nhật `docs/KHBB.md` mục 9 (đánh dấu dòng 1-4 đã xong), `docs/KHBB-ky-thuat.md` (bỏ bảng đối chiếu tên khi bản 2 xong), `docs/business-rules.md`, `docs/CKNK.md`.
- Test: `src/test/business-rules.test.ts` (đang khẳng định 18 target cũ: 7 `MEMBER_`, 7 `LEADER_`, `CHAPTER_PRESIDENT`, 3 `DNA_`), `scripts/test/rehearse-learning-migration.mjs` (khẳng định đúng 18 dòng `learning_targets`), `scripts/audit/audit-mandatory-learning.mjs`, test cho `isLeadRole`, chấp nhận cả hai tên role, và kịch bản migration (chạy trên DB test trống nếu có).

## Nghiệm thu
Các dòng 1, 2, 3, 4 của bảng mục 9 trong `docs/KHBB.md` đúng với code; phiên đăng nhập cũ (token mang `CHAPTER_LEADER`) vẫn hoạt động ở bản 1; liệt kê rõ trình tự triển khai và rủi ro.

## Không được đụng tới
Công thức hạn và khóa tài khoản (prompt 01), cập nhật khóa/nhãn Mới (prompt 02), `learning_policy` (prompt 04), mọi migration cũ (chỉ thêm migration mới), dữ liệu production.
