# Handoff — prompt 05

## Trạng thái vòng sửa reviewer 10/11/2026 — ưu tiên mục này

Đã sửa code/test cho cả (1)–(4), **chưa nghiệm thu toàn bộ** vì full unit còn lỗi tiến trình con bên dưới. Nhánh `fix/p05-xoa-khoa`, working tree sạch lúc bắt đầu vòng này. Không commit/push/install/generate Prisma/DB thật; giữ toàn bộ thay đổi để người dùng commit.

### Kết quả theo yêu cầu reviewer

1. **Đã sửa:** cleanup kiểm tham chiếu sau commit trước từng object: document (FK tới lesson), course cover (public ID hoặc URL sao chép), JSON course draft lồng nhau. Lỗi đọc tham chiếu giữ object. Test dùng chung tài liệu trong/cross-course, draft-only, ảnh bìa dùng chung, URL encode và lỗi lookup.
2. **Đã sửa trong giới hạn yêu cầu:** đọc lại lesson ID còn tồn tại, đúng course, ngay trước create/update unlock trong cùng transaction; không ghi nếu tất cả đã mất. Giữ dọn cycle progress theo scope khi xóa. Sửa comment tránh khẳng định Serializable bao phủ mọi writer. Không thêm FK/schema hay thay toàn bộ heartbeat.
3. **Đã sửa:** luôn trả availableMonths, kể cả thiếu/hỏng snapshot, thiếu kỳ hiện tại và cache live; giữ state/lý do. Trang lưu state/reason từ cả cache lẫn fetch và hiển thị “Tháng này chưa có dữ liệu lịch sử”. Không dựng lại/backfill snapshot lịch sử.
4. **Đã sửa:** GET pools giống contract cũ: Admin-only, items gồm poolId/name/sortOrder/questionCount, sort_order tăng dần; chặn quyền trước đọc DB.

### Kiểm chứng vòng reviewer

| Lệnh | Kết quả |
|---|---|
| `node scripts/test/run-tests.cjs unit test-p05-assets` | PASS 15/15 (trước sửa 4 PASS/11 FAIL đúng lỗi) |
| `node scripts/test/run-tests.cjs unit learning-unlocks` | PASS 4/4 (trước sửa 1 PASS/3 FAIL) |
| `node scripts/test/run-tests.cjs unit admin-chapters-state` | PASS 3/3 (trước sửa 0 PASS/3 FAIL; render cache/fetch/chuyển tháng) |
| `node scripts/test/run-tests.cjs unit test-p05-routes` | PASS 22/22 (trước sửa 12 PASS/10 FAIL) |
| `npx tsc --noEmit` | PASS, exit 0 |
| `git -c core.safecrlf=false diff --check` | PASS |
| `npm run test:unit` | FAIL, exit 1: bắt đầu 45 suite; 649 test, 647 PASS/2 FAIL ở database-safety.test.cjs (`spawnSync ... EPERM`) |
| `node scripts/test/run-tests.cjs unit safety.test.mjs` | PASS 8/8 (suite sau điểm full run dừng) |
| `node scripts/test/run-tests.cjs unit profiler.test.mjs` | FAIL 0 PASS/1 FAIL: tiến trình con trả status=null thay vì 0 |

44/44 test liên quan bản sửa PASS, đều có kiểm chứng RED trước sửa. Full run đã bao gồm bản code/test cuối; không gộp các lần riêng để tuyên bố full unit PASS. Log: `test-results/p05-review-unit.log` (ignored, UTF-16). Hai lỗi database-safety và một lỗi profiler cùng loại đã được ghi ở vòng trước; không sửa guard để ép xanh. Review chỉ đọc bản diff: không có finding chặn mới. Integration/concurrency/storage thật và browser không chạy vì không có DB test/.env và phạm vi không cho dùng dịch vụ thật.

### File sửa/thêm trong vòng reviewer (12)

- `src/lib/deleted-content-assets.ts`, `src/lib/learning-unlocks.ts`, `src/lib/content-deletion.ts` (file cuối chỉ sửa comment giới hạn race)
- `src/app/api/v1/leaderboard/chapters/route.ts`, `src/app/admin/chapters/page.tsx`
- `src/app/api/v1/assessments/[assessmentId]/pools/route.ts`
- `scripts/test/test-p05-assets.cjs`, `scripts/test/test-p05-routes.cjs`, `scripts/test/run-tests.cjs`
- Thêm `src/test/learning-unlocks.test.ts`, `src/test/admin-chapters-state.test.cjs`
- `HANDOFF.md`

### Giới hạn/rủi ro và xung đột có thể

- Progress: DELETE sau lần đọc lại, hoặc transaction giữ snapshot cũ, vẫn có thể để lọt writer không dùng FK/khóa chung. Chưa kiểm chứng DB concurrency; cần protocol khóa thống nhất hoặc FK để bảo đảm tuyệt đối, ngoài phạm vi sửa tối thiểu này.
- Storage: kiểm DB rồi gọi provider vẫn có cửa sổ writer tạo tham chiếu mới sau kiểm tra; chưa có protocol khóa chung/tombstone cho mọi uploader. URL mơ hồ giữ lại object để tránh mất dữ liệu; cleanup lỗi chỉ log, chưa retry bền vững. Quét cover/draft JSON theo từng object có thể tốn chi phí khi dữ liệu lớn.
- Không có thay đổi nghiệp vụ/schema/quyền ngoài GET Admin-only đã công bố. `docs/api.md` vốn đúng contract GET nên không cần sửa. Không tự quyết việc bổ sung snapshot lịch sử.
- Khi gộp cần giữ phần đọc lại ID trong `learning-unlocks.ts` (có thể chạm worker luồng học) và các mục test bổ sung trong runner dùng chung; không ghi đè thay đổi worker khác.

## Trạng thái vòng trước — lưu để đối chiếu

Ngày 10/11/2026, nhánh `fix/p05-xoa-khoa`. A–D đã triển khai trong phạm vi mô tả dưới đây, **chưa nghiệm thu toàn bộ** do full unit thất bại và không có DB test. E bỏ qua đúng yêu cầu. Tất cả thay đổi còn ở working tree: Git bị sandbox từ chối tạo `C:/Users/Acer/Desktop/E-learning/.git/worktrees/p05/index.lock` khi add/commit. Không có SHA checkpoint, không vượt sandbox, không push/merge/rebase/đổi nhánh. Cần quyền metadata Git để commit khi bàn giao.

### Kết quả theo prompt

- **A1–3:** xóa khóa kiểm lịch sử (attempt bài/cuối khóa, progress legacy/cycle, replay, mark, supplement, assignment đã học) trong transaction Serializable và khóa course. Trả 409 hướng dẫn hủy xuất bản nếu có history. Assignment chỉ giao chưa học vẫn được xóa cùng khóa: đóng rule, audit kèm rule ID/số người reconcile, enqueue trước cascade. Budget cũ của learning_paths còn nguyên để reconcile tính lại due_at. Invalidate course/system/lesson và member/Chapter leaderboard caches.
- **B1–2:** dùng helper chung xóa course/session/lesson; giữ guard published và final bank capacity cho buổi/bài. Nếu khóa có history ở bất kỳ bài nào, từ chối xóa trực tiếp cả buổi/bài. Dọn các bảng không FK trong transaction theo phạm vi; không xóa ledger. R2/Cloudinary xóa sau commit, lỗi chỉ log; chỉ dùng cover_public_id đã lưu.
- **B3–4:** audit DELETE_COURSE/SESSION/LESSON, UPDATE_COURSE, UNPUBLISH_COURSE cùng transaction với thay đổi DB. Reorder kiểm JSON/UUID/ID trùng/order trùng, order nguyên và phạm vi Int; khóa course, kiểm ownership toàn bộ trước cập nhật, guard xuất bản trong transaction, race trả 409.
- **C1/C3:** pools 1–20; mapping, capacity `K <= Q <= K × min(pool size)` và attempt kiểm sau khóa course trong transaction. GET ngân hàng đề Admin-only; GET lesson/assessment vốn Admin-only nên không sửa.
- **C2:** giữ AssessmentVersionRequired; chỉ đề xuất revision quiz bất biến, attempt gắn revision, xuất bản revision mới mà giữ điểm/tiến độ cũ. Chưa thiết kế schema hay triển khai versioning.
- **D1–4:** period snapshot không lọc trạng thái hiện tại, live individual dùng cohort lịch sử tại mốc xét. Sửa sao/last-star Chapter dùng cùng cohort với quân số của stage. Legacy tháng đóng đọc snapshot; thiếu trả AWAITING_SNAPSHOT, không dựng lại lịch sử. Đối chiếu leaderboard/**, DNA leaderboard, dashboard/members và current-roster: ACTIVE/current affiliation; hai route roster dùng listChapterLearners. Cập nhật CKNK 5.10, KHBB dòng 19, known-issues theo bằng chứng thực.
- **E:** bỏ qua; không sửa editor/draft/publish/trang học viên của 02b, công thức hạn, role/group rename, learning_policy, schema hoặc migration.

### Kiểm chứng cuối

| Lệnh | Kết quả |
|---|---|
| `node scripts/test/run-tests.cjs unit content` | PASS: deletion 11/11, management 13/13 |
| `node scripts/test/run-tests.cjs unit ranking-departures` | PASS 3/3 |
| `node scripts/test/run-tests.cjs unit test-p05` | PASS: assets 4/4, routes 13/13 |
| `npx tsc --noEmit` | PASS cuối sau toàn bộ thay đổi code |
| `git -c core.safecrlf=false diff --check` | PASS |
| `npm run test:unit` | FAIL: 42 suite đã bắt đầu; 616 test, 614 PASS / 2 FAIL; dừng ở database-safety.test.cjs, spawnSync Node EPERM |
| `node scripts/test/run-tests.cjs unit safety.test.mjs` | PASS 8/8 (suite sau điểm dừng của full unit) |
| `node scripts/test/run-tests.cjs unit profiler.test.mjs` | FAIL 1/1: tiến trình con có status null thay vì 0 |

**Test mới cuối: 44/44 PASS.** Full run chạy trước khi thêm suite assets và hai test route cuối; các bổ sung đã chạy riêng thành công như bảng. Không gộp các lần chạy riêng để tuyên bố full unit PASS. Log full run: `test-results/p05-unit.log` (ignored, PowerShell ghi UTF-16). Integration bỏ qua vì không có DB test riêng/.env; không kết nối DB thật. Không cài dependency hoặc generate Prisma.

### Rủi ro/câu hỏi còn lại

1. Chưa kiểm chứng DB concurrency DELETE với các writer tiến độ không dùng cùng protocol, đặc biệt bảng không FK. Không sửa writer thuộc 02b; cần nghiệm thu khi gộp. Không tuyên bố Serializable chứng minh mọi race đã an toàn.
2. Due_at đổi khi outbox/read-through xử lý: cần scheduler chạy, chưa đo latency/retry thật. Storage thất bại chỉ log, chưa retry bền vững; cover legacy chỉ URL không tự dọn. Chưa gọi R2/Cloudinary thật.
3. Không sửa/backfill snapshot đã lưu; chưa nghiệm thu mọi chuyển giao/reset trên production. Cần chốt tên người ẩn danh hóa và cách xem tổng điểm nhiệm kỳ của người rời giữa kỳ. Hydration sẵn có dùng “Tài khoản đã gỡ”; không thay hoặc tự coi đó là chính sách duyệt.
4. Nếu cần gỡ khóa đã học khỏi danh mục: đề xuất archive/soft-delete, cần đặc tả và duyệt riêng. Không tự thêm cột/migration.
5. Cần giải quyết quyền metadata Git để commit checkpoint; full unit còn database-safety/profiler thất bại. Không sửa guard/test nền để ép xanh.

### Xung đột có thể khi gộp

- Worker 04: `competition-snapshots.ts` chỉ sửa predicate sao và lastStarAwardedAt trong historicalChapterMonthRows. Test trước sửa FAIL actual100/expected10, sau sửa PASS. Không sửa cutover/capture/learning_policy/period-leaderboard.ts; giữ thay đổi của 04 khi gộp.
- Course PATCH chỉ bọc update + audit; unpublish chỉ thêm audit vào transaction sẵn có. Không đổi công thức/enqueue của prompt 01 hoặc editor/draft của 02b.
- Runner test và tài liệu dùng chung cần gộp các mục thêm, không ghi đè phần worker khác.

### File sửa/thêm (23)

- `HANDOFF.md`
- `docs/CKNK.md`, `docs/KHBB.md`, `docs/known-issues.md`
- `scripts/test/run-tests.cjs`, `scripts/test/test-p05-assets.cjs`, `scripts/test/test-p05-routes.cjs`
- `src/app/api/v1/assessments/[assessmentId]/route.ts`
- `src/app/api/v1/assessments/[assessmentId]/pools/route.ts`
- `src/app/api/v1/courses/[courseId]/route.ts`
- `src/app/api/v1/courses/[courseId]/sessions/reorder/route.ts`
- `src/app/api/v1/courses/[courseId]/unpublish/route.ts`
- `src/app/api/v1/leaderboard/chapters/route.ts`
- `src/app/api/v1/lessons/[lessonId]/route.ts`, `src/app/api/v1/sessions/[sessionId]/route.ts`
- `src/lib/assessment-pools.ts`, `src/lib/content-deletion.ts`, `src/lib/deleted-content-assets.ts`, `src/lib/session-reorder.ts`, `src/lib/competition-snapshots.ts`
- `src/test/content-deletion.test.ts`, `src/test/content-management.test.ts`, `src/test/ranking-departures.test.ts`

## Nhật ký các mốc trước

- Nhánh: `fix/p05-xoa-khoa`; chỉ làm trong worktree hiện tại. Không push, cài dependency, generate Prisma hoặc kết nối DB.
- Phạm vi: A xóa khóa; B dữ liệu mồ côi/object/audit/reorder; C pools và quyền ngân hàng đề; D kiểm chứng BXH. Bỏ qua E.
- Đã đọc: quy tắc chung, worker ngoài, prompt 05, AGENTS và tài liệu nghiệp vụ liên quan (đang đối chiếu code).
- Đang làm: khảo sát route, schema, cache, outbox, mẫu audit và test.
- Còn lại: A1–3, B1–4, C1/C3, báo cáo C2, D1–4; test unit/TypeScript, cập nhật known-issues và checkpoint.
- A1–3, B1–2 và audit xóa (B3): đã triển khai `content-deletion.ts`, `deleted-content-assets.ts` và DELETE course/session/lesson. Chặn mọi dấu vết học (kể cả cycle/replay/mark/supplement/assignment đã học); assignment chưa học vẫn được enqueue trước cascade. Đóng rule, audit và giữ budget cũ cho reconcile tính lại due_at. Không xóa ledger.
- Test đã chạy: `node scripts/test/run-tests.cjs unit content-deletion`: 11/11 PASS; `npx tsc --noEmit`: PASS. Lần test đầu lỗi instanceof do target ES5; đã sửa prototype Error và chạy lại sạch. Lệnh node trực tiếp lần đầu thiếu TS_NODE_PROJECT; đã chuyển sang runner chuẩn.
- Đang làm tiếp: B3 audit cập nhật/hủy xuất bản, B4 reorder; C1/C3; D1–4; toàn bộ unit và tài liệu cuối.
- Giới hạn: chưa kiểm chứng khóa/race bằng DB thật, chưa gọi R2/Cloudinary. Storage lỗi chỉ log; chưa có retry bền vững.
- Quyết định: không soft-delete/migration; không sửa star_ledger; không lấy .env; không chạy integration DB.
- Xung đột có thể: hai thư viện snapshot/period thuộc worker 04, chỉ đọc trừ khi chứng minh lỗi cụ thể.
- B3–4, C1/C3: đã thêm audit UPDATE_COURSE/UNPUBLISH_COURSE; reorder validate và kiểm ownership/guard trong transaction; pools 1–20, kiểm mapping/capacity/attempt sau khóa course; ngân hàng đề Admin-only. `content-management`: 13/13 PASS; TypeScript PASS.
- Checkpoint: đã thử `git add`/`git commit` sau mục A/B nhưng bị sandbox từ chối tạo `C:/Users/Acer/Desktop/E-learning/.git/worktrees/p05/index.lock`. Không thể commit trong quyền hiện có, không vượt sandbox và không sửa thư mục gốc. Tất cả file vẫn lưu trong working tree.
- D đang làm: chứng minh `historicalChapterMonthRows` cộng sao ngoài cohort trong khi mẫu số đã loại người rời; legacy `/leaderboard/chapters?month` dựng lại tháng đóng. Sẽ sửa tối thiểu và ghi xung đột worker 04.
- D1–3: test tái hiện Chapter 100 sao/1 người (mong đợi 10/1) đã FAIL trước sửa, PASS sau sửa. Tử số và thời điểm sao cuối nay dùng cùng cohort của stage. Legacy tháng đã đóng đọc snapshot, thiếu snapshot trả AWAITING_SNAPSHOT. `period-leaderboard.ts` không sửa: snapshot không lọc trạng thái hiện tại, hydration chỉ đổi tên/email. Roster/dashboard dùng listChapterLearners ACTIVE và affiliation hiệu lực.
- Test riêng mới: content-deletion 11/11, content-management 13/13, ranking-departures 3/3, test-p05-routes 11/11 PASS; TypeScript PASS. Route test dùng doubles, không DB thật.
- Xung đột có thể (worker 04): `src/lib/competition-snapshots.ts` chỉ sửa predicate sao trong `historicalChapterMonthRows` và last-star từ các stage đã lọc; không sửa cutover, snapshot capture, period hoặc learning_policy. Khi gộp giữ cả thay đổi cutover của 04.
- Đang làm cuối: chạy full unit/tsc, rà soát và cập nhật CKNK 5.10 / KHBB dòng 19 / known-issues. Commit vẫn bị hạn chế filesystem như trên.
- Chỗ nghi ngờ: cần kiểm chứng race khi delete/pools, các bảng không FK và trạng thái người rời trong snapshot.
