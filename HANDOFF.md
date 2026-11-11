# Prompt 03 — Kế hoạch và bàn giao

## Worker 03b — phiên 11/11/2026 (trạng thái mới nhất)
- **Kết luận:** đã triển khai các sửa đổi được giao, nhưng **chưa đạt nghiệm thu toàn bộ** vì test hạ tầng cần subprocess bị sandbox chặn. Không commit được; toàn bộ 33 file còn trong working tree nhánh `feat/p03-vai-tro`.
- Thực hiện tuần tự 1–6, 8–11, 13 theo `docs/prompts/03b-sua-loi-review.md`; mục 7, 12 đã có trước, không sửa seed/baseline.
- [x] 1: tách `replaceChapterPlacements`, đóng position/membership ban hiện tại hoặc tương lai, zero-length cho hàng tương lai; không tạo position cho thành viên không ban. Giữ affiliation Chapter và CHAPTER_LEAD quản lý.
- Kiểm chứng mục 1: `node scripts/test/run-tests.cjs unit chapter-placement-replacement` PASS 1 test; `npx tsc --noEmit` PASS (exit 0).
- [x] 2: migration đóng rule trùng trước khi gộp position ID, ưu tiên rule thuộc tên chuẩn; giữ lịch sử và khóa unique. Ngoại lệ sửa đúng migration được mục 2 yêu cầu rõ ràng, không sửa migration khác.
- Kiểm chứng mục 2: static migration PASS 6 test (đã thấy regression fail trước sửa); `node scripts/test/test-p03-rule-merge.cjs` PASS trên DB `bbe_test_p03_*` từ TEMPLATE `bbe_test_head`, các scope NULL/non-NULL, TT + TRAINEE + DNA_MEMBER và rule đã đóng; DB thử đã xóa. `npx tsc --noEmit` PASS.
- Checkpoint: `git add`/`git commit` bị từ chối tạo index.lock ngoài writable root. Giữ working tree, không thử vượt sandbox hoặc lặp lại thao tác bị chặn.
- [x] 3: materialize lọc role MEMBER và nhóm học hiện hành (đúng target của rule), bỏ quản lý, người không chức vụ/nhóm hoặc inactive; eligibleUsers phản ánh số thật.
- Kiểm chứng mục 3: `node scripts/test/run-tests.cjs unit materialize-learning-rule` PASS 1 test, đã thấy fail trước sửa; `npx tsc --noEmit` PASS.
- [x] 4: `/login` xác minh phiên còn hợp lệ ở server trước khi redirect; server từ chối thì xóa accessToken/refreshToken/userRole và vào trang login. Refresh hợp lệ vẫn hoạt động; lỗi mạng không xóa phiên như bị thu hồi.
- Kiểm chứng mục 4: `node scripts/test/run-tests.cjs unit middleware-session` PASS 2 test (regression trước sửa 307 thay vì 200); `npx tsc --noEmit` PASS.
- [x] 5: bổ nhiệm PRESIDENT khóa đơn vị Chapter, kết thúc PRESIDENT hiện có/kế tiếp, giữ tư cách Chapter, tăng auth_version và enqueueAssignmentSync cho người bị thay; KHBB 2.3 ghi trạng thái Chapter không ban.
- Kiểm chứng mục 5: `node scripts/test/run-tests.cjs unit position-replacement` PASS 5 test, test PRESIDENT fail trước sửa; `npx tsc --noEmit` PASS.
- [x] 6: API/helper từ chối startsAt tương lai; helper luôn lấy thời điểm DB hiện tại, đóng membership tương lai kể cả cùng ban đích trước khi tạo hàng hiện tại; bỏ thông báo cho phép lên lịch.
- Kiểm chứng mục 6: position-replacement PASS 6 test (hai regression fail trước sửa); `npx tsc --noEmit` PASS.
- [x] 8: mời hàng loạt và Members dùng organizationUnitId của ban, bắt buộc chọn ban thuộc managed-units có quyền; chặn gửi khi chưa chọn, hiển thị lỗi tải danh sách/không có ban bằng tiếng Việt.
- Kiểm chứng mục 8: bulk-invite PASS 9 test (wiring regression fail trước sửa); `npx tsc --noEmit` PASS. Chưa kiểm tra browser thực tế vì môi trường worker không có app/phiên đăng nhập; không chạy dev server ngoài lệnh được cho phép.
- [x] 9: lọc lời mời Chapter theo affiliation của organization_unit (Chapter hoặc ban con), giữ lời mời legacy không unit; count dùng cùng điều kiện, không lấy Chapter khác/DNA.
- Kiểm chứng mục 9: invitation-list-scope PASS 2 test hành vi (fail trước sửa); `npx tsc --noEmit` PASS.
- [x] 10: helper canManageInvitationUnit dùng quyền theo loại đơn vị cho list/resend/cancel, giữ kiểm tra phạm vi của authorization hiện có.
- Kiểm chứng mục 10: invitation-management PASS 2 test, bao gồm 6 thao tác hợp lệ DNA/DNA_GROUP và 3 thao tác bị chặn cho Chapter LEAD; regression 403 trước sửa; `npx tsc --noEmit` PASS.
- [x] 11: BXH DNA lấy PositionAssignment DNA_MEMBER tại DNA_GROUP đang hiệu lực, loại TT và role khác MEMBER; membership DNA cha không thể đưa TT vào BXH. Không đổi phép cộng sao/thứ tự xếp hạng.
- Kiểm chứng mục 11: dna-leaderboard-scope PASS 1 test hành vi (đã tái hiện TT lọt qua hàng cha trước sửa); `npx tsc --noEmit` PASS.
- [x] 13: có test thuần cho thay PRESIDENT/membership tương lai, chuyển giao thay thế + thành viên không ban, helper/luồng mời DNA_GROUP. Regression migration có kịch bản PostgreSQL thật ở mục 2, không chỉ kiểm tra chuỗi SQL.
- Kiểm chứng mục 13: position-replacement PASS 8 test; member-invite-scope PASS 2; chapter-placement-replacement PASS 2; `npx tsc --noEmit` PASS sau mục 13.
- Ruling khi rà soát: route tạo chuyển giao cũng phải giữ hàng không ban/không position (trước đó ngầm đổi thành PRESIDENT). Chuẩn hóa chỉ các unit Chủ Tịch legacy, giữ nguyên no-ban; bổ sung test helper normalizeTransferPlacements.
- Review cuối: phát hiện thứ tự khóa PRESIDENT có thể deadlock; đã đổi helper và caller chapter-department-update sang Chapter → user, test lock-order fail trước sửa và PASS sau sửa (8/8). Reviewer đã xác nhận không còn Critical/Important trong lượt kiểm tra lại.
- Đồng thời sửa nhãn/lịch sử no-ban: GET phân biệt PRESIDENT và Chưa phân ban; lịch sử hiển thị danh sách thành viên không ban riêng. chapter-transfer-history PASS 1 test (đã thấy fail trước sửa), tsc PASS.
- Lần chạy toàn bộ unit đầu: 59 suite trước database-safety PASS; database-safety FAIL 2 test vì spawnSync node.exe EPERM của sandbox. Chạy riêng hai suite sau điểm dừng: load-tests safety PASS 8 test; profiler FAIL 1 test do subprocess không khởi chạy (status null). Không sửa guard/test hạ tầng hoặc tìm cách vượt sandbox.
- Kết quả cuối: `npx tsc --noEmit` PASS sau mỗi mục và trên mã cuối; `git diff --check` PASS. 11 suite liên quan PASS 36 test. Migration rehearsal trên PostgreSQL thử PASS; DB thử đã xóa.
- `npm run test:unit` lần cuối FAIL (exit 1): 60 suite đầu PASS, suite thứ 61 `scripts/test/database-safety.test.cjs` FAIL 2 test vì `spawnSync ... node.exe EPERM`. Runner dừng sớm; hai suite cuối đã chạy riêng: `node scripts/test/run-tests.cjs unit load-tests/tests/safety` PASS 8 test; `... unit load-tests/tests/profiler` FAIL 1 test vì subprocess có status null (không khởi chạy). Không khẳng định toàn bộ unit đã qua; người tiếp quản cần chạy các suite này ngoài sandbox phù hợp.
- Log cục bộ (git-ignored): `p03b-unit-final.log`, `p03b-unit-results.log`. Không sửa guard hay test hạ tầng để vượt lỗi môi trường.
- Review: một reviewer chỉ đọc xác nhận đã sửa Important deadlock và không còn Critical/Important khác; ghi chú nhãn lịch sử no-ban cũng đã sửa, có regression test PASS. Không còn mục sửa code đang làm dở.
- Chưa kiểm chứng: browser thực tế, bổ nhiệm đồng thời trên PostgreSQL, các suite tích hợp DB khác. Không chạy DB thật, không chạy migrate/db push/install/generate, không đổi nhánh/push/merge/seed/baseline/package/lockfile.
- Chỗ lệch/mở rộng: chỉ sửa đúng migration được mục 2 cho phép; bổ sung sửa route/history no-ban và khóa caller cùng thứ tự Chapter → user để hoàn chỉnh quyết định A/B. Không có câu hỏi nghiệp vụ mới.
- Quy trình: dùng HANDOFF này làm ledger theo yêu cầu người dùng, không tạo graph/plan mới hoặc worktree khác. Chưa chạy DB thật.

## Lịch sử prompt 03 (giữ để đối chiếu; trạng thái 03b ở đầu file)

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

## Vòng sửa theo review chéo Qoder (lịch sử; worker 03b đã triển khai ở trên)
Quyết định chủ sản phẩm: (A) mỗi Chapter 1 PRESIDENT; bổ nhiệm người mới thì PRESIDENT cũ kết thúc chức vụ và thành "thành viên Chapter không ban" (hợp lệ). (B) không lên lịch bổ nhiệm/đổi ban; chuyển giao THAY THẾ toàn bộ (đóng mọi hàng đang hiệu lực HOẶC có ngày bắt đầu/kết thúc tương lai); API bổ nhiệm luôn hiệu lực ngay.
- [x] 7. Route APPOINT_POSITION: precheck scope cho DNA_MEMBER dùng DNA_GROUP.
- [x] 12. `scripts/db/backfill-organization.ts`, `scripts/db/seed-rich-demo.ts`: mã `DEPARTMENT_MEMBER` thay `MEMBER` (seed-rich-demo vẫn tạo `leader.dna` với role MEMBER — nên là LEAD, chưa sửa).
- [x] 1. `chapter-reorganizations.ts`: chuyển giao đóng mọi hàng position/membership còn hiệu lực hoặc tương lai (zero-length cho hàng bắt đầu tương lai); chỉ tạo position cho item có ban hoặc position_id (người không ban = thành viên Chapter không ban).
- [x] 5. `position-replacement.ts`: bổ nhiệm PRESIDENT thì đóng PRESIDENT hiện tại của Chapter (lock + enqueueAssignmentSync cho người bị thay).
- [x] 6. cùng file: bỏ lịch tương lai (từ chối startsAt > now ở route và helper), đóng membership tương lai trùng ban đích.
- [x] 2. migration: đóng (effective_until = now) rule trùng trước khi đổi mã (`learning_rules_active_scope_key`), thử lại trên Postgres tạm.
- [x] 3. `admin/learning-rules/[ruleId]/materialize/route.ts`: bỏ qua ADMIN/LEAD.
- [x] 4. `middleware.ts`: phiên bị từ chối thì xóa cookie và cho vào /login.
- [x] 8. UI mời hàng loạt/Members: chọn ban. [x] 9. lọc danh sách lời mời theo organization_unit_id. [x] 10. quyền MANAGE_DNA_MEMBERS cho DNA LEAD ở `api/v1/invitations`. [x] 11. `dna-leaderboard`: xác định thành viên theo DNA_GROUP, cập nhật danh sách loại trừ.
- [x] 13. Đã thêm/chạy test hành vi thuần và kịch bản rule trùng trên Postgres thử; cổng toàn bộ unit còn vướng subprocess sandbox, xem trạng thái mới nhất ở đầu file.

## File worker 03b đã sửa hoặc thêm

Tài liệu/hạ tầng test:
- `HANDOFF.md`
- `docs/KHBB.md`
- `prisma/migrations/20261110_standardize_roles_positions/migration.sql` (ngoại lệ sửa đúng migration theo mục 2)
- `scripts/test/run-tests.cjs`
- `scripts/test/test-p03-rule-merge.cjs` (mới, chỉ DB thử cục bộ cố định)

Helper/middleware:
- `src/lib/chapter-placement-replacement.ts` (mới)
- `src/lib/chapter-department-update.ts`
- `src/lib/chapter-reorganizations.ts`
- `src/lib/invitation-management.ts` (mới)
- `src/lib/invitations.ts`
- `src/lib/position-replacement.ts`
- `src/middleware.ts`

API:
- `src/app/api/v1/admin/learning-rules/[ruleId]/materialize/route.ts`
- `src/app/api/v1/admin/organization/route.ts`
- `src/app/api/v1/chapters/[chapterId]/reorganizations/route.ts`
- `src/app/api/v1/invitations/route.ts`
- `src/app/api/v1/invitations/[id]/route.ts`
- `src/app/api/v1/invitations/[id]/resend/route.ts`
- `src/app/api/v1/organization/dna-leaderboard/route.ts`

Giao diện:
- `src/app/chapter-manager/invitations/page.tsx`
- `src/app/chapter-manager/members/page.tsx`
- `src/app/chapter-manager/term-transition/TransferHistory.tsx`

Unit test:
- `src/test/bulk-invite.test.ts`
- `src/test/position-replacement.test.ts`
- `src/test/standardize-migration.test.ts`
- `src/test/chapter-placement-replacement.test.ts` (mới)
- `src/test/chapter-transfer-history.test.ts` (mới)
- `src/test/dna-leaderboard-scope.test.ts` (mới)
- `src/test/invitation-list-scope.test.ts` (mới)
- `src/test/invitation-management.test.ts` (mới)
- `src/test/materialize-learning-rule.test.ts` (mới)
- `src/test/member-invite-scope.test.ts` (mới)
- `src/test/middleware-session.test.ts` (mới)
