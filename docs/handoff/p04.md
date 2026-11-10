# HANDOFF — Prompt 04: cấu hình học tập

## Worker sửa lỗi reviewer chéo (10/11/2026) — đã sửa, kiểm chứng một phần
- Phạm vi: khởi tạo chu kỳ dựa trên dữ liệu học cũ (LEGACY/NATIVE), giữ hoàn thành khi reconcile đầu tiên; kiểm tra snapshot/bằng chứng NATIVE trước khóa user khi chốt mùa DNA.
- Đã xác nhận nhánh `chore/p04-go-cutover`, working tree sạch lúc bắt đầu; giữ thay đổi trong working tree, không commit/push.
- (1) Đã tái hiện test đỏ: khóa cũ về ASSIGNED; sửa khởi tạo LEGACY khi có attempt null, lesson_progress hoặc assignment null. Chỉ người không có bằng chứng cũ mới NATIVE; starts_at vẫn now, progress nhập cùng provenance, hạn nhập giữ nguyên. Import assignment chỉ nhận hàng null cycle, không lấy hàng chu kỳ khác.
- (2) Đã tái hiện test đỏ với danh sách user không rỗng: scheduler khóa user trước kiểm tra. Đã đưa snapshot/NATIVE lên trước vòng khóa; kiểm tra snapshot lần nữa sau khóa để tránh dựng trùng nếu scheduler khác chốt trong lúc chờ. Có test cho tình huống này.
- Đã xác nhận test hồi quy đỏ trước sửa, xanh sau sửa. Trên cây mã cuối, learning-cycles PASS 48/48, monthly-reward-reset PASS 21/21 trong lần chạy toàn bộ (gồm test snapshot được chốt khi chờ khóa).
- `npx tsc --noEmit`: PASS, exit 0. `git diff --check`: PASS.
- `npm run test:unit`: FAIL, exit 1; 37 suite đầu PASS rồi dừng ở `scripts/test/database-safety.test.cjs` (2/2 test FAIL do `spawnSync C:\nvm4w\nodejs\node.exe EPERM`, không tạo được tiến trình con trong sandbox).
- Đã chạy riêng hai suite sau điểm dừng: `npm run test:unit -- safety.test.mjs` PASS 8/8; `npm run test:unit -- profiler.test.mjs` FAIL 0/1, tiến trình con trả status null thay vì 0. Không sửa runner/guard để né lỗi môi trường, không khẳng định toàn bộ unit PASS.
- Log lần chạy toàn bộ: `artifacts/p04-review-fixes-unit.log` (file bị git ignore). Cần người dùng chạy lại toàn bộ unit ở môi trường cho phép spawn tiến trình con. Không chạy DB/integration vì phạm vi chỉ cho phép offline, không có DB test/env.
- File thay đổi trong lượt này: `src/lib/learning-periods.ts`, `src/lib/learning-assignments.ts`, `src/lib/competition-snapshots.ts`, `src/test/learning-cycles.test.ts`, `src/test/monthly-reward-reset.test.ts`, `HANDOFF.md`. Không commit/push, không đổi schema/quyền/công thức nghiệp vụ.
- Lưu ý: phần kiểm tra/checkpoint bên dưới là lịch sử lượt trước, không phải kết quả nghiệm thu lượt sửa này. Chu kỳ NATIVE đã tồn tại không bị tự đổi provenance; yêu cầu hiện tại chỉ sửa người chưa có chu kỳ.

## Phạm vi và an toàn
- Worktree `p04`, nhánh `chore/p04-go-cutover`; không push/merge/rebase/đổi nhánh.
- Prompt 04 chạy TRƯỚC prompt 03, không chờ đổi role/nhóm. Không cần mốc production, không dùng MODEL_START.
- Bản 1 giữ bảng/model LearningPolicy; bản 2 chỉ viết SQL ngoài tập migration deploy bản 1, chưa áp dụng.
- Không DB thật, không tìm `.env`, không install/generate/migrate/db push; không đổi package/lockfile, migration cũ, công thức hạn, provenance hoặc imported_due_at.
- Đầu session có thay đổi của người dùng ở `docs/prompts/04-go-cutover-va-learning-policy.md`; giữ nguyên, không đưa vào checkpoint của worker.

## Trạng thái cuối và checkpoint
- Đã đọc lại HANDOFF cũ, quy tắc chung/worker ngoài, prompt 04 cập nhật và các phần KHBB/CKNK/tài liệu kỹ thuật liên quan.
- Bước 0: giữ truy vấn chỉ đọc bên dưới cho người dùng; chưa chạy DB, không chặn việc viết bản 1 vì thiếu audit.
- Bản 1 mục 2: đã thêm `prisma/migrations/20261110_learning_affiliation_without_policy/migration.sql`, chỉ CREATE OR REPLACE FUNCTION và bỏ câu policy gate; phần còn lại giữ nguyên bản trên nhánh. Chưa áp dụng.
- Bản 1 mục 3: bỏ mọi đọc policy trong src; tháng mới theo đầu tháng tự nhiên UTC+7, không sửa hàng tháng đã tồn tại. Chu kỳ thiếu chọn LEGACY theo dữ liệu học không gắn chu kỳ, NATIVE nếu hoàn toàn mới, bắt đầu now; nhập video và bằng chứng đường học cũ như trước. Bỏ hàm awardStars không dùng và trường importedDueAt trong response, không bỏ cột.
- Bản 1 mục 4: route/trang chuẩn `learning-config`; API cũ alias GET/PUT cùng handler, trang cũ redirect. GET không còn policy; giữ cấu hình chương trình, nhóm, mapping, mùa, chuẩn hóa tổ chức, outbox và quyền ADMIN.
- Bản 1 mục 5: hoàn tất test unit tháng, khởi tạo NATIVE, chu kỳ LEGACY/null attempts, hạn/tiến độ nhập, mùa DNA cũ/NATIVE/snapshot chốt, API GET/PUT/alias/quyền và đối chiếu migration. Đã dọn/review script audit, test tích hợp, remediation và load-test; rehearsal giữ guard loopback, kiểm tra hàm/trigger/lịch sử và có --release-2 opt-in sao lưu trước drop. Chưa chạy các script cần DB.
- Bản 1 mục 6: đã cập nhật/review 11 tài liệu hiện có về cấu hình, dữ liệu lịch sử và triển khai hai bản. Không sửa prompt gốc.
- Bản 2: đã viết `prisma/release-2/20261110_drop_learning_policy/migration.sql`, DROP không CASCADE; không đưa vào `prisma/migrations`, không bỏ model trong schema bản 1.

## Ngữ nghĩa dữ liệu đã chọn
- Tháng tự nhiên theo giờ Việt Nam. Upsert month vẫn update rỗng: không sửa tháng lịch sử/snapshot hoặc backfill sao.
- Mùa DNA: starts_at = reward_boundary_at; ends_at = dnaSeasonEnd, cửa sổ nửa mở `[starts_at, ends_at)`.
- Mùa DNA đã kết thúc mà không có dòng star_ledger NATIVE trong cửa sổ và chưa có snapshot `ranking:DNA:<season.id>` thì không được dựng snapshot ngược; API báo PERIOD_UNAVAILABLE/HISTORICAL_SEASON_UNAVAILABLE.
- Có bằng chứng NATIVE thì scheduler dựng bình thường; API trước khi chốt báo AWAITING_SNAPSHOT. Bằng chứng chỉ yêu cầu dòng NATIVE trong cửa sổ, không lọc lượng sao, tư cách hiện tại hay chỉ riêng DNA.
- Snapshot đã lưu luôn được ưu tiên trả về, scheduler không dựng lại dù NATIVE hiện không còn; không đổi snapshot đã chốt.
- Chu kỳ LEGACY có sẵn giữ nguyên nhánh attempt null trước starts_at trong currentCycleAttemptFilter, lesson-learning-state, video-heartbeat, quiz-submission, learning-assignments. learning_cycles/star_ledger/cycle_lesson_progress.provenance vẫn còn.
- Người chưa có chu kỳ có attempt null, lesson_progress hoặc assignment null nhận LEGACY tại now; nhánh LEGACY nhận attempt cũ trước starts_at và nhập assignment null như trước. Người hoàn toàn mới nhận NATIVE tại now. Không dùng cutover/ngày tạo tài khoản, không quét/backfill người đang ngủ, không sửa chu kỳ đã có.

## Bước 0 — truy vấn production để người dùng tự chạy
Không truy vấn nào dưới đây được chạy trong session. Dùng tài khoản chỉ đọc đã ủy quyền; lưu kết quả/backup ở nơi bảo mật, không commit DB/connection string/email/token. Timestamp không timezone được hiểu UTC như trigger hiện có.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SELECT now() AS audited_at;
WITH active AS (
  SELECT m.user_id, u.type
  FROM organization_memberships m JOIN organization_units u ON u.id = m.unit_id
  WHERE m.status = 'ACTIVE' AND m.starts_at <= timezone('UTC', now())
    AND (m.ends_at IS NULL OR m.ends_at > timezone('UTC', now()))
), dna AS (
  SELECT DISTINCT user_id FROM active WHERE type IN ('DNA', 'DNA_GROUP')
), conflicts AS (
  SELECT d.user_id,
    EXISTS (SELECT 1 FROM chapter_members c WHERE c.user_id = d.user_id) AS legacy_chapter,
    (SELECT count(*) FROM active a WHERE a.user_id = d.user_id AND a.type IN ('CHAPTER', 'DEPARTMENT')) AS chapter_memberships
  FROM dna d
  WHERE EXISTS (SELECT 1 FROM chapter_members c WHERE c.user_id = d.user_id)
    OR EXISTS (SELECT 1 FROM active a WHERE a.user_id = d.user_id AND a.type IN ('CHAPTER', 'DEPARTMENT'))
)
SELECT md5(user_id::text) AS user_ref, legacy_chapter, chapter_memberships,
       count(*) OVER () AS affiliation_conflicts
FROM conflicts ORDER BY user_ref;
SELECT * FROM learning_policy ORDER BY id;
WITH bounds AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AT TIME ZONE 'Asia/Ho_Chi_Minh' AS natural_month_start
)
SELECT p.id, p.cutover_at, p.mapping_approved_at, b.natural_month_start,
       p.cutover_at < b.natural_month_start AS earlier_than_current_month,
       p.cutover_at <= now() AND p.mapping_approved_at IS NOT NULL AS old_policy_gate_enabled
FROM learning_policy p CROSS JOIN bounds b ORDER BY p.id;
SELECT count(*) AS imported_paths,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM learning_path_changes c WHERE c.path_id = p.id
       )) AS imported_paths_without_changes
FROM learning_paths p WHERE p.imported_due_at IS NOT NULL;
SELECT m.key, m.starts_at, m.ends_at, m.state,
       date_trunc('month', m.starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AT TIME ZONE 'Asia/Ho_Chi_Minh' AS natural_month_start
FROM competition_months m
WHERE m.starts_at <> (date_trunc('month', m.starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')
                     AT TIME ZONE 'Asia/Ho_Chi_Minh')
ORDER BY m.starts_at;
SELECT pg_get_functiondef(p.oid) AS installed_affiliation_function
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = current_schema() AND p.proname = 'enforce_single_learning_affiliation';
SELECT c.relname AS table_name, t.tgname, t.tgenabled, t.tgdeferrable, t.tginitdeferred
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = current_schema() AND NOT t.tgisinternal
  AND t.tgname IN ('single_affiliation_membership', 'single_affiliation_chapter')
ORDER BY c.relname, t.tgname;
ROLLBACK;
```

### Cách đọc kết quả trước triển khai
- Có affiliationConflicts: dừng triển khai, người dùng quyết tư cách đúng/thời điểm hiệu lực; worker không sửa dữ liệu hay lịch sử sao.
- Không có conflicts chỉ là kết quả tại lúc audit, không bao quát membership lên lịch tương lai; cần xem thêm nếu có.
- SELECT policy chỉ phục vụ backup/đối chiếu gate cũ và ảnh hưởng tháng; KHÔNG lấy ngày đó làm hằng số trong code và không cần gửi giá trị để tiếp tục.
- Nếu earlier_than_current_month false/null, duyệt ảnh hưởng dùng đầu tháng tự nhiên trước deploy. Giữ các hàng tháng cũ.
- Giữ imported_paths_without_changes: hạn nhập vẫn làm sàn reconcile đầu; không xóa cột/backfill.
- Đối chiếu hàm/trigger production với migration hiện có; trigger hoãn có thể phát lỗi tại commit. Prompt 03 sẽ bổ sung ràng buộc sau khi tích hợp, không phải prerequisite.

## Kế hoạch hai bản — chưa triển khai
### Bản 1
1. Người dùng tự audit Bước 0, giải quyết xung đột nếu có, duyệt ảnh hưởng tài khoản chưa có chu kỳ và tháng cũ.
2. Diễn tập migration/test tích hợp trên DB test riêng đúng guard; chưa chạy trong session.
3. Deploy migration hàm + code learning-config; giữ bảng/model cho rollback và instance cũ. Không chạy SQL ở prisma/release-2.
4. Theo dõi ghi membership/Chapter (kể cả lỗi commit), scheduler DNA/tháng, NATIVE/LEGACY, mapping/mùa/normalize/outbox, alias cũ. Không backfill sao/snapshot.
### Bản 2 — chỉ chuẩn bị
1. Khi mọi instance/job/script không còn đọc bảng và bản 1 được duyệt ổn định, backup SELECT * FROM learning_policy và kiểm tra dependency ở DB riêng.
2. Đưa SQL đã chuẩn bị ở prisma/release-2 thành migration deploy riêng theo quy trình người dùng; không CASCADE.
3. Bỏ model LearningPolicy khỏi schema và generate chỉ ở bản 2; không thực hiện ở worktree bản 1.
4. Diễn tập script rehearsal với --release-2 trên DB loopback đúng guard trước áp dụng; chưa chạy.
5. Sau drop, rollback code cũ cần khôi phục bảng/backup, không chỉ rollback binary. Không bỏ bất kỳ provenance nào.

## Kiểm tra tại checkpoint
- `npx tsc --noEmit`: PASS, exit 0 sau toàn bộ thay đổi runtime, route, test, script và tài liệu.
- `npm run test:unit`: PASS, exit 0, 40 suite trên cây mã cuối. Lần chạy đầu lỗi mock delegate động của Prisma; đã sửa mock module trong test, không sửa runtime để né lỗi, và chạy lại toàn bộ thành công.
- Test riêng `npm run test:unit -- learning-cycles`: PASS, 42 test; `npm run test:unit -- monthly-reward-reset`: PASS, 20 test. Các test này thuộc lần chạy toàn bộ cuối.
- `git diff --check`: PASS. Grep src cho learning_policy/learningPolicy/cutover/MODEL_START: không còn khớp; load-test cũng không còn phụ thuộc policy.
- Script tích hợp/rehearsal đã được đọc/review nhưng chưa thực thi; không lấy syntax check hoặc mock làm nghiệm thu DB.
- Không integration/audit/rehearsal/browser: không có DB/app test hay env và worker chỉ được chạy kiểm tra offline. Không vượt guard, không khẳng định UI đã nghiệm thu.

## Xung đột có thể / còn lại
- Prompt 03 sẽ đổi role/nhóm và có thể sửa enforce_single_learning_affiliation, learning-periods/readiness/catalog/schema/tài liệu; tích hợp giữ logic mới của prompt 03, chỉ gỡ policy gate.
- Prompt 02b/05 sửa editor/draft/publish/xóa khóa/caches; chỉ bỏ import awardStars không dùng ở progress, không đổi hành vi các luồng đó.
- Worker 04 sở hữu sàn mùa DNA trong competition-snapshots/period-leaderboard. Không đổi công thức xếp hạng/quyền.
- Mục 3 danh sách việc trong prompt vẫn nhắc MODEL_START, trái phần cập nhật và chỉ dẫn trực tiếp của người dùng. Lượt sửa reviewer chéo dùng dữ liệu học cũ để chọn LEGACY/NATIVE; không sửa prompt của người dùng. Các tài liệu release1 cũ nói mọi chu kỳ thiếu đều NATIVE đã lỗi thời so với chỉ dẫn sửa lỗi hiện tại; lượt này chỉ cập nhật HANDOFF và code/test trong phạm vi yêu cầu.
- Bản 2 chỉ chuẩn bị SQL; bỏ model/generate/apply/restore rehearsal chờ bản 2 được duyệt. Giữ provenance và imported_due_at, không thực hiện tùy chọn xóa provenance.
- Phần code bản 1 và kiểm tra offline đã hoàn tất. Các release gate DB/audit/browser, kiểm kê deployment cũ và tích hợp worker khác vẫn cần người dùng thực hiện trước triển khai.

## Checkpoint trên nhánh
- `4a870b7 chore(learning): retire policy reads and use native season evidence`: runtime, route/alias, SQL hai bản và test khởi đầu.
- Checkpoint hoàn tất có thông điệp `chore(learning): verify policy-free contracts and document rollout`; chứa test hồi quy cuối, script/load-test, tài liệu và HANDOFF này, không gồm thay đổi prompt sẵn có của người dùng. Tra `git log -2 --oneline` để lấy SHA. Không push.

## Danh sách 49 file worker sửa hoặc thêm qua hai checkpoint
```text
HANDOFF.md
prisma/migrations/20261110_learning_affiliation_without_policy/migration.sql
prisma/release-2/20261110_drop_learning_policy/migration.sql
src/app/admin/learning-config/page.tsx
src/app/admin/learning-policy/page.tsx
src/app/api/v1/admin/learning-config/route.ts
src/app/api/v1/admin/learning-policy/route.ts
src/app/api/v1/assessments/[assessmentId]/attempts/route.ts
src/app/api/v1/learning/me/route.ts
src/app/api/v1/learning/periods/route.ts
src/app/api/v1/lessons/[lessonId]/progress/route.ts
src/lib/chapter-actual-terms.ts
src/lib/chapter-term-results.ts
src/lib/competition-snapshots.ts
src/lib/learning-cycle-rules.ts
src/lib/learning-periods.ts
src/lib/learning-readiness-rules.ts
src/lib/learning-readiness.ts
src/lib/period-leaderboard.ts
src/lib/stars.ts
src/test/chapter-initial-rewards.test.ts
src/test/learning-cycles.test.ts
src/test/monthly-reward-reset.test.ts
scripts/test/test-learning-cycles-integration.cjs
scripts/test/test-fb-fixes.cjs
scripts/test/test-completed-lessons-integration.cjs
scripts/test/test-reward-pause-integration.cjs
scripts/test/test-chapter-transfer-integration.cjs
scripts/test/test-chapter-period-api.cjs
scripts/test/test-learning-security.mjs
scripts/test/rehearse-learning-migration.mjs
scripts/audit/audit-chapter-ranking-readonly.cjs
scripts/audit/audit-organization-integrity.mjs
scripts/audit/audit-handbook-formulas.cjs
scripts/db/remediate-video-completion.ts
load-tests/inspect-supabase.mjs
load-tests/fixtures/seed.mjs
load-tests/fixtures/seed-supabase-baseline.mjs
docs/api.md
docs/CKNK.md
docs/operations.md
docs/implementation-plan.md
docs/KHBB-ky-thuat.md
docs/KHBB.md
docs/architecture.md
docs/business-rules.md
docs/known-issues.md
docs/testing.md
docs/reference/handbook-formulas.md
```
