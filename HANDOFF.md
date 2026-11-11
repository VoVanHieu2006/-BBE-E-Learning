# HANDOFF — prompt 06 (triển khai từ DB trống)

Nhánh: `feat/p06-deploy`. DB thử: container `bbe-test-pg` (127.0.0.1:54329), chỉ database `bbe_test_*`.
DB do mình tạo: `bbe_test_cut_strict`, `bbe_test_cut_cur`, `bbe_test_cut_hist`, `bbe_test_cut`, `bbe_test_baseline_verify`, `bbe_test_seed`, `bbe_test_seed_demo`, `bbe_test_fresh_deploy_p06` (+ các DB tạo ở mục sau). Các DB `bbe_test_*` khác có sẵn từ trước: không đụng.

## Trạng thái
1. Cắt lại baseline: **xong** (`scripts/db/cut-baseline.mjs`, cặp `prisma/bootstrap/20261110_*` được ghi đè, README cập nhật)
2. Sửa seed: **xong** (`prisma/seed.ts`, `scripts/db/seed-demo-safe.ts`, `seed-rich-demo.ts`, `seed-rich-progress.ts`)
3. `npm run test:fresh-deploy`: **xong** (`scripts/test/test-fresh-deploy.mjs`, test guard `scripts/test/fresh-deploy-guard.test.mjs` gộp vào `test:baseline-safety`)
4. Test tích hợp: **xong** (đã chạy mọi suite chạy được; 1 FAIL do lỗi nghiệp vụ/bảo mật thật, 1 FAIL do test dựa dữ liệu production, 8 BLOCKED vì guard của suite; xem mục 4 bên dưới)
5. Cập nhật docs: **xong** (`docs/operations.md`: quy trình DB trống + diễn tập fresh-deploy + seed; `docs/testing.md`: lệnh fresh-deploy, bảng DB của từng suite, chuẩn bị DB/app/token/mùa, giới hạn Docker và BLOCKED/FAIL; `prisma/bootstrap/README.md`: mục "Full fresh deployment"; `docs/known-issues.md`: cập nhật 2 dòng đã xử lý ở prompt 03/06, thêm dòng "Email trên BXH kỳ"). `npx tsc --noEmit` sạch.

## Lệnh đã chạy / kết quả
- Cut: `CUT_BASELINE_DATABASE_URL=<loopback bbe_test_cut> PG_DOCKER_CONTAINER=bbe-test-pg node scripts/db/cut-baseline.mjs` → 27 migration, 57 bảng. Lỗi được bỏ qua chỉ thuộc loại "already exists", bước dữ liệu trên temp table/nhãn enum cũ, LOCK TABLE ngoài transaction (log: `artifacts/baseline-cut/20261110-replay.log`).
- Kiểm tra trên `bbe_test_baseline_verify`: `npm run db:baseline-empty` OK → `prisma migrate deploy`: "No pending migrations to apply." → `migrate diff --from-url` chỉ còn 6 index chỉ có trong migration (assessments.course_id, chapters.name, invitations/password_reset_tokens/refresh_tokens.token_hash, videos.lesson_id).
- `npm run test:baseline-safety`: 9/9 pass (thêm 3 test cho cut-baseline). `npx tsc --noEmit`: sạch.
- Mục 2 trên `bbe_test_seed` (baseline → deploy "No pending" → seed): `npx prisma db seed` OK 2 lần liên tiếp (lần 2 trên DB đã có dữ liệu). Đếm: users 18 (ADMIN 1, LEAD 4, MEMBER 13), chapters 3, organization_units 29 (21 ban có code), positions 6, position_assignments 17, chapter_lead_bindings 3, learning_programs 4, learning_targets 18, courses 10, lessons 23, assessments 5 (COURSE_FINAL), questions 15, attempts 11. Truy vấn kiểm: 0 user có >1 chức vụ, 0 user vừa Chapter vừa DNA, mọi LEAD có CHAPTER_LEAD/DNA_LEAD.
- `npm run db:seed-demo` trên DB trống `bbe_test_seed_demo` (2 lần) và trên DB đã seed: OK. `npm run db:seed-rich` (2 lần) + `npm run db:seed-rich-progress` trên `bbe_test_seed`: OK, sau đó vẫn 0 vi phạm các truy vấn kiểm trên.
- `npx tsc --noEmit`, `-p prisma/tsconfig.seed.json`, `-p scripts/tsconfig.json`: sạch.
- Mục 3: `TEST_DATABASE_URL=<loopback bbe_test_fresh_deploy_p06> npm run test:fresh-deploy` → exit 0, chạy 2 lần liên tiếp (lần 2 trên DB đã có dữ liệu). A: baseline 26s, deploy, seed; B: TRUNCATE (giữ `_prisma_migrations`), deploy, seed. Cả hai: 1 ADMIN, 17 user khác, 6 chức vụ, 4 chương trình/18 đối tượng, 5 version đề cuối khóa active, 0 vi phạm. Guard từ chối DB `postgres` và biến trống (exit 1). `test:baseline-safety` 11/11. `npx tsc --noEmit` sạch.

## Quyết định
- Giữ tên cặp `20261110` (bằng ngày migration mới nhất `20261110_standardize_roles_positions`); `baseline-empty-database.mjs` giờ đọc hằng `baselineName`, cut script tự cập nhật.
- Snapshot cũ (cắt theo README cũ) thiếu `final_exam_versions_one_active_per_assessment` (unique partial index) và check `reward_boundary_is_vietnam_half_year`: replay có lỗi được bỏ qua bên trong `BEGIN;…COMMIT;` làm rollback cả migration. Cut script bỏ BEGIN/COMMIT cấp cao nhất để từng câu chạy riêng.
- Thứ tự replay: `profile_quiz_configuration` sau `learning_governance`, `lead_binding_guards` sau `organization_integrity`. Đã xác minh: snapshot 20261012 cũ + các migration theo thứ tự này chạy **không lỗi** (ON_ERROR_STOP) → đây là thứ tự thật của production.
- Lịch sử từ DB trống hoàn toàn không replay được (thiếu bảng do `db push`, ví dụ `course_drafts` không có migration nào tạo) → vẫn cần prisma-first.
- Khác biệt đã biết so với lịch sử thật: default trong CREATE TABLE của migration (gen_random_uuid cho 3 bảng, clock_timestamp cho bound_at) theo schema.prisma (không default). Ghi ở README.

## Quyết định mục 2 (seed)
- `prisma/seed.ts`: xóa dữ liệu bằng TRUNCATE mọi bảng public trừ `_prisma_migrations` (trigger chặn DELETE `chapter_lead_bindings`; danh sách deleteMany cũ thiếu bảng mới). Tạo dữ liệu tham chiếu mà production có từ migration nhưng baseline không có: 6 chức vụ chuẩn (tên/is_manager như `20261110_standardize_roles_positions`), 4 chương trình + 18 đối tượng học từ `src/lib/learning-catalog.ts`, 7 ban chuẩn có code cho mỗi Chapter, nhóm DNA có code.
- Bố trí tài khoản theo trigger `assert_organization_integrity`: Lead Chapter = LEAD + CHAPTER_LEAD tại đơn vị Chapter (1 Lead/Chapter); Lead DNA = LEAD + DNA_LEAD tại đơn vị DNA, không thuộc Chapter; thành viên = 1 ban + DEPARTMENT_MEMBER/DEPARTMENT_LEAD tại đúng ban; Chủ tịch = PRESIDENT tại đơn vị Chapter (không còn ban "Chủ tịch"); thành viên DNA = DNA_MEMBER tại nhóm TT, không thuộc Chapter.
- Đổi dữ liệu demo: `phuong.hoa` từ LEAD (không chức vụ, trùng Chapter Hà Nội với `chapter.lead.demo`) thành Chủ tịch Chapter Hà Nội; lời mời/audit "INVITATION_CREATE" của bà chuyển sang `chapter.lead.demo`. `member.demo` chỉ còn 1 chức vụ (DEPARTMENT_MEMBER, ban BTV).
- Bài kiểm tra cuối khóa: `type: COURSE_FINAL` + 1 `final_exam_versions` active; câu hỏi và attempt gắn version (check `assessments_exactly_one_owner_check`). Bỏ `questions.duration_seconds`.
- `seed-demo-safe.ts`: không đổi role tài khoản đã có (trigger cấm MEMBER→LEAD), bỏ qua tài khoản đã có bố trí; chức vụ upsert không ghi đè tên; thêm `president.demo@bbe.vn` thay cho chức vụ thứ hai của `member.demo`; thêm catalog (skipDuplicates).
- `seed-rich-demo.ts`: Lead Chapter/Chủ tịch nằm ở đơn vị Chapter (không ở ban), `leader.dna` role LEAD tại đơn vị DNA, thành viên DNA có DNA_MEMBER; ban dùng code chuẩn. **Bỏ** kịch bản `member.to.dna` (membership DNA lùi ngày trong khi còn là thành viên Chapter → SingleOrganizationAffiliationRequired); người này vẫn ở Chapter Checkpoint.
- `seed-rich-progress.ts`: số bài của người DNA/LT cố định 50 → `coreLessons.length` (lỗi index khi lõi < 50 bài).

## Quyết định mục 3
- Kịch bản A tự làm trống DB đích bằng `DROP SCHEMA public CASCADE; CREATE SCHEMA public` (chỉ sau guard loopback + `bbe_test_*` + so `current_database()`), để lệnh chạy lại được. Không tạo/xóa database.
- Kiểm tra sau mỗi kịch bản: mọi thư mục trong `prisma/migrations` đã applied, không attempt lỗi, và các bất biến tổ chức như mục 2. Output con được che URL.

## Mục 4 — test tích hợp
Cách chạy: mỗi DB thử chuẩn bị bằng `TEST_DATABASE_URL=<loopback bbe_test_*> npm run test:fresh-deploy` (baseline + deploy + seed), app Next build một lần (`npx next build`, secret chỉ dùng cho test) rồi `next start` trên 127.0.0.1 cho suite cần app; mỗi suite chạy riêng `npm run test:integration -- <suite>` qua `artifacts/p06-run-with-app.sh` (log đã che URL: `artifacts/p06-it-*.log`). `npm run test:unit`: PASS 63 suite.

| Suite | DB | Kết quả |
|---|---|---|
| quiz-and-refresh | `bbe_test_it_quiz` | PASS 4/4 |
| admin-program | `bbe_test_it_admin_program` | PASS (sau khi sửa test) |
| test-learning-cycles-integration | `bbe_test_learning_cycles` | PASS (sau khi sửa test) |
| test-reward-pause-integration | `bbe_test_learning_cycles` | PASS |
| chapter-six-month | `bbe_test_learning_cycles` | FAIL 17/19: T18 cần Chapter tên "BBE Chapter 1/2", T19 cần email thật `vobahoaan@gmail.com` có 19 sao video → test dựa dữ liệu production, không đưa dữ liệu cá nhân thật vào seed |
| test-learning-security | `bbe_test_learning_cycles` + app :3112 | **FAIL** tại dòng 96: hàng bảng xếp hạng `/api/v1/leaderboard?group=MEMBER&periodType=MONTH` có `email` (lỗi bảo mật thật, xem dưới). Bản tạm bỏ đúng assertion đó: mọi assertion còn lại PASS |
| test-learning-flow-integration | `bbe_test_learning_flow` | BLOCKED: assert server-side `inet_server_addr()` ∈ {127.0.0.1, ::1, null}; Docker port-forward trả 172.17.0.2 |
| test-chapter-leaderboard-integration | `bbe_test_leaderboard` + app :3113 | BLOCKED: cùng assert loopback phía server |
| test-organization-integrity | — | BLOCKED: cần `ORGANIZATION_TEST_DATABASE_URL` tên `org_integrity*` (không phải `bbe_test_*`) |
| test-organization-repair | — | BLOCKED: cần `org_integrity_repair*` |
| chapter-transfer / completed-lessons / star-history | — | BLOCKED: guard đòi URL cố định user `chapter_fix_test`, `127.0.0.1:55439`, DB `bbe_test_learning_cycles` (container ở port khác) |
| test-fb-fixes | — | BLOCKED: cần `127.0.0.1:55438/fb_fixes_test`, kiểm cả `inet_server_addr` |

Không đổi host/tên DB/guard của suite nào để lách.

Sửa test (lỗi hạ tầng test do schema/quy tắc mới, không đổi nghiệp vụ):
- `src/test/admin-program-and-lead-dept.test.ts`: bước "bỏ ban" giờ kỳ vọng `MemberPositionRequired` (p03: `chapter-department-update.ts:13`, mỗi người giữ đúng 1 chức vụ, đổi là thay thế) và chức vụ hiện tại giữ nguyên.
- `scripts/test/test-learning-cycles-integration.cjs`: cycle đầu tiên của người có progress chưa gắn cycle là `LEGACY` (quy tắc p04 f4fbc95, `learning-periods.ts:57-59`), không theo tuổi tài khoản.
- `scripts/test/test-learning-security.mjs`: JWT mang `authVersion` (p03 `session-role.ts`, thiếu → 401); tự tạo mùa chuyển giao cho nửa năm hiện tại (mùa là dữ liệu Admin, trước đây test ăn ké mùa do suite khác để lại → batch kẹt SCHEDULED với last_error "Chưa có mùa chuyển giao…"); dọn `chapter_lead_bindings` bằng `session_replication_role=replica` trong transaction như `test-fb-fixes.cjs` (trigger `immutable_lead_binding` chặn xóa và che lỗi thật); in `last_error` khi batch không APPLIED; xóa mùa đã tạo.

Lỗi nghiệp vụ thật (chưa sửa, cần quyết định):
- `src/lib/period-leaderboard.ts:310-314` (`hydrateRanking`) thêm `email` vào mỗi hàng bảng xếp hạng kỳ cho mọi người đã đăng nhập (chỉ khách bị xóa). `UnifiedLeaderboard.tsx:783,802` hiển thị email đó. Thêm ở commit 0e41c4a ("feat: update learning experience and leaderboard rules") trong khi `test-learning-security.mjs` (từ b4095fd) yêu cầu không có email. Một MEMBER thấy email của mọi thành viên khác. Vì UI dùng có chủ đích nên đây là xung đột yêu cầu, không tự gỡ; đề xuất: bỏ `email` khỏi hàng (UI đã fallback `displayName`, nhận diện "bạn" bằng `userId`).

DB: tạo thêm `bbe_test_it_admin_program`, `bbe_test_it_quiz`, `bbe_test_it_six_month`, `bbe_test_learning_flow`, `bbe_test_leaderboard`. `bbe_test_learning_cycles` có sẵn nhưng trống (0 bảng); dùng vì 4 suite đòi đúng tên này, đã trả về trống (`DROP SCHEMA public CASCADE; CREATE SCHEMA public`). Không còn tiến trình app nào chạy.

## Nghi ngờ / xung đột có thể
- `test-learning-flow-integration.mjs`: `issueAccessToken` cũng thiếu `authVersion` và phần dọn xóa `chapterLeadBinding` → nhiều khả năng FAIL khi chạy được guard (chưa xác minh).
- `chapter-six-month` T18/T19 phụ thuộc dữ liệu production, không thể pass trên DB trống.
