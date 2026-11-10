# Prompt 06 — Triển khai từ DB trống chạy sạch (baseline, seed, test tích hợp)

Đọc `docs/prompts/00-quy-tac-chung.md` và `docs/prompts/00b-worker-ngoai.md` (các điểm sau **thay thế** quy tắc cấm DB: bạn ĐƯỢC dùng PostgreSQL thử bên dưới). **Chỉ làm sau khi prompt 03 đã gộp.**

## Bối cảnh và quyết định
Chủ sản phẩm: dữ liệu học tập hiện có không quan trọng và sẽ bị xóa; điều bắt buộc là **sau khi xóa dữ liệu và triển khai lại thì không lỗi**, kể cả dựng DB hoàn toàn mới. Đã phát hiện: lịch sử migration không replay được trên DB trống (migration `20261013_profile_quiz_configuration` sửa bảng do `20261014_learning_governance` tạo; `20261025_lead_binding_guards` vá hàm do `20261025_organization_integrity` tạo), baseline cũ dừng ở `20261013`. Đã cắt baseline mới `prisma/bootstrap/20261110_schema.sql` + manifest (xem `prisma/bootstrap/README.md` mục "Re-cutting the baseline"); `prisma/seed.ts` còn lỗi biên dịch (`duration_seconds` đã bị gỡ ở `20261017_remove_question_duration_seconds`) và có thể vi phạm ràng buộc một chức vụ.

## DB thử (có sẵn, chỉ dùng cho test)
Container Docker `bbe-test-pg` (postgres 16) lắng nghe `127.0.0.1:54329`, user `postgres`, mật khẩu `bbe_local_test_only`. Nếu container tắt: `docker start bbe-test-pg`. Tạo database riêng cho mỗi lần thử bằng `docker exec bbe-test-pg psql -U postgres -c "CREATE DATABASE bbe_test_<ten>;"` (chỉ tên `bbe_test_*`, loopback). Không bao giờ nhắm vào DB nào khác. Test tích hợp dùng `TEST_DATABASE_URL` (xem `scripts/test/require-test-database.cjs`).

## Việc cần làm
1. **Cắt lại baseline** sau các migration mới của prompt 03/04 (theo README). Kiểm tra: DB mới trống → `npm run db:baseline-empty` (với `BASELINE_DATABASE_URL` và `BASELINE_CONFIRM_DATABASE`) → `npx prisma migrate deploy` báo "No pending migrations" → `prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma` chỉ có chênh lệch đã biết (index chỉ có trong migration). Đóng gói thành script `scripts/db/cut-baseline.mjs` hoặc hướng dẫn chạy lại được, cập nhật đường dẫn trong `scripts/db/baseline-empty-database.mjs`.
2. **Sửa `prisma/seed.ts`** để chạy được trên DB trống ở schema hiện tại (và `scripts/db/seed-*.ts` nếu cùng lỗi): bỏ trường đã gỡ, tuân thủ ràng buộc một chức vụ / không vừa Chapter vừa DNA / role `LEAD`. Chạy `npx prisma db seed` trên DB mới và kiểm tra bằng truy vấn đếm.
3. **Test "xóa dữ liệu rồi triển khai"**: trên DB đã có dữ liệu seed, xóa toàn bộ dữ liệu (TRUNCATE các bảng dữ liệu, giữ schema và `_prisma_migrations`), chạy `prisma migrate deploy` (phải không lỗi) và seed lại (phải không lỗi). Thêm một lệnh `npm run test:fresh-deploy` (script an toàn: chỉ nhận `TEST_DATABASE_URL` loopback `bbe_test_*`) chạy cả hai kịch bản: DB trống hoàn toàn và DB đã xóa dữ liệu.
4. **Chạy các test tích hợp** đang bị bỏ qua vì thiếu DB (`npm run test:integration`, từng suite riêng theo `docs/testing.md`; xem guard ở đầu mỗi suite) trên DB thử đã baseline + seed phù hợp, sửa lỗi hạ tầng test nếu do schema/seed, và **báo cáo từng suite pass/fail thật**. Lỗi nghiệp vụ thật thì ghi lại kèm bằng chứng, đừng che.
5. Cập nhật `docs/operations.md`, `docs/testing.md`, `prisma/bootstrap/README.md`.

## Không được đụng tới
Logic nghiệp vụ (trừ khi test tích hợp chứng minh lỗi và sửa tối thiểu), migration cũ (chỉ thêm mới nếu thật cần), dữ liệu của DB nào ngoài `bbe_test_*` trong container `bbe-test-pg`.
