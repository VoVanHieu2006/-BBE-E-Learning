# Prompt 04 — Gỡ cutover và `learning_policy`

Đọc `docs/prompts/00-quy-tac-chung.md` trước. **CẬP NHẬT THỨ TỰ: prompt này chạy TRƯỚC prompt 03 (song song với 02b và 05). Không cần chờ prompt 03.** Mọi tên role/chức vụ/nhóm học cứ giữ tên hiện tại trong code; prompt 03 sẽ đổi tên sau khi gộp. Khi viết migration định nghĩa lại `enforce_single_learning_affiliation`, chỉ bỏ điều kiện tra `learning_policy`, giữ nguyên phần còn lại (kể cả tên role hiện tại). Nhánh gợi ý: `chore/go-learning-policy`. Bắt đầu ở chế độ Plan.

## Mục tiêu
Chủ sản phẩm quyết định **bỏ khái niệm cutover**; `learning_policy` chỉ là tàn dư. Tài liệu đã bỏ (xem `docs/KHBB.md` dòng 13 của bảng mục 9). Prompt này dọn code theo **hai bản phát hành**, an toàn với dữ liệu production.

## Điều đã khảo sát (đọc kỹ, đừng làm lại từ đầu)
- Bảng `learning_policy` (3 cột: `cutover_at`, `mapping_approved_at`, ...) không có khóa ngoại. **Nhưng một trigger DB đọc nó**: hàm `enforce_single_learning_affiliation()` ở `prisma/migrations/20261022_learning_guards/migration.sql` dòng ~89 trả về sớm nếu không có policy `cutover_at <= now` và `mapping_approved_at IS NOT NULL`. Drop bảng mà chưa định nghĩa lại hàm sẽ làm hỏng mọi ghi vào `organization_memberships`/`chapter_members` (trigger hoãn nên lỗi ở lúc commit). Ngoài ra nếu production đang thiếu hàng policy thì ràng buộc "không vừa Chapter vừa DNA" **đang tắt**; định nghĩa lại không điều kiện sẽ bật nó, nên phải chạy audit `affiliationConflicts` (`scripts/audit/audit-organization-integrity.mjs`) trước.
- Route `src/app/api/v1/admin/learning-policy/route.ts` và trang `src/app/admin/learning-policy/page.tsx` **không chỉ là cutover**: chứa cấu hình chương trình, nhóm học, mapping khóa-chương trình, mùa chuyển giao, chuẩn hóa tổ chức, thử lại outbox. Chỉ trường `policy` trong GET là của cutover. **Không xóa route/trang**, đổi tên thành cấu hình học tập (ví dụ `/api/v1/admin/learning-config`), giữ đường cũ chuyển hướng/alias một bản phát hành, cập nhật `docs/api.md`, `docs/CKNK.md`, `docs/operations.md`, `docs/implementation-plan.md`, `scripts/test/test-learning-security.mjs`.
- Chỗ còn ảnh hưởng hành vi sống:
  1. Sàn tháng thi đua: `src/lib/learning-cycle-rules.ts` (`competitionMonthBounds`, `startsAt = max(naturalStart, cutover)`), gọi từ `src/lib/learning-periods.ts` (`lockCompetitionScope`, `learningContext`), `src/app/api/v1/assessments/[assessmentId]/attempts/route.ts` (cổng "học lại"), `scripts/db/remediate-video-completion.ts`. Sau khi bỏ: sàn = đầu tháng tự nhiên. **Kiểm tra trước** `SELECT cutover_at FROM learning_policy` sớm hơn đầu tháng hiện tại (nếu có DB) hoặc đưa truy vấn cho người dùng.
  2. Sàn mùa DNA: `src/lib/competition-snapshots.ts` (`closeCompetitionTerms`, dòng ~491-503, bỏ qua mùa có `end <= cutover` và nâng `starts_at` lên `max(boundary, cutover)`) và `src/lib/period-leaderboard.ts` (dòng ~95-96, ~141). **KHÔNG dùng hằng số mốc và không giữ khái niệm cutover.** Thay bằng quy tắc dựa trên dữ liệu: không dựng snapshot cho một mùa DNA đã kết thúc nếu cửa sổ của mùa đó không có bằng chứng học theo mô hình mới (không có dòng `star_ledger` `provenance = 'NATIVE'` nào trong cửa sổ và chưa có snapshot nào của mùa đó); mùa có bằng chứng thì dựng bình thường với `starts_at` là ranh giới mùa. Lý do: việc dựng snapshot ngược cho các mùa trước mô hình mới (ví dụ mùa 6 tháng cũ) sẽ cho kết quả rỗng hoặc sai. Ghi rõ ngữ nghĩa này trong HANDOFF.md và thêm test cho: mùa cũ không có NATIVE (bị bỏ qua), mùa có NATIVE (được dựng), snapshot đã chốt không bị dựng lại.
  3. Chu kỳ `LEGACY`: các nhánh ở `learning-periods.ts` (`currentCycleAttemptFilter`), `lesson-learning-state.ts`, `video-heartbeat.ts`, `quiz-submission.ts`, `learning-assignments.ts` còn đọc `provenance = 'LEGACY'` và attempt có `learning_cycle_id IS NULL`. **Giữ nguyên các nhánh này** (chỉ bỏ tham số cutover). Không xóa cột `provenance`.
  4. `learningContext` (`learning-periods.ts` dòng ~56-82) dùng `user.created_at <= cutover_at` để chọn `LEGACY`/`NATIVE`. Thay bằng: người dùng chưa có chu kỳ nhận chu kỳ `NATIVE` bắt đầu từ `now`; nhập tiến độ cũ như hiện tại. Hỏi người dùng nếu thấy ảnh hưởng người dùng đang ngủ.
  5. `imported_due_at` (`shared-learning-path.ts` dòng ~47-49): giữ như dữ liệu đọc, không xóa cột.
- Chỗ chỉ là tàn dư: `src/lib/learning-readiness.ts` (đọc policy chỉ để trả lại `readiness.policy`), `loadLearningPolicy` và type `LearningPolicy` ở `learning-periods.ts`, trường `policy` trong `GET /api/v1/learning/periods` và `learning-policy`, `src/lib/stars.ts` hàm `awardStars` không còn ai gọi (và nếu bị gọi sẽ ghi `provenance` mặc định `LEGACY`, bị bảng xếp hạng loại), trường `importedDueAt` trong `learning/me`, các stub `learningPolicy` trong `src/test/chapter-initial-rewards.test.ts` và `scripts/test/test-chapter-period-api.cjs`, script audit/load-test cần hàng policy (`scripts/audit/audit-chapter-ranking-readonly.cjs`, `audit-organization-integrity.mjs`, `audit-handbook-formulas.cjs`, `load-tests/inspect-supabase.mjs`, `load-tests/fixtures/seed.mjs`, `seed-supabase-baseline.mjs`).
- `provenance` của `star_ledger` (mặc định `LEGACY`) là bộ lọc bảng xếp hạng (`competition-snapshots.ts:180` chỉ lấy `NATIVE`): **giữ**. Mọi chỗ ghi sao phải đặt `NATIVE`.

## Việc cần làm

### Bản phát hành 1 (code + một migration định nghĩa lại hàm, không drop bảng)
1. Báo cáo audit trước (Bước 0): chạy hoặc chuẩn bị truy vấn `affiliationConflicts`, `SELECT * FROM learning_policy`, đếm `learning_paths WHERE imported_due_at IS NOT NULL` và chưa có `learning_path_changes`. **Dừng chờ người dùng duyệt** nếu có dữ liệu xung đột.
2. Migration mới `CREATE OR REPLACE FUNCTION enforce_single_learning_affiliation()` không còn tra `learning_policy` (nội dung còn lại giữ nguyên). Không sửa migration cũ.
3. Ngừng đọc `learning_policy` trong toàn bộ code (danh sách trên), thay sàn mùa DNA bằng `MODEL_START`, bỏ tham số cutover ở `competitionMonthBounds`/`learningContext`/`lockCompetitionScope`, bỏ `readiness.policy` và `policy` khỏi response (nếu giao diện không dùng).
4. Đổi tên route/trang cấu hình học tập như trên, giữ alias cũ.
5. Dọn test/script/load-test: `src/test/learning-cycles.test.ts` (test sàn cutover, viết lại theo ranh giới tự nhiên), `src/test/monthly-reward-reset.test.ts` (dòng ~66 khẳng định chuỗi `loadLearningPolicy(prisma))?.cutover_at` trong `attempts/route.ts`, sẽ vỡ), `scripts/test/test-learning-cycles-integration.cjs`, `test-fb-fixes.cjs` (phần readiness và transfer dùng policy), `test-completed-lessons-integration.cjs`, `test-reward-pause-integration.cjs`, `test-chapter-transfer-integration.cjs`, `test-chapter-period-api.cjs`, `test-learning-security.mjs`, `rehearse-learning-migration.mjs`.
6. Tài liệu: gỡ mọi nhắc cutover/`learning_policy` còn sót (chạy `grep -rniE "cutover|learning_policy|learning-policy" docs README.md AGENTS.md`), cập nhật `docs/operations.md`, `docs/api.md`, `docs/CKNK.md`.

### Bản phát hành 2 (migration riêng, chỉ viết, chạy sau khi bản 1 ổn định)
`DROP TABLE learning_policy;` và bỏ model `LearningPolicy` khỏi `prisma/schema.prisma`. Tùy chọn (hỏi người dùng): bỏ `cycle_lesson_progress.provenance`. Ghi chú sao lưu: `SELECT * FROM learning_policy` trước khi drop. Chạy lại `rehearse-learning-migration.mjs` với migration mới.

## Nghiệm thu
`rg "learning_policy|cutover"` trong `src` chỉ còn ở migration cũ và migration mới; tất cả test unit pass; kế hoạch triển khai hai bản phát hành được ghi rõ; liệt kê dữ liệu production cần người dùng tự kiểm tra.

## Phối hợp với worker khác (đang chạy song song)
- Prompt 02b sửa editor khóa học, `draft/publish`, các trang học viên. Prompt 05 sửa route xóa khóa, cache, quyền xem ngân hàng đề và đối chiếu xếp hạng (chỉ đọc `competition-snapshots.ts` và `period-leaderboard.ts` trừ khi có lỗi chứng minh được). Hai việc đó không phải của bạn.
- Bạn sở hữu mọi chỗ liên quan mốc sàn cutover trong `competition-snapshots.ts` và `period-leaderboard.ts`.

## Không được đụng tới
Công thức hạn (01), cập nhật khóa (02), đổi tên role/nhóm học (03), xóa khóa học (05), cột `provenance` của `star_ledger` và `learning_cycles`, mọi migration cũ.
