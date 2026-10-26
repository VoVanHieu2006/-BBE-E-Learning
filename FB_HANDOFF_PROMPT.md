# Prompt bàn giao — tiếp tục FB-01–FB-08, bảo toàn P0

Bạn là AI tiếp quản workspace `C:\Users\Acer\Desktop\E-learning` trên Windows/PowerShell. Hãy tiếp tục triển khai và kiểm chứng kế hoạch dưới đây, không làm lại các phần đã có bằng chứng. Người dùng chủ động yêu cầu phiên trước dừng để bàn giao; công việc CHƯA hoàn tất. Không tuyên bố mọi test đã pass.

## 1. Nguồn ý định và giới hạn bắt buộc

Yêu cầu hiện hành là kế hoạch người dùng cung cấp: “Sửa FB-01–FB-08 và bảo toàn bản sửa video P0”. Kế hoạch này đã mở lại phạm vi FB trước đây bị hoãn; ghi chú ONLY MEMBER video trong `docs/feedback-implementation-progress.md` là lịch sử của phiên cũ, không phải giới hạn hiện hành.

- Đọc AGENTS.md; ưu tiên correctness/security, thay đổi nhỏ, giữ kiến trúc và business rules.
- HEAD vẫn `c6671286b2b9733cb48fb9b92c3ab67ab72f4509`, branch `main`. Chưa stage/commit/push/deploy.
- Làm tiếp tại workspace hiện tại theo lựa chọn đã ghi nhận từ trước. Không reset/clean/stash/revert các thay đổi đang có.
- Trước phiên này đã tồn tại patch P0 chưa commit: `src/components/YouTubePlayer.tsx`, `src/lib/video-playback-guard.ts`, `src/app/student/learning/[lessonId]/page.tsx`, `src/test/browser/video-player.spec.ts`, `package.json`; hai file UNTRACKED `src/lib/video-progress-session.ts`, `src/test/video-progress-session.test.ts`; báo cáo P0 và nhiều file load-tests/handbook. BẢO TOÀN.
- Phiên này không sửa YouTubePlayer hoặc guard. Chỉ mở rộng session transport theo ngoại lệ replay đã có bằng chứng; thêm UI metadata trong MEMBER page.
- Không production writes, schema changes, reward legacy activation, cutover, backpay, Prompt 2 Chapter mới hay đổi reward gate/position. Không đổi cadence/anti-seek/fullscreen/guard.
- Supabase theo audit trước có learning_policy 0 row, video 862s lifetime complete nhưng chưa có cycle/replay/ledger. Đây là bằng chứng phiên trước, KHÔNG phải audit mới của phiên này. Deployment Vercel chưa đối chiếu.
- Desktop/FB.docx là feedback gốc đã được xác nhận. Nguyên văn V01–V15 và 12 câu audit của prompt trước vẫn thiếu theo hồ sơ; không tự gắn số mới rồi nhận là bộ gốc.

## 2. Tài liệu và test cần đọc trước

- `docs/fb-fixes-progress.md`: ledger phiên này (chưa cập nhật hết kết quả cuối; prompt này mới hơn).
- `docs/feedback-implementation-progress.md`, `FEEDBACK_P0_FIX_REPORT.md`: baseline P0 và lỗi fullscreen đã biết.
- `docs/learning-upgrade/RUNBOOK.md`: quy trình Admin chuẩn bị/kích hoạt; chỉ hướng dẫn, chưa thực hiện.
- `scripts/test-fb-fixes.cjs`: suite API/DB mới, gọi route và writer thật; bắt buộc DB test riêng.
- `src/test/video-progress-session.test.ts`: 22 test transport, gồm 5 regression mới của phiên này.
- `src/test/browser/fb-feedback.spec.ts`, `playwright.fb.config.ts`: 4 browser test UI mới + chạy chọn lọc P0.
- `scratch/fb-fixes/*.log`: bằng chứng RED/GREEN/build/browser và integration.
- Graph đã tra cứu một lần, không cần rebuild. Graph query budget 1000 token tìm đúng modules, implementation dựa trên source đọc lại.

## 3. Những gì đã triển khai

### FB-04 — invitation

- `src/app/api/v1/invitations/route.ts`: nhận `kind=LEAD`, chỉ ADMIN; kind lạ 400; cache key chứa kind.
- `src/lib/invitations.ts`: lọc CHAPTER_LEADER/DNA_LEAD trong WHERE trước findMany/count/pagination, giữ query Member cũ.
- `src/app/admin/invitations/page.tsx`, `src/app/admin/layout.tsx`: fetch/prefetch LEAD; role label tường minh, role lạ hiển thị chính nó.
- 4 API/DB checks pass: query/count/paging; cache separation; permission/validation; accept MEMBER không promote + cancel cache invalidation.

### FB-02/06 — roster

- Thêm `listChapterLearners` trong `src/lib/chapter-members.ts`, giữ nguyên resolver account/history `listChapterMembers`.
- Chỉ MEMBER ACTIVE, dedup theo user, cùng asOf. Loại current DNA/foreign organization; ended/future memberships và affiliation history trái ngược chặn fallback legacy.
- Loại manager theo mã/position/quyền hiện hành. LT Ban và Chủ tịch vẫn là learner dù position is_manager=true; LT chỉ hợp lệ trong Chapter/Ban đúng scope.
- Dashboard members dùng full roster trước search/filter/pagination; summary giữ mẫu số đầy đủ, trả rosterAsOf. includeInactive không mở rộng current learner roster.
- Đổi consumer: dashboard courses, current-roster, organization units members; bỏ includeInactive=1 ở chapter-manager layout và members page.
- current-roster lọc bằng resolver mới, bỏ CHAPTER_MANAGER/is_manager làm LT và bỏ hardcode email demo. Không mặc định người đầu Ban là lead.
- 6 checks pass: fixture 2/13; ended/future legacy; search denominator; stale DNA/foreign index; LT đúng scope/giữ president.
- Fixture stale index dùng SET LOCAL session_replication_role=replica chỉ trong cluster test để mô phỏng import cũ; không sửa/xóa guard production.

### FB-05 — history

- `src/app/admin/users/[userId]/organization-history/page.tsx`: thêm cột loại từ unit.type, phân biệt CHAPTER/DEPARTMENT/DNA/DNA_GROUP, membership tương lai ghi chưa hiệu lực.
- API history vốn đã trả type nên không sửa API. Không xóa Chapter interval.
- API/DB check giữ nguyên history/count pass; browser typed-history pass.

### FB-01 — Quiz

- Đã tái hiện POST response thiếu durationMinutes làm frontend thay assessment thành object thiếu thời lượng.
- `src/app/api/v1/lessons/[lessonId]/assessment/route.ts`: trả durationMinutes, GET no-store, invalidate course/server/system-data cache sau transaction thành công, yêu cầu duration thực trong request.
- `src/app/api/v1/assessments/[assessmentId]/route.ts`: bỏ GET fallback 30.
- `src/app/admin/courses/[courseId]/edit/page.tsx`: bỏ fallback 30 cho assessment đã có, invalidate course/assessment client cache sau save. New form vẫn mặc định 30; existing thiếu giá trị hiển thị 0 để buộc cấu hình.
- Test POST 5 rồi 7 phút và GET/DB lại pass. CHƯA có browser thao tác form Quiz 5→7→refresh, cần bổ sung.

### FB-03 — điều kiện Chapter

- `src/lib/competition-ranking-rules.ts`: tính averageMemberCount độc lập với CORE dataError; giữ công thức score, thresholds/tiebreak. Thêm 3 structured conditions với value/threshold/operator/state/reasonCode, có MISSING_DATA.
- `src/lib/period-leaderboard.ts`: live month và live-season-month trả conditions, averageMemberCount, currentRosterCount, rosterAsOf/dataAsOf. Snapshot đã chốt trả theo đường cũ, không ghi lại.
- Mới `src/components/learning/ChapterConditions.tsx`; dùng ở UnifiedLeaderboard và PeriodLeaderboard. Hiện đủ 3 điều kiện. Sửa nhánh empty để vẫn hiện excluded Chapters khi không ai đủ điều kiện.
- Unit matrix 0/1/20/21, 49%/50%, các KPI/thiếu CORE pass.
- DB test denominator chỉ published CORE, loại EXTENDED và draft pass. Chưa đủ DB matrix 69.99%/70%, cả 3 chương trình, historical publication/version/time cases.
- Closed snapshot missing/immutability test pass. Browser tất cả Chapter excluded vẫn hiện ba điều kiện pass.

### FB-07 — replay/reward/P0 transport

- Mới `src/lib/learning-readiness-rules.ts` (messages/pure policy readiness), `src/lib/learning-readiness.ts` (read-only reader).
- `src/lib/video-heartbeat.ts`: PATCH thêm progressContext {learningCycleId, competitionMonthId, monthlyReplayRequired}; replay trả identity; lifetime/cycleProgress riêng; rewardStatus/reasonCode. Cập nhật suppression response ngay lần bị suppress. Không thay reward keys, gate, legacy logic hoặc công thức sao.
- `src/app/api/v1/lessons/[lessonId]/progress/route.ts`: GET trả metadata trên, lấy video duration kể cả chưa có progress, no-store, lý do thưởng theo policy/cycle/month/replay/ledger/gate. GET không tạo cycle/month.
- MEMBER page lưu metadata sau PATCH, không gọi lifetime completion là hoàn thành chu kỳ khi chưa có cycle; hiện backend reward reason.
- `src/lib/video-progress-session.ts`: coalescing floor chỉ từ ACK đã guard chấp nhận. Replay bắt buộc dùng min(training, replay) với identities khớp; không dùng in-flight/queued checkpoints làm evidence; reset floor khi cycle/month đổi. Giữ unacknowledged heartbeats và ENDED.
- 5 regression session mới: training862/replay100 giữ checkpoint108; in-flight failure; replay108→118/128/138; đổi cycle; đổi month. Tổng session 22/22 pass.
- Cập nhật một expectation cũ [1,3,4,6] thành [1,2,3,4,5,6] vì yêu cầu mới giữ playback chưa ACK; latency compact sau ACK vẫn pass.
- Writer DB thật pass: 862s→14 sao; concurrent retries/refresh ledger1; fake ENDED không thưởng; cycle complete/new replay0; previous-month replay riêng; suppression rồi mở gate không cộng bù.

### FB-08 — readiness/scope

- `src/lib/affiliation-access.ts`: `currentLearningAffiliation` dùng current org evidence trước legacy ChapterMember, chặn fallback trái history. Không sửa resolver authorization chung.
- Catalog `src/app/api/v1/learning/periods/route.ts` và board `src/lib/period-leaderboard.ts` dùng helper này cho regular MEMBER. Bỏ fallback manager scope thiếu permission từ context.chapterId.
- Shared policy readiness phân biệt POLICY_MISSING/MAPPING_NOT_APPROVED/CUTOVER_NOT_SET/CUTOVER_FUTURE; board thiếu period trả MONTH/TERM/SEASON_NOT_CONFIGURED; closed missing snapshot trả SNAPSHOT_MISSING.
- Catalog trả readiness và nested periods readiness; UI hiện backend message.
- 8 readiness/snapshot API checks pass, stale DNA catalog/board scope pass. Không khởi tạo kỳ hoặc policy từ GET.
- Chưa hoàn thiện report/runbook dẫn quy trình khởi tạo; phải ghi rõ audit trước: targets chưa có, season/term chưa có, preflight coi hai CHAPTER_MANAGER hợp lệ là ambiguous. Không tự bỏ gate/đổi position.

## 4. DB test và chạy lệnh an toàn

Cluster mới: `scratch/fb-fixes/pg-data`, PostgreSQL 18, listen `127.0.0.1:55438`, test-only role `fb_test`, trust local. DB chính test `fb_fixes_test`. Không fallback .env.

```powershell
$env:FB_TEST_DATABASE_URL='postgresql://fb_test@127.0.0.1:55438/fb_fixes_test'
npm run test:fb-fixes
# Có thể chọn: node scripts/test-fb-fixes.cjs invitations|roster|quiz|rules|leaderboard|readiness|video|history
```

Runner kiểm tra hostname/port/database/data_directory trước fixture writes. Không dùng URL ứng dụng cho tests.

- Bootstrap dùng cơ chế baseline hiện có. Forward migration gặp hai lỗi order có sẵn: profile_quiz_configuration cần learning_governance trước; lead_binding_guards cần organization_integrity trước.
- Recovery chỉ trên test cluster bằng `scratch/fb-fixes/finish-test-bootstrap.cjs` (guard cứng DB/data_directory), ghi history với checksum nguyên bản. Không sửa repository migrations.
- pg_ctl/initdb restricted-token launch báo lỗi sandbox; initdb đã tạo cluster, postgres được Start-Process hidden trực tiếp. Cluster có thể còn chạy; kiểm tra pg_isready 127.0.0.1:55438. Không restart service có sẵn.
- Thêm DB rỗng `bbe_test_learning_cycles` cùng cluster, clone schema-only từ test DB để chạy existing suites. Không có production data.
- Một số command spawn worker/browser cần require_escalated do EPERM. Auto-review đã CHẤP THUẬN các lệnh test/build, không có rejection cần hỏi lại user.

## 5. Kết quả kiểm chứng hiện có

PASS đã xác nhận:

- `scratch/fb-fixes/all-integration.log`: 22/22 trước khi bổ sung 5 checks mới. Sau đó standalone leaderboard 1/1 và readiness 8/8 pass. CẦN chạy lại toàn bộ latest suite, chưa có consolidated 27/27.
- Business-rules 66; guard15; session22; controls11; youtube-ux23; switching9; player-ui23; learning-cycles24; formula-audit49; shared-deadline8; baseline-safety6; continuity-security10; learning-flow-p0 12 — đều pass (một số suite overlap, đừng cộng thành distinct tests).
- TypeScript `node node_modules/typescript/bin/tsc --noEmit --incremental false`: exit0 (`scratch/fb-fixes/tsc.log`).
- `npm run build`: exit0 (`scratch/fb-fixes/build.log`). Explicit DATABASE_URL/DIRECT_URL test + fixture JWT secret, không dùng DB production.
- Existing reward-pause integration PASS, log `scratch/fb-fixes/reward-pause.log`.
- git diff --check sạch, chỉ notice CRLF ở browser spec cũ.

FAIL/chưa giải quyết:

1. Browser mới nhất `scratch/fb-fixes/browser.log`: **9 passed, 2 failed** (production local Chromium).
   - 4 browser FB04/05/03/08 PASS.
   - P0 DOM100-seek 1x/1.5x/2x, duplicate PLAYING, ENDED switching PASS.
   - FAIL `P0: MEMBER page uses DB video identity, rejects wrong-video completion, and restores synthetic progress on refresh` (video-player.spec.ts:193): locator `/100\/713s/` không còn thấy. Có khả năng fixture chưa trả lifetime/cycleProgress mới trong khi UI vừa chuyển nhãn sang lịch sử; CHƯA điều tra xác nhận. Cần sửa đúng fixture/contract hoặc code nếu có regression, không bỏ assertion để pass. Trace/screenshot trong `scratch/fb-fixes/browser-results/`.
   - FAIL `theater escapes clipped/transformed ancestors, preserves iframe, rotates and exits (top layer)` (line404, assertion418): popover expected manual received null. Đã biết từ baseline, ngoài phạm vi; giữ riêng, không refactor fullscreen.
2. Existing `scripts/test-learning-cycles-integration.cjs`: FAIL ở line110, `SupplementalLearningRequirement.findFirstOrThrow`, P2025 không có record. Log `scratch/fb-fixes/cycles-integration.log`. Chưa điều tra root cause, chưa kết luận do patch hay baseline.
   - Trước đó suite fail assertion31sec disconnected: HEAD/current MAX_HEARTBEAT_GAP_SECONDS đều300. Chỉ sửa fixture timestamp31_000→301_000 để kiểm tra ngoài cap hiện có, KHÔNG đổi guard. Suite qua đoạn này rồi fail supplemental phía sau. Ghi quyết định vào ledger/report; không che lỗi tiếp theo.
3. Chưa browser Quiz save/refresh; chưa full WebKit/mobile trong phiên này; chưa browser live DB/real YouTube.
4. Chưa chạy independent final review. Skill executing-plans/requesting-code-review yêu cầu MỘT reviewer fresh context ở cuối, ưu tiên quyền/replay/final diff. Không cần implementer subagents cho từng nhóm.
5. **Chưa tạo `FB_FIX_REPORT.md`**.
6. V01–V15 nguyên văn BLOCKED theo hồ sơ thiếu định nghĩa, không bịa. Vercel/production fixes NOT VERIFIED.

Browser command đã chạy xong, log đã có summary; server Playwright thường tự stop nhưng hãy kiểm tra trước khi chạy lại. PostgreSQL test có thể còn chạy.

## 6. Việc tiếp theo, theo thứ tự

1. Kiểm tra git status, đọc ledger và các đoạn source/test liên quan. Không overwrite thay đổi hiện có.
2. Điều tra failure MEMBER browser: fixture cũ thiếu new metadata hay UI đánh mất state? Tạo regression phản ánh hợp đồng thật, sửa nhỏ và rerun. Bổ sung browser Quiz5→7→refresh/cache.
3. Điều tra P2025 existing cycles suite ở supplemental requirement bằng source liên quan; phân biệt baseline/spec mismatch với regression. Không đổi deadline formula/business rules ngoài scope để làm xanh test.
4. Rà lại roster evidence precedence, ended Chapter intervals/current membership conflict, scope LT, manager authorization và aggregation at asOf. Đặc biệt kết quả live metadata và period cohort là hai khái niệm phải hiển thị riêng.
5. Rà readiness catalog top-level/nested term/season/snapshot theo scope; không manufacture periods trong GET. Rà history UI đủ loại và giữ dòng Chapter.
6. Bổ sung thiếu matrix69.99/70, cả3 CORE, historical publication/version, replay identities missing/mismatch, timeout/reorder/cycle/month boundaries nếu coverage chưa đủ. Đừng viết tests source-string/mirror implementation.
7. Chạy latest `test:fb-fixes` toàn bộ (hiện định nghĩa27 checks, chưa consolidated). Có thể cần làm fixture leaderboard idempotent hơn nếu chạy sau lần test dở; test hiện unmap program của fixture ở cuối, nhưng failed run có thể để CORE fixture tồn tại. Chỉ sửa/cleanup đúng test DB với guard.
8. Rerun suites phù hợp sau last fix, TypeScript/build, browser trọng điểm. Giữ known fullscreen FAIL riêng, không tuyên bố toàn suite xanh nếu còn P2025.
9. Independent read-only final reviewer (một agent được skill yêu cầu; không giao các implementer mới). Cung cấp plan/ledger/diff workspace, đặc biệt UNTRACKED session file và pre-existing P0 ownership, không chỉ git diff HEAD.
10. Tạo `FB_FIX_REPORT.md` với audit từng FB, root cause, trước/sau, files, API/DB/browser evidence, PASS/FAIL/BLOCKED/NOT VERIFIED, V01–V15 nguyên văn thiếu, hướng dẫn nghiệm thu Admin/Lead Chapter/MEMBER.
11. Hướng dẫn production initialization theo Admin learning-policy API + runbook, ghi blockers audit trước (policy0/targets/term/season/CHAPTER_MANAGER ambiguous), cần kế hoạch duyệt riêng cho production data/history/Prompt2. Không tự kích hoạt.
12. Báo người dùng bằng tiếng Việt, ngắn, link report và nêu rõ tồn đọng. Không stage/commit/deploy khi chưa được yêu cầu.

Lưu ý cuối: người dùng đang yêu cầu tiếp tục từ bàn giao, không muốn phải xác nhận lại routine edits/tests đã được ủy quyền. Làm tiếp tự chủ trong phạm vi; chỉ hỏi khi thực sự thiếu thông tin bắt buộc hoặc thao tác destructive/production.
