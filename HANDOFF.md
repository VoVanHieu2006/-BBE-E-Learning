# HANDOFF — prompt 06 (triển khai từ DB trống)

Nhánh: `feat/p06-deploy`. DB thử: container `bbe-test-pg` (127.0.0.1:54329), chỉ database `bbe_test_*`.
DB do mình tạo: `bbe_test_cut_strict`, `bbe_test_cut_cur`, `bbe_test_cut_hist`, `bbe_test_cut`, `bbe_test_baseline_verify` (+ các DB tạo ở mục sau). Các DB `bbe_test_*` khác có sẵn từ trước: không đụng.

## Trạng thái
1. Cắt lại baseline: **xong** (`scripts/db/cut-baseline.mjs`, cặp `prisma/bootstrap/20261110_*` được ghi đè, README cập nhật)
2. Sửa seed: chưa
3. `npm run test:fresh-deploy`: chưa
4. Test tích hợp: chưa
5. Cập nhật docs (`operations.md`, `testing.md`): chưa (README bootstrap đã cập nhật ở mục 1)

## Lệnh đã chạy / kết quả
- Cut: `CUT_BASELINE_DATABASE_URL=<loopback bbe_test_cut> PG_DOCKER_CONTAINER=bbe-test-pg node scripts/db/cut-baseline.mjs` → 27 migration, 57 bảng. Lỗi được bỏ qua chỉ thuộc loại "already exists", bước dữ liệu trên temp table/nhãn enum cũ, LOCK TABLE ngoài transaction (log: `artifacts/baseline-cut/20261110-replay.log`).
- Kiểm tra trên `bbe_test_baseline_verify`: `npm run db:baseline-empty` OK → `prisma migrate deploy`: "No pending migrations to apply." → `migrate diff --from-url` chỉ còn 6 index chỉ có trong migration (assessments.course_id, chapters.name, invitations/password_reset_tokens/refresh_tokens.token_hash, videos.lesson_id).
- `npm run test:baseline-safety`: 9/9 pass (thêm 3 test cho cut-baseline). `npx tsc --noEmit`: sạch.

## Quyết định
- Giữ tên cặp `20261110` (bằng ngày migration mới nhất `20261110_standardize_roles_positions`); `baseline-empty-database.mjs` giờ đọc hằng `baselineName`, cut script tự cập nhật.
- Snapshot cũ (cắt theo README cũ) thiếu `final_exam_versions_one_active_per_assessment` (unique partial index) và check `reward_boundary_is_vietnam_half_year`: replay có lỗi được bỏ qua bên trong `BEGIN;…COMMIT;` làm rollback cả migration. Cut script bỏ BEGIN/COMMIT cấp cao nhất để từng câu chạy riêng.
- Thứ tự replay: `profile_quiz_configuration` sau `learning_governance`, `lead_binding_guards` sau `organization_integrity`. Đã xác minh: snapshot 20261012 cũ + các migration theo thứ tự này chạy **không lỗi** (ON_ERROR_STOP) → đây là thứ tự thật của production.
- Lịch sử từ DB trống hoàn toàn không replay được (thiếu bảng do `db push`, ví dụ `course_drafts` không có migration nào tạo) → vẫn cần prisma-first.
- Khác biệt đã biết so với lịch sử thật: default trong CREATE TABLE của migration (gen_random_uuid cho 3 bảng, clock_timestamp cho bound_at) theo schema.prisma (không default). Ghi ở README.

## Nghi ngờ / xung đột có thể
(chưa có)
