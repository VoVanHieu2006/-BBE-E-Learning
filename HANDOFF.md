# HANDOFF — prompt 06 (triển khai từ DB trống)

Nhánh: `feat/p06-deploy`. DB thử: container `bbe-test-pg` (127.0.0.1:54329), chỉ database `bbe_test_*`.
DB do mình tạo: `bbe_test_cut_strict`, `bbe_test_cut_cur`, `bbe_test_cut_hist`, `bbe_test_cut`, `bbe_test_baseline_verify`, `bbe_test_seed`, `bbe_test_seed_demo` (+ các DB tạo ở mục sau). Các DB `bbe_test_*` khác có sẵn từ trước: không đụng.

## Trạng thái
1. Cắt lại baseline: **xong** (`scripts/db/cut-baseline.mjs`, cặp `prisma/bootstrap/20261110_*` được ghi đè, README cập nhật)
2. Sửa seed: **xong** (`prisma/seed.ts`, `scripts/db/seed-demo-safe.ts`, `seed-rich-demo.ts`, `seed-rich-progress.ts`)
3. `npm run test:fresh-deploy`: chưa
4. Test tích hợp: chưa
5. Cập nhật docs (`operations.md`, `testing.md`): chưa (README bootstrap đã cập nhật ở mục 1)

## Lệnh đã chạy / kết quả
- Cut: `CUT_BASELINE_DATABASE_URL=<loopback bbe_test_cut> PG_DOCKER_CONTAINER=bbe-test-pg node scripts/db/cut-baseline.mjs` → 27 migration, 57 bảng. Lỗi được bỏ qua chỉ thuộc loại "already exists", bước dữ liệu trên temp table/nhãn enum cũ, LOCK TABLE ngoài transaction (log: `artifacts/baseline-cut/20261110-replay.log`).
- Kiểm tra trên `bbe_test_baseline_verify`: `npm run db:baseline-empty` OK → `prisma migrate deploy`: "No pending migrations to apply." → `migrate diff --from-url` chỉ còn 6 index chỉ có trong migration (assessments.course_id, chapters.name, invitations/password_reset_tokens/refresh_tokens.token_hash, videos.lesson_id).
- `npm run test:baseline-safety`: 9/9 pass (thêm 3 test cho cut-baseline). `npx tsc --noEmit`: sạch.
- Mục 2 trên `bbe_test_seed` (baseline → deploy "No pending" → seed): `npx prisma db seed` OK 2 lần liên tiếp (lần 2 trên DB đã có dữ liệu). Đếm: users 18 (ADMIN 1, LEAD 4, MEMBER 13), chapters 3, organization_units 29 (21 ban có code), positions 6, position_assignments 17, chapter_lead_bindings 3, learning_programs 4, learning_targets 18, courses 10, lessons 23, assessments 5 (COURSE_FINAL), questions 15, attempts 11. Truy vấn kiểm: 0 user có >1 chức vụ, 0 user vừa Chapter vừa DNA, mọi LEAD có CHAPTER_LEAD/DNA_LEAD.
- `npm run db:seed-demo` trên DB trống `bbe_test_seed_demo` (2 lần) và trên DB đã seed: OK. `npm run db:seed-rich` (2 lần) + `npm run db:seed-rich-progress` trên `bbe_test_seed`: OK, sau đó vẫn 0 vi phạm các truy vấn kiểm trên.
- `npx tsc --noEmit`, `-p prisma/tsconfig.seed.json`, `-p scripts/tsconfig.json`: sạch.

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

## Nghi ngờ / xung đột có thể
(chưa có)
