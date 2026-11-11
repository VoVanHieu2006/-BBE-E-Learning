# Vận hành và triển khai

Runbook không có nghĩa các bước đã thực hiện trên production. Release1 bỏ phụ thuộc cấu hình kích hoạt cũ; giữ nguyên dữ liệu, quyền, migration history và snapshot.

## Cấu hình

`.env.example` chỉ có placeholder. Secrets thật thuộc local/deployment; không ghi token, connection URL có mật khẩu hoặc fixture private vào Git/log/tài liệu.

| Nhóm | Biến / mục đích |
|---|---|
| Database | `DATABASE_URL`, `DIRECT_URL`: runtime/pool và kết nối Prisma trực tiếp |
| Auth | `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `TOKEN_HASH_PEPPER`, secrets riêng đủ mạnh |
| URL/email | URL ứng dụng và sender/Resend theo `.env.example`/mã gửi mail |
| Cover | `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_FOLDER` |
| Documents | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_PUBLIC_URL` |
| Video/quiz | YouTube metadata key nếu dùng; `NEXT_PUBLIC_QUIZ_COOLDOWN_MINUTES` theo phút, mặc định code 2; NEXT_PUBLIC đóng vào client build |
| Worker | `CRON_SECRET`, `LEARNING_CRON_BASE_URL`, tùy chọn trong `scripts/learning-scheduler.mjs` |

Kiểm tra `.env.example` và `process.env` tại revision deploy cho danh sách đầy đủ. Không dùng secrets production cho test. Thiếu email/storage chưa nghiệm thu các dịch vụ đó; build không chứng minh kết nối ngoài.

## Database và release

- SQL migration và `migration_lock.toml` bất biến, đối chiếu checksum trước/sau. Không sửa migration đã applied để che lỗi replay.
- **DB mới, trống:** theo [bootstrap](../prisma/bootstrap/README.md): `npm run db:baseline-empty` → `prisma migrate deploy` (phải báo không còn migration chờ, trừ migration thêm sau baseline) → nếu là môi trường demo/thử: `prisma db seed`. Snapshot/manifest là cặp baseline, cắt lại bằng `scripts/db/cut-baseline.mjs` mỗi khi thêm migration. `BASELINE_DATABASE_URL`/`BASELINE_CONFIRM_DATABASE` xác nhận đích riêng; remote chỉ khi explicit guard và đã xác minh DB mới/rỗng.
- **Diễn tập triển khai từ DB trống:** `TEST_DATABASE_URL=<loopback bbe_test_*> npm run test:fresh-deploy`. Kịch bản A làm trống schema `public` của DB đích rồi baseline → deploy → seed; kịch bản B xóa dữ liệu (giữ `_prisma_migrations`) rồi deploy → seed. Sau mỗi kịch bản kiểm mọi migration đã applied, không attempt lỗi, có Admin/chức vụ/chương trình/khóa học, mỗi người đúng một chức vụ, không ai vừa thuộc Chapter vừa DNA, mọi LEAD có chức vụ Lead. Guard chỉ nhận loopback + tên `bbe_test_*` + so `current_database()`; không tạo/xóa database, che URL trong output.
- **DB có dữ liệu:** backup, kiểm tra history/`prisma migrate status`, dùng forward migrations với `prisma migrate deploy` qua quy trình release. Không bootstrap để “sửa” DB populated.
- Không push/reset/seed production. Seed chính (`prisma db seed`) TRUNCATE mọi bảng trừ `_prisma_migrations` rồi tạo dữ liệu tham chiếu (6 chức vụ chuẩn, chương trình/đối tượng học từ `src/lib/learning-catalog.ts`, 7 ban chuẩn mỗi Chapter) cùng tài khoản demo theo trigger tổ chức; dữ liệu tham chiếu này production có từ migration, baseline không có. Seed demo (`db:seed-demo`, `db:seed-rich`, `db:seed-rich-progress`) chạy lặp được, không đổi role tài khoản đã có, ghi ledger/progress mô phỏng. `db:migrate` dành development, `db:generate` chỉ sinh client.
- `load-tests/init-db.mjs` dùng baseline/forward migration trên loopback load-test DB hợp lệ, không thay bằng reset/push accept-data-loss.

Trước release:

1. Cố định revision, kiểm kê app writers/scheduler và maintenance window, xem schema compatibility/locks.
2. `pg_dump -Fc`, bảo vệ backup như dữ liệu nhạy cảm. Restore vào DB riêng bằng `pg_restore --exit-on-error`; so user/progress/assignment/attempt counts, ledger totals, mẫu deadline/timestamp. Rehearsal synthetic không thay backup production rehearsal.
3. Xem mọi SQL chưa áp, aliases/guards và history đích. Không giả định oldest migrations dựng được DB trống.
4. Chạy [testing](testing.md), phân biệt PASS/FAIL/BLOCKED/NOT VERIFIED.
5. Deploy revision hiểu schema; kiểm tra cả dữ liệu legacy đọc được, manual/auto submit, permissions và cron auth.

### Prompt04 — triển khai hai release

- **Release1:** forward migration `prisma/migrations/20261110_learning_affiliation_without_policy/migration.sql` chỉ `CREATE OR REPLACE FUNCTION enforce_single_learning_affiliation()` để bỏ điều kiện đọc `learning_policy`; giữ phần kiểm tra còn lại, không đổi role/quy tắc affiliation, không drop bảng. Bảng `learning_policy` và model `LearningPolicy` chỉ giữ cho rollback; runtime và hàm DB không còn đọc chúng.
- **Trước deploy release1:** audit read-only `affiliationConflicts` và kiểm kê `learning_paths` có `imported_due_at IS NOT NULL` nhưng chưa có `learning_path_changes`. Xung đột affiliation phải được duyệt/xử lý trước khi triển khai hàm không điều kiện; không sửa dữ liệu tự động. Sao lưu riêng kết quả `SELECT * FROM learning_policy;` bên cạnh full backup/restore rehearsal, giữ bản sao ngoài Git như dữ liệu nhạy cảm.
- **Contract release1:** trang chính `/admin/learning-config`, API `/api/v1/admin/learning-config`; `/admin/learning-policy` chuyển hướng và `/api/v1/admin/learning-policy` là alias tương thích trong release1. GET giữ `programs, targets, courses, pending, failed, seasons`, bỏ `policy`; readiness cơ sở trả `READY` cùng `asOf`, không có `policy`; API periods vẫn bổ sung trạng thái theo cấu hình tháng/nhiệm kỳ/mùa. PUT giữ catalog/mapping/seasons/normalization/outbox, quyền và validation cũ; không có bước bật policy. Nghiệm thu đường mới lẫn alias với các quyền hiện có.
- **Release2 chưa áp dụng:** SQL drop chỉ chuẩn bị tại `prisma/release-2/20261110_drop_learning_policy/migration.sql`, **ngoài** `prisma/migrations` nên không thuộc `prisma migrate deploy`. Chỉ chạy riêng khi release1 ổn định và release2 được duyệt sau; phải xác nhận không còn reader cũ trong app, worker, trigger/function, audit/load-test hay deployment cũ. Sao lưu riêng `SELECT * FROM learning_policy;` trước drop. Dùng `DROP TABLE learning_policy;`, **không `CASCADE`**; phụ thuộc còn sót là lý do dừng, không cưỡng ép xóa.
- **Schema/client release2:** giữ model `LearningPolicy` trong release1; chỉ bỏ model và sinh lại Prisma client khi release2 được duyệt sau. Giữ mọi trường provenance và `imported_due_at`. Sau drop, muốn khôi phục code cũ phải restore bảng (schema và dữ liệu) trước, không chỉ rollback app; restore đồng bộ DB/app theo backup đã rehearsal.

## Mapping và mùa chuyển giao

1. Admin `/admin/learning-config`: duyệt nội dung thật mọi published course và bốn chương trình. `artifacts/learning/mapping-audit.json`/`mapping-proposals.md` chỉ là đề xuất; tái tạo bằng `db:audit-learning-mapping`, không tự apply.
2. Chuẩn hóa code/Ban chỉ khi rõ ràng. Trùng/mơ hồ phải quyết định chủ động, không đoán theo tên; giữ compatibility history.
3. `/admin/courses/mandatory`: kiểm tra 18 target và mọi legacy rule ngoài target chuẩn. Một ngân sách ngày chung mỗi khóa; không âm thầm bỏ rule.
4. Alias `CHAPTER_MANAGER` đã được migration `20261110_standardize_roles_positions` gộp vào `CHAPTER_LEAD` (Lead Chapter, không phải President — President là vị trí riêng, thuộc LT và vẫn nhận sao); kiểm tra binding và affiliation. Migration dừng nếu dữ liệu có người giữ hai chức vụ/hai ban hoặc chức vụ sai role: xử lý các trường hợp đó trước khi triển khai. Readiness cơ sở release1 là `READY`/`asOf`; lý do thiếu kỳ không thay audit cấu hình/evidence hoặc quyền.
5. Cấu hình season không chồng lấn: `code`, `startsAt`, `endsAt`, `rewardBoundaryAt`; boundary 00:00 ngày 01/04 hoặc 01/10 UTC+7 và nằm trong season. Season phải phủ đúng **cửa sổ chuyển giao**: `01/01–30/06` (mốc `01/04`) và `01/07–31/12` (mốc `01/10`) — mọi thời điểm chuyển giao chuẩn hóa về mốc gần nhất, và mỗi cửa sổ chỉ được chuyển giao 1 lần. Applied season bất biến; season đang được batch `SCHEDULED` tham chiếu cũng không sửa; API chỉ cho sửa season tương lai/chưa dùng.
6. Duyệt content/history, Chapter→DNA và release gates. Cấu hình mapping/season có hiệu lực ngay khi lưu và scheduler áp dụng theo thời gian thực.

Người chưa có cycle nhận `NATIVE` bắt đầu từ `now`; nhập video progress, `imported_due_at` và giữ đường đọc/read-only lộ trình lịch sử như trước. Cycle `LEGACY` đã có vẫn đọc attempt `learning_cycle_id IS NULL`; không tự nhập attempt null cũ vào cycle `NATIVE` mới. Giữ các trường provenance; không phân bổ lại ledger, reset progress hoặc cấp lại reward budget để làm đẹp mapping. Ngoại lệ nhiệm kỳ đầu theo [business-rules](business-rules.md), không dùng runbook cũ ép pause.

Tháng runtime là `[00:00 đầu tháng, 00:00 đầu tháng kế tiếp)` UTC+7; không sửa ranh giới các month rows/snapshots đã có. Mùa xếp hạng DNA dùng `[season.reward_boundary_at, dnaSeasonEnd(season.reward_boundary_at))`, không có mốc cấu hình làm sàn. Với mùa đã kết thúc: không có `star_ledger` `provenance = NATIVE` trong cửa sổ **và không có đúng** snapshot `ranking:DNA:<season.id>` thì lịch sử không khả dụng, không dựng snapshot ngược. Có `NATIVE` và chưa có snapshot thì scheduler được phép chốt. Snapshot đã có giữ nguyên kể cả không có `NATIVE`; không dựng lại hoặc thay bằng snapshot loại/key khác.

## Scheduler

`npm run learning:scheduler` chạy dưới supervisor với explicit `LEARNING_CRON_BASE_URL`/`CRON_SECRET`, HTTPS ngoài loopback. Đọc tùy chọn interval/timeouts trong entrypoint; không chạy thêm worker không kiểm kê.

Worker gọi apply/learning, auto-submit và deadline endpoints mỗi phút, log expected/actual time/lag. Internal apply yêu cầu Bearer cron secret; auto-submit/deadline còn nhận cron header hoặc Admin theo handler. Internal GET có thể ghi; không dùng làm health probe. Vercel daily fallback không thay cadence phút.

Theo dõi batch SCHEDULED quá hạn/FAILED, planned/actual applied time; outbox pending/attempts/last_error/available_at; KPI/snapshot missing; inactive retirement; lỗi mail/storage/API. Không log token/body nhạy cảm. Không xóa outbox/batch để bỏ lỗi; retry sync không reset lại. Worker trễ dùng DB time sau lock, không backdate.

## Phục hồi

Mô hình deadline chung luôn chạy; rollback app phải giữ revision hiểu schema và đọc được cả dữ liệu legacy lẫn dữ liệu mới. Repair forward hoặc restore đồng bộ DB/app từ backup đã rehearsal. Không chạy reward writer cũ trên data mới.

Đóng tháng đóng băng facts kể cả thiếu KPI; bổ sung qua API chỉ điền KPI, không mở lại reward budget/snapshot. Tombstone không reactivate thông thường. Audit metadata vẫn cần chọn môi trường có chủ đích. Repair data cần dry-run/plan/matching guard và dữ liệu cụ thể đã duyệt; không dùng cleanup tổng quát.

## Output và process

Output ở `artifacts/{audits,learning,migrations,load-tests}`, Git bỏ qua. Giữ private fixture manifest nhận diện cohort đã tạo, không seed lại mỗi run. Object storage prefix `docs/` cho tài liệu bài học giữ nguyên.

Chỉ dọn cache/log/browser output sau khi process dùng đã dừng. Không xóa cả `scratch/`: có thể có PostgreSQL test/data directory đang chạy. Xác minh PID hiện tại, không dựa PID trong báo cáo cũ. Xóa `.next/` thì build lại trước `npm start`.
