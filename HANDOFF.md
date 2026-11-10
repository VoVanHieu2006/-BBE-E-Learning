# HANDOFF — Prompt 04: cấu hình học tập

## Phạm vi và an toàn
- Worktree hiện tại, nhánh `chore/p04-go-cutover`; không push/merge/rebase/đổi nhánh.
- Chỉ bản phát hành 1; bản 2 chỉ viết migration, không áp dụng và không bỏ model trong schema của bản 1.
- Không kết nối DB, không tìm `.env`, không chạy install/generate/migrate/db push.
- Giữ công thức hạn, nhánh LEGACY, imported_due_at, provenance của learning_cycles/star_ledger và mọi migration cũ.

## Trạng thái cuối checkpoint chuẩn bị
- Đã đọc quy tắc chung, quy tắc worker ngoài, prompt 04, AGENTS.md, KHBB.md và phần 3.11–3.12 của KHBB-ky-thuat.md liên quan dữ liệu lịch sử.
- Working tree sạch ở lúc bắt đầu; đúng nhánh được chỉ định.
- Bước 0: hoàn tất chuẩn bị truy vấn chỉ đọc bên dưới; CHƯA audit DB thật.
- Dừng trước sửa code/migration vì prompt 04 yêu cầu prompt 03 đã được duyệt và MODEL_START phải là giá trị production chính xác. Đây không phải hoàn thành bản phát hành 1.
- Chỉ thêm HANDOFF.md; không sửa runtime, schema, migration, cấu hình hoặc dependency.

## Còn lại theo prompt
0. Người dùng tự chạy audit bên dưới, duyệt kết quả và cung cấp mốc lịch sử. Nếu có affiliationConflicts phải dừng chờ quyết định xử lý, không tự sửa dữ liệu.
1. (Bản 1 mục 2) Thêm migration CREATE OR REPLACE FUNCTION, chỉ bỏ câu điều kiện policy; giữ logic còn lại theo bản prompt 03 đã duyệt và giữ bảng.
2. (Bản 1 mục 3) Bỏ đọc policy; dùng tháng tự nhiên, MODEL_START bất biến cho mùa DNA; tạo chu kỳ NATIVE từ now cho người chưa có chu kỳ. Giữ nhánh LEGACY, imported_due_at và provenance.
3. (Bản 1 mục 4) Đổi route/trang sang learning-config; giữ alias cũ một bản phát hành, giữ toàn bộ cấu hình không thuộc policy.
4. (Bản 1 mục 5) Dọn test/script/load-test được liệt kê trong prompt, thêm kiểm tra mốc tháng, mùa DNA và dữ liệu LEGACY.
5. (Bản 1 mục 6) Cập nhật operations/api/CKNK/implementation-plan và tài liệu ngoài prompt còn nhắc cấu hình cũ; không sửa nội dung prompt làm mất chỉ dẫn gốc.
6. (Bản 2) Chỉ viết migration DROP TABLE riêng, không áp dụng; bỏ model/generate ở bản 2 sau khi bản 1 ổn định. Chưa viết migration vì chưa thể bắt đầu bản 1 và không được đưa DROP TABLE vào chuỗi migration có thể được áp dụng cùng bản 1.

## Bước 0 — truy vấn production để người dùng tự chạy
Không có truy vấn nào dưới đây được thực thi trong session. Dùng tài khoản chỉ đọc được người dùng ủy quyền, lưu kết quả trong nơi bảo mật của người dùng; không đưa connection string, email, token hay bản sao DB vào git/chat. Truy vấn dùng UTC cho timestamp không có timezone, theo audit/trigger hiện tại; đầu tháng tính giờ Việt Nam theo learning-cycle-rules.ts.

```sql
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

SELECT now() AS audited_at;

WITH active AS (
  SELECT m.user_id, u.type
  FROM organization_memberships m
  JOIN organization_units u ON u.id = m.unit_id
  WHERE m.status = 'ACTIVE'
    AND m.starts_at <= timezone('UTC', now())
    AND (m.ends_at IS NULL OR m.ends_at > timezone('UTC', now()))
), dna AS (
  SELECT DISTINCT user_id FROM active
  WHERE type IN ('DNA', 'DNA_GROUP')
), conflicts AS (
  SELECT d.user_id,
    EXISTS (
      SELECT 1 FROM chapter_members c WHERE c.user_id = d.user_id
    ) AS legacy_chapter,
    (
      SELECT count(*) FROM active a
      WHERE a.user_id = d.user_id AND a.type IN ('CHAPTER', 'DEPARTMENT')
    ) AS chapter_memberships
  FROM dna d
  WHERE EXISTS (
    SELECT 1 FROM chapter_members c WHERE c.user_id = d.user_id
  ) OR EXISTS (
    SELECT 1 FROM active a
    WHERE a.user_id = d.user_id AND a.type IN ('CHAPTER', 'DEPARTMENT')
  )
)
SELECT md5(user_id::text) AS user_ref,
       legacy_chapter, chapter_memberships,
       count(*) OVER () AS affiliation_conflicts
FROM conflicts
ORDER BY user_ref;

SELECT * FROM learning_policy ORDER BY id;

WITH bounds AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AT TIME ZONE 'Asia/Ho_Chi_Minh' AS natural_month_start
)
SELECT p.id, p.cutover_at, p.mapping_approved_at,
       b.natural_month_start,
       p.cutover_at < b.natural_month_start AS earlier_than_current_month,
       p.cutover_at <= now() AND p.mapping_approved_at IS NOT NULL
         AS policy_gate_enabled
FROM learning_policy p CROSS JOIN bounds b
ORDER BY p.id;

SELECT count(*) AS imported_paths,
       count(*) FILTER (WHERE NOT EXISTS (
         SELECT 1 FROM learning_path_changes c WHERE c.path_id = p.id
       )) AS imported_paths_without_changes
FROM learning_paths p
WHERE p.imported_due_at IS NOT NULL;

SELECT m.key, m.starts_at, m.ends_at, m.state,
       date_trunc('month', m.starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')
         AT TIME ZONE 'Asia/Ho_Chi_Minh' AS natural_month_start
FROM competition_months m
WHERE m.starts_at <> (
  date_trunc('month', m.starts_at AT TIME ZONE 'Asia/Ho_Chi_Minh')
    AT TIME ZONE 'Asia/Ho_Chi_Minh'
)
ORDER BY m.starts_at;

SELECT pg_get_functiondef(p.oid) AS installed_affiliation_function
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = current_schema()
  AND p.proname = 'enforce_single_learning_affiliation';

SELECT c.relname AS table_name, t.tgname, t.tgenabled,
       t.tgdeferrable, t.tginitdeferred
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = current_schema() AND NOT t.tgisinternal
  AND t.tgname IN ('single_affiliation_membership', 'single_affiliation_chapter')
ORDER BY c.relname, t.tgname;

ROLLBACK;
```

### Đọc kết quả và cổng duyệt
- Không có dòng conflicts nghĩa là 0 người vừa Chapter vừa DNA tại thời điểm audit, KHÔNG phải chứng minh production đã kiểm tra trong session này. Có dòng nào thì dừng triển khai, người dùng quyết phạm vi/chức vụ đúng và thời điểm hiệu lực; không viết lại lịch sử sao.
- Cần đúng `cutover_at` của hàng `id = 'default'`, đầy đủ timezone/millisecond, để chốt MODEL_START trong code. Không suy ra từ ngày migration/test. Nếu hàng thiếu hoặc null, chủ sản phẩm phải quyết mốc lịch sử bất biến trước khi tiếp tục.
- `earlier_than_current_month` phải được kiểm tra; nếu false/null phải duyệt ảnh hưởng thay sàn tháng trước triển khai. Hàng tháng đã có không được tự sửa: upsert hiện tại dùng update rỗng (`learning-periods.ts:25–27`).
- Lưu bản sao đầy đủ `SELECT * FROM learning_policy` trước bản 2 ở nơi sao lưu riêng. Không commit backup production.
- `imported_paths_without_changes` là số đường học còn có thể dùng hạn nhập làm sàn lần reconcile đầu; giữ dữ liệu này, không drop cột hoặc backfill.
- Hàm/trigger đã cài cần đối chiếu migration prompt 03 được duyệt để bản 1 không ghi đè ràng buộc tổ chức mới. Audit thời điểm now không bao quát membership lên lịch tương lai; người dùng cần xem thêm nếu có loại dữ liệu này.

## Kế hoạch triển khai hai bản — CHƯA triển khai
### Bản 1
1. Xác nhận prompt 03 đã hoàn tất/duyệt; người dùng tích hợp theo quy trình của họ, worker không merge/rebase/đổi nhánh.
2. Người dùng chạy Bước 0, xác nhận không có xung đột chưa xử lý, cung cấp MODEL_START và duyệt ảnh hưởng tài khoản chưa có chu kỳ.
3. Thực hiện code/test/docs trong phạm vi prompt 04, migration mới chỉ định nghĩa lại hàm không tra bảng; bảng và model LearningPolicy vẫn còn để ứng dụng cũ cùng hoạt động và giữ khả năng rollback code.
4. Chạy typecheck và unit sau từng mục, checkpoint; test DB/diễn tập migration chỉ bởi người dùng trên DB riêng có guard, chưa chạy trên production. Kiểm tra UI thực tế với app cấu hình test trước báo hoàn thành.
5. Triển khai theo quy trình người dùng; giám sát ghi membership/Chapter (lỗi có thể ở commit), tháng thi đua, đóng mùa DNA, chu kỳ/LEGACY, cấu hình/outbox và alias cũ. Không backfill sao/snapshot hay chỉnh tháng lịch sử.

### Bản 2 (chỉ chuẩn bị, chạy khi bản 1 ổn định)
1. Sau khi tất cả instance/job/script đã ngừng đọc policy và bản 1 được duyệt ổn định, sao lưu policy và kiểm tra dependency của bảng trong DB riêng.
2. Viết migration mới chứa `DROP TABLE learning_policy;` (không CASCADE); không đặt bản 2 trong tập migration deploy bản 1. Worker chỉ viết sau khi bản 1 có trạng thái rõ ràng; session này chưa tạo file DROP.
3. Bỏ model LearningPolicy khỏi schema trong bản 2, không phải schema ứng dụng bản 1. Việc generate/deploy thuộc người dùng, không worker ngoài.
4. Diễn tập `rehearse-learning-migration.mjs` trên DB riêng với cả migration mới; không chạy ở session thiếu DB test.
5. Không bỏ cycle_lesson_progress.provenance nếu chưa được duyệt; luôn giữ provenance của learning_cycles và star_ledger. Sau drop, rollback về code còn đọc policy cần khôi phục bảng/backup, không chỉ rollback binary.

## Quyết định / cần người dùng xác nhận
1. Prompt 03 đã xong và được duyệt chưa? Bằng chứng nhánh hiện tại chưa có: schema còn CHAPTER_LEADER (`prisma/schema.prisma:16–21`), catalog còn BDH/MEMBER_*/LEADER_* (`src/lib/learning-catalog.ts:10–17`). Không tự thay role/nhóm thuộc worker khác.
2. Giá trị production `learning_policy.id='default'.cutover_at` chính xác là gì? Không có hardcoded MODEL_START đáng tin trên nhánh. Không lấy fixture/test date làm dữ liệu thật.
3. Duyệt ảnh hưởng người dùng đang ngủ/chưa có chu kỳ: đổi khởi tạo NATIVE từ now theo prompt làm bộ lọc attempt chỉ nhận attempt gắn chu kỳ; trước đây LEGACY có thể nhận attempt null (`learning-periods.ts:59–65,105–111`). Tiến độ video/hạn cũ vẫn nhập như hiện tại, nhưng quiz cũ của tài khoản chưa có chu kỳ cần được người dùng xem xét.
4. Không xóa provenance tùy chọn của cycle_lesson_progress. Không tự khắc phục dữ liệu xung đột.

## Test đã chạy (baseline, không phải nghiệm thu bản 1)
- `npx tsc --noEmit`: PASS, exit 0, không có lỗi TypeScript.
- `npm run test:unit`: PASS, 40 unit suites, exit 0. Runner ép DATABASE_URL/DIRECT_URL về loopback port 1 (`scripts/test/run-tests.cjs:32–34`); không DB production.
- Không chạy audit DB, test integration, migration rehearsal hoặc browser: chưa có DB/app test và chưa sửa UI. Không chạy npm install/prisma generate/migrate/db push.

## Xung đột có thể
- Prompt 03 cùng enforce_single_learning_affiliation; phải lấy phần logic còn lại từ bản đã duyệt, không thay bằng phiên bản cũ trên nhánh này.
- learning-periods/learning-readiness/catalog/schema và tài liệu chung có thể được prompt 03 sửa; cần phối hợp khi tích hợp, worker không tự merge.
- Prompt 02b/05 không thuộc phạm vi; không sửa editor/draft/publish/xóa khóa hoặc công thức hạn.
- Worker prompt 04 sở hữu thay sàn lịch sử trong competition-snapshots.ts/period-leaderboard.ts, nhưng chưa đụng file do thiếu MODEL_START.
