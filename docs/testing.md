# Kiểm thử

Chạy ở root với dependencies đã cài. [package.json](../package.json) giữ các command hiện hữu; runner mặc định có danh sách rõ, không tự quét script cũ/kết nối DB ứng dụng. Log/output tự sinh thuộc `artifacts/`, không `docs/`.

```powershell
npm run typecheck
npm run build
npm test
npm run test:baseline-safety
```

Typecheck dùng `tsconfig.json`, hợp nhất config check trùng lặp. Unit dùng runtime/`tsconfig.test.json` theo command. Build không chứng minh email/storage/cron/DB production đã hoạt động.

| Nhóm | Lệnh/suite | Bảo vệ |
|---|---|---|
| Unit mặc định | `npm test` / `test:unit` | Danh sách explicit trong runner, gồm rules/learning/video, không ghi DB |
| Rules | `test:business-rules`, `test:learning-cycles`, `test:shared-deadline` | Gating, reward/month/cycle, deadline coordinator/retry |
| Video | `test:video-guard`, `test:video-progress-session`, `test:video-controls`, `test:video-youtube-ux`, `test:video-switching-leak`, `test:video-player-ui` | Observed time/seek, ACK/session, stale request, controls/fullscreen cleanup |
| Formula regression | `test:formula-audit` | Hành vi kế thừa, không thay audit sổ tay độc lập |
| Bootstrap | `test:baseline-safety` | Explicit destination/confirmation, populated/mismatch rejection, retry |
| DB integration runner | `npm run test:integration -- <tên-suite>`, ví dụ `npm run test:integration -- admin-program` | Bắt buộc chọn đúng một suite trước khi ghi; không filter sẽ liệt kê và exit 1; mỗi suite có DB/app env riêng |
| Learning DB/API | `test:learning-flow-integration`, `test:learning-security`, `test:learning-cycles-integration`, `test:reward-pause-integration` | Submission concurrency, snapshots/replay/readiness/reset, no-backpay, resource scope |
| Chapter/BXH | `test:leaderboard-integration` và `scripts/test` | Roster/period/actual term, completed lessons, transfer/star history |
| Tổ chức | `test:organization-integrity`, `test:organization-repair` | Single affiliation, Lead binding/tenure/import/concurrency, dry-run/repair/history |
| Migration | `test:migration-rehearsal` | Apply/compatibility synthetic, không thay production-backup rehearsal |
| FB fixes | `test:fb-fixes` | Invitation, duration, roster/history, readiness không cần cutover, rewards; DB riêng chặt |
| Browser | `test:browser`, `test:video-player-browser`, `test:tab-cache`, `test:sidebar` | Player, cache/dedupe, navigation/motion; config riêng |
| Load harness | `node --test load-tests/tests/safety.test.mjs load-tests/tests/profiler.test.mjs`, `node load-tests/tests/inspect.mjs`, `node load-tests/tests/harness-smoke.mjs` | Guards/profiler/k6 inspect/stub, không phải capacity evidence |

`audit:handbook-formulas` chạy riêng, còn FAIL ở [known-issues](known-issues.md). Không đổi production formulas để ép audit xanh. Giữ test program/department và quiz; những file chưa có npm command cũ vẫn có giá trị. Riêng test **"sáu tháng lịch"** (`chapter-six-month-transfer.test.ts`, `chapter-initial-rewards.test.ts`) **đã được viết lại**: quy tắc đủ sáu tháng đã bị bỏ và cửa sổ mùa đổi thành `01/01–30/06` / `01/07–31/12` — xem [CKNK](CKNK.md#21-chapter-mới-chuyển-giao-được-ngay-không-phải-chờ).

## DB riêng, loopback

Không dùng `DATABASE_URL` chung, cloud DB đang dùng hoặc `.env` fallback cho test ghi. Đọc guard đầu suite trước chạy; không đổi host/tên DB để vượt guard. Chọn đúng một tên suite, ví dụ `npm run test:integration -- test-learning-flow-integration`; không chạy aggregate mọi DB suite. HTTP app test dùng cùng DB/JWT/cron secrets fixture, bind loopback/port riêng. Suite dùng chung DB có thể thay policy/schema nên chạy tuần tự.

| Suite | Đích yêu cầu |
|---|---|
| Learning-flow | `TEST_DATABASE_URL`, loopback `bbe_test_learning_flow`; `TEST_APP_URL` local (mặc định 3112), JWT test theo suite |
| Chapter leaderboard | `TEST_DATABASE_URL`, loopback `bbe_test_leaderboard`; `TEST_APP_URL` local (mặc định 3111), JWT test theo suite |
| Cycles / security / reward-pause | `TEST_DATABASE_URL`, loopback `bbe_test_learning_cycles`; security cần JWT/CRON_SECRET và app local |
| Migration rehearsal | `MIGRATION_REHEARSAL_URL`, DB trống loopback `bbe_test_learning_rehearsal` hoặc suffix guard cho phép |
| UI QA preparation | `TEST_DATABASE_URL` loopback `bbe_test_learning_ui` và `UI_QA_PASSWORD`; chỉ metadata khóa + synthetic accounts, không learner/credential/progress thật |
| FB fixes | `FB_TEST_DATABASE_URL`, đúng `127.0.0.1:55438/fb_fixes_test`, không load `.env` |
| Program/department, quiz và test DB khác | `TEST_DATABASE_URL`, dedicated `bbe_test_*` và guard/preload của runner; đọc guard riêng từng suite |

Quy trình: tạo disposable cluster/DB → bootstrap/schema/guards theo harness → đặt URL bí mật trong process env → start app/harness cùng cấu hình → chạy suite → kiểm tra cleanup/log. Không in connection URL. Dọn đúng fixture/process đã xác nhận, không xóa toàn `scratch/` chứa PostgreSQL đang chạy.

Di chuyển script giữ `cwd` root, import/alias harness/bootstrap paths đúng; tách unit/DB/browser, không để `npm test` khởi DB/app không rõ đích.

## Ánh xạ QA cần giữ

| Kịch bản QA cũ | Suite tiếp nhận / phần kiểm tra thêm |
|---|---|
| AUTH invitation/activate/login/logout/reset | Learning-flow/security, FB invitation; mail thật, link expiry/reset UI cần staging riêng |
| Public/private/draft, session/lesson/documents | Learning-flow/security; Admin edit browser cho reorder/upload/error và assessment save/refresh |
| Seek/rewind/rate/mạng chậm/session | Video guard/progress-session, learning-flow/player browser; media/điện thoại thật kiểm tra thêm |
| Quiz gate/random/timer/resume/result/cooldown | Learning-flow/cycles, quiz suites; concurrent manual/auto, expired/old-cycle, immutable grading |
| Manager dashboard/inactive/cross-Chapter | Learning-security, organization/Chapter integration; không nới scope do cache |
| Transfer draft/Sheet/preview/schedule/apply/cancel | Transfer/six-month tests, browser transition cho draft/history/countdown/confirm/error |
| 20 vs >20, 69,99/70%, 50%, KPI/tie/history | Chapter/period/formula; đủ tám bảng cùng data, missing snapshot/KPI và >500 cần acceptance riêng |
| DNA/Lead/aliases/concurrent imports/JWT cũ | Organization-integrity/repair, learning-security; startsAt/endsAt và history |
| Deadline đổi role/giảm hạn/gia hạn/publish | Shared-deadline/cycles; audit giữ lệch hiện tại, retry không cộng lặp |
| Tháng/cycle/replay/reset/no backpay/first term | Reward-pause/cycles/transfer; cuối tháng/năm nhuận/boundary/missing season |
| Tab/sidebar/logout/change account | Browser cache/sidebar; stale request/invalidation/identity |

Đây là ánh xạ phạm vi, không tuyên bố mọi QA case đã tự động hóa. Dashboard mẫu “Not Run”, prompt QA và kết quả phiên cũ đã bỏ để tránh nhầm với trạng thái hiện tại.

## Browser hai màn hình refactor

Sau `npm run build`, dùng `npm run test:refactor-browser` (`playwright.refactor.config.ts`). Suite có 7 smoke test desktop cho lưu course/session, upload fallback, quiz, draft, history, apply/cancel và countdown. Suite tự mở app loopback, chặn API bằng fixture, dùng URL DB không hợp lệ và không cần DB thật. Checklist nghiệm thu bổ sung:

1. **Course edit:** URL giữ nguyên, thông tin load/save, session/lesson add/edit/delete/reorder theo trạng thái cho phép, upload/confirm/progress/error/retry tài liệu, assessment/bank save/refresh. So payload, draft/publish guard, stale response và invalidation.
2. **Term transition:** roster/search/filter, tạo/sửa draft, Sheet parse/preview validation, effective time, cancel/confirm, history/countdown. Client không gửi apply khi countdown hết; GET backend hiện vẫn có thể apply đợt đến hạn (known-issues). Kiểm tra request cũ/error không mất/ghi đè draft và scope đúng Chapter.
3. Desktop/mobile, keyboard/focus, loading/empty/error, nhãn/layout trước/sau. Tách component không thêm thiết kế/tính năng.

Mock browser kiểm UI contract; ghi DB dùng integration riêng. SKIP/BLOCKED nếu thiếu engine/fixture/dịch vụ. Build/screenshot/PASS count không thay phần chưa chạy.

## Đọc kết quả

PASS chỉ lệnh vừa chạy trong phạm vi nêu rõ; không dùng lại 138/138 baseline như kết quả mới. FAIL phải phân biệt regression, fixture lỗi và audit nghiệp vụ. BLOCKED/NOT VERIFIED không là PASS. Sau di chuyển/xóa kiểm imports, npm entrypoints, doc links, SQL/bootstrap checksums; giữ `public/`, scheduler, storage prefix `docs/` và API payload.
