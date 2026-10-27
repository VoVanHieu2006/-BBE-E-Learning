# Completed lessons and Chapter ranking implementation record

## Baseline and scope

- Before SHA: `4f0248b9a73707628519f2c9477fd559beabb8ae`; initial working tree clean.
- HEAD at initial working-tree handoff: `4f0248b9a73707628519f2c9477fd559beabb8ae`. Publication was subsequently authorized on 2026-10-27; the implementation commit is recorded in Git history.
- Source of intent: the six-part implementation plan supplied by the user on 2026-10-26.
- Preserve video player, anti-seek, heartbeat/session transport, fullscreen, quiz randomization/scoring, deadlines, DNA resets, Guest/Admin/manager permissions, existing monthly score formula, three eligibility conditions and tiebreaks.

## Binding business decisions

- Successful application, not scheduling, ends the old learning cycle and starts/reset the next term.
- Vietnam transfer windows: March 1–April 30 and September 1–October 31. Chapters with a prior successful transfer pause video/quiz awards after March 31/September 30 until successful application; progress still records, suppression prevents backpay.
- First transfer obligation uses six calendar months at the opening of the window, to the second. Missing any time exempts the entire window.
- A Chapter with no successful transfer keeps earning stars until its first successful transfer, even when transfer is due. Never fabricate a transfer.
- Initial Chapters close competition results at March/September end without resetting learning/member stars. June–September and October–March are disjoint result periods.
- A September 10 transfer preserves stars earned afterwards in the new actual term across September 30.
- Actual term statistics span founding/latest successful transfer to next successful transfer, without inventing an official cross-period ranking.
- Official results use eligible closed monthly snapshots; open month is provisional. Missing snapshots/data are explicit, never silently rebuilt. Frozen snapshots remain immutable. Report legacy unallocated stars separately; avoid ledger double counting.
- Keep role-specific CHAPTER access policy; report discrepancies without widening access.
- Production reconciliation is READ ONLY only; previous Supabase attempt timed out with no SELECT results. No production backfill, policy activation, snapshot overwrite or deployment.

## Work and verification ledger

1. Baseline/fixtures: complete. Database-writing tests inspected; six-month suite now requires an explicit disposable loopback test database before loading Prisma.
2. Shared cycle-aware access model, API and UI: implemented. 14 logic cases and real MEMBER API fixtures PASS; browser C/direct URL/F5/A→B→A/unopened D PASS.
3. Initial term reward gate: implemented. Initial overdue obligations do not pause awards; real initial-term video/Quiz awards and duplicate protection PASS. Previously applied null-season reorganizations count as prior application evidence.
4. Scheduling/application/cancellation correctness: implemented. Immediate failure RED (HTTP 201) → GREEN (HTTP 409); atomic chapter locking/rechecks; current window validation; failed drafts retained; UI timeout/finally and refresh; concurrent scheduler/manual application resets once on real DB.
5. Official periods and actual-term statistics: implemented. Closed monthly snapshot allocation; provisional month separate; initial null-season intervals; actual term statistics without rank; successful transfer captures frozen statistics; missing history is explicit. Final checks recorded below.
6. Production reconciliation: BLOCKED by connection timeout (both sandbox and elevated read-only attempts; no SELECT results). Independent review and final regression verification complete; suite FAIL/BLOCKED/NOT VERIFIED results retained below.

Pre-flight: parts 2/3/4 consume the current learning cycle; only applied transfers may reset it. Parts 4/5 share actual application timestamps; result windows must not change learning cycles. Parts 3/5 distinguish initial terms with null season IDs.

Ruling: execute in the user-provided workspace and deliver an uncommitted diff, preserving the baseline and existing video work. The supplied plan has no separate reachable spec or numbered 14-case list; derive an explicit case matrix from its requirements and record actual coverage.

## Findings before implementation

- `checkLessonProgression` bypasses previous lessons only for `unlocked_at`, not current-cycle completion.
- Course detail and ProgramCourseTree independently infer a locked suffix after the first incomplete lesson.
- First-transfer eligibility currently pauses rewards after the boundary, contrary to the binding first-term exception.

## Evidence / unresolved verification

No production SELECT or application database mutation has been performed. Integration/browser/database checks and final results will be appended with PASS/FAIL/BLOCKED/NOT VERIFIED evidence.

## Environment and test safety

- PostgreSQL 18 was initialized in `scratch/chapter-fix-pgdata`, bound to `127.0.0.1:55439`, with disposable `bbe_test_learning_cycles`, `bbe_test_learning_flow`, and `bbe_test_leaderboard` databases. Production URLs were never used for test writes.
- Prisma schema engine needed sandbox escalation to spawn. Schema was pushed to a new empty local DB using the existing schema, then existing learning guard/catalog SQL applied. No repository schema or migration was changed.
- Attempting the existing migrations in lexical order failed because baseline assessments lack `lesson_id`; the failed empty schema was renamed `bbe_test_migration_partial` and preserved. No application database migration was attempted.
- Existing pure/business/video suites passed: business rules 66, playback guard 15, progress session 22, controls 11, YouTube UX 23, switching leak 9, player UI 23, formula/oracle 49, shared deadline 8 (226 tests).
- New logic checks PASS: completed lessons 14; Chapter month/term allocation 12; official period API 2; initial rewards 5; transfer response/retry/cancellation 3 (36 tests).
- Real database fixtures PASS: completed lessons + API + initial video/Quiz reward; reward suppression/no backpay/DNA reset; transfer scheduling/concurrency/idempotency and actual-term snapshots.
- Existing `test-learning-cycles-integration.cjs`: FAIL at line 110 (`SupplementalLearningRequirement` fixture not found). No unrelated supplemental/deadline implementation change made.
- Existing six-month suite: 18/20 PASS. T19 expects named production Chapters and T20 expects a specific production email/star total; both FAIL in the isolated test DB because that production data is intentionally absent. These are not evidence about production correctness.
- Production audit command: `node scripts/audit-chapter-ranking-readonly.cjs --configured`. Connection timeout before `BEGIN READ ONLY`; `selectsVerified:false`. No production reconciliation conclusion is available.

## Independent review and fixes

The fresh-context reviewer inspected the full uncommitted diff without edits/database writes. No Critical findings. Important findings were: September default switched to October's result interval too early; missing calendar-month rows were silently omitted; gaps/overlapping stages could undercount/double-count; missing saved eligibility metadata was treated as normal ineligibility. Each received an observed failing regression before correction and a passing rerun.

The reviewer also identified missing historical actual-term snapshots rendering as a blank star count. This was graded Important for acceptance because explicit missing-data reporting is a binding requirement; the UI now displays a missing-snapshot message. Malformed/null saved stages/rows are likewise reported as missing facts instead of crashing.

Ruling: the CHAPTER default season follows the latest April/October reward boundary, not the March/September transfer-window opening. Explicit season selection and actual-term statistics retain early-transfer visibility; September 10 rewards remain in the new actual term and the fall season's saved stage allocation.

Ruling: an incomplete historical total is shown with its data-missing reason and is excluded from official ranking until its evidence exists. No missing monthly or actual-term snapshot is silently reconstructed on read. Old finalized snapshots are never overwritten.

Ruling: actual Chapter statistics have no rank or official score. A successful transfer captures `statistics:CHAPTER:<termId>` atomically before the reset; historical actual terms without this data report missing snapshots. Existing individual-term snapshot behavior and DNA rules remain separate.

## Final Expected / Actual evidence

| Requirement | Expected | Actual |
| --- | --- | --- |
| A complete, B incomplete, C complete without unlock | C reviewable, D unopened denied | PASS: observed gate RED→GREEN; real MEMBER lesson API C=200/D=403; course/tree states agree |
| Video complete / Quiz not passed | Review video, do not pass Quiz or unlock next checkpoint | PASS: shared reader regression; Quiz permission uses `canAssess` |
| New cycle and legacy | Old completion does not open new cycle; no imports on read | PASS: real cycle reset fixture + unchanged completion record count after reads; legacy logic cases |
| Inserted lesson / F5 / rapid navigation | C stays open, no stale A→B→A state | PASS: real DB inserted lesson and Chromium on local production build; no page errors |
| Initial Chapter rewards | Keep earning until first applied transfer | PASS: real video=1 Star, Quiz=1 Star for one correct question under existing policy; exactly two ledger entries; due/one-second/calendar-month cases |
| Previously applied Chapter overdue | Record progress, suppress video/Quiz, never backpay | PASS: `test-reward-pause-integration.cjs`, including DNA transition/reset history |
| September 10 transfer | Rewards open immediately and survive October boundary | PASS: gate regression before October plus domain regression after October; saved September stages split 2+3 without duplication |
| Schedule / apply / retry / cancel | Schedule alone does not reset; one successful application only; failures explicit | PASS: real DB manual/scheduler race resets once; retry no-op; actual POST failed application=409; cancellation losing race=409 |
| Official Chapter totals | Closed eligible months only; open month separate | PASS: 12 aggregation regressions, 2 API regressions; June–September=8 and next October=2; no overlap |
| Actual term / zero Stars / legacy month null | Statistics without rank; zero Chapter retained; legacy missing allocation separate | PASS: real actual-term snapshots/current totals, zero Chapter API, null rank, legacy 3 Stars separate from 7 allocated Stars |
| Missing snapshots or metadata | Explicit missing state; frozen facts unchanged | PASS: missing month, stage gaps/overlap, missing eligibility, null/malformed rows, legacy unsplit partial month; historical actual-term missing notice implemented |
| Permissions | Existing CHAPTER role policy retained | PASS: MEMBER CHAPTER actual-statistics request=403; catalog hides CHAPTER/actual terms; Guest actual-statistics page renders. Existing role gates unchanged |
| TypeScript / build / diff | No compile/type/whitespace failures | PASS: `tsc --noEmit -p tsconfig.check.json --incremental false`; `npm run build`; `git diff --check` |
| Independent review | Findings addressed and verified | PASS: fresh-context review; regression fixes described above; no deferred review findings |
| Production SELECT reconciliation | Read-only provenance/month/cycle/Chapter/history/policy/snapshot evidence | BLOCKED: 8-second connection timeout, `timedOut:true`, `completedQueries:[]`, `selectsVerified:false` |

## Full-suite failures and limits (not hidden by build PASS)

- `npm run test:video-player-browser`: **91 PASS / 4 FAIL / 13 SKIP**, 18 minutes, across Chromium/WebKit desktop/touch. All four FAIL are the existing `theater escapes clipped/transformed ancestors ... (top layer)` case at `src/test/browser/video-player.spec.ts:409`, expecting JS property `popover="manual"` but receiving null. The player, fullscreen helper, regression page and global CSS have no diff in this task. No player behavior was changed to satisfy this assertion. Logs: `scratch/chapter-fix/video-player-browser.log`; traces/screenshots: `scratch/player-browser-results/`.
- `scripts/test-learning-flow-integration.mjs`: **FAIL** at line 255. Its Quiz-authoring fixture omits `durationMinutes`, which the existing authoring endpoint requires. Later assertions in this suite were **NOT VERIFIED**. Executed against an isolated real-route HTTP harness plus test DB, not production.
- `scripts/test-chapter-leaderboard-integration.mjs`: **FAIL** at line 202 (expects one eligible Chapter, receives zero). This suite seeds legacy progress/Stars without competition month/cycle provenance and expects the obsolete weighted score 29.1 with 20 members; the current unchanged monthly board requires >20 and uses stage A/N facts. A clean-DB rerun confirmed the failure. Later assertions were **NOT VERIFIED**.
- `scripts/test-learning-cycles-integration.cjs`: **FAIL** at line 110, missing supplemental fixture. Remaining cases in that suite were **NOT VERIFIED**.
- `src/test/chapter-six-month-transfer.test.ts`: **18 PASS / 2 FAIL** (T19/T20 require named real data absent from disposable DB). Production facts were not substituted with fixtures.
- The first optional browser check initially reloaded before navigation settled; its harness now waits for the lesson URL. The corrected test passed on dev and on the final local production build.
- Pre-fix evidence is an observed failing real progression-gate regression plus source tracing of the UI/API consumers. A live pre-fix HTTP/browser recording was **NOT VERIFIED**; post-fix real API and browser evidence is available. The supplied plan did not include the original numbered 14-case specification, so the recorded 14-case matrix is derived from its listed requirements.
- The first leaderboard integration attempt used a database cloned with cycle fixtures; it was preserved under a separate name and rerun against clean schema/catalog data. Both outcomes are recorded; no application DB was involved.

## Files and API compatibility

- Shared learning read model: `src/lib/lesson-learning-state.ts`, `src/lib/progression.ts`; read APIs `learning/me`, `courses/[courseId]/my-progress`, `lessons/[lessonId]/progress`; authenticated lesson detail and client caches now avoid stale personal access responses.
- Learning UI: `ProgramCourseTree`, student course list/detail, lesson sidebar and Quiz page use server access state. Added compatible fields: `learningCycleId`, `canView`, `canAssess`, `videoCompleted`, `lessonCompleted`, `unlocked`, `lockReason` (per lesson; `learning/me.lessonStates` keyed by lesson ID).
- Rewards: `src/lib/chapter-term-rules.ts`, `src/lib/chapter-reward-gate.ts`. Recent successful early-season applications open rewards immediately; a scheduled batch never qualifies.
- Transfer: `src/lib/chapter-reorganizations.ts`; Chapter reorganization collection/item APIs; current-roster pending error fields; term-transition UI with timeout, `finally`, synchronous action guard, retained failed draft and refresh.
- Reporting: `src/lib/chapter-term-results.ts`, `src/lib/chapter-actual-terms.ts`, `src/lib/competition-snapshots.ts`, `src/lib/period-leaderboard.ts`, learning-period catalog and `UnifiedLeaderboard`.
- Compatible opt-in statistics: `GET /api/v1/leaderboard?group=CHAPTER&periodType=ACTUAL_TERM[&chapterId=...][&periodId=<actual-term-id>]`; catalog adds `actualTerms`/`periodTypes`. Official `MONTH`/`TERM` remain defaults; existing role restrictions remain enforced.
- Tests/scripts: completed-lesson logic/API/browser fixtures; Chapter term/period/transfer regressions; local-only route integration harness; read-only audit; guarded six-month suite; prior-transfer suppression fixture updated to represent an old Chapter explicitly.

## Remaining risks and data requiring approval

- Production content/provenance, historical affiliation mappings, policy, seasons and snapshot completeness remain **NOT VERIFIED** because Supabase cannot be reached. No claim of production data correctness is made.
- Old closed actual terms may lack the new statistics snapshot. They show missing evidence; any historical backfill requires a separate source-checked, idempotent, approved data plan.
- Closed official snapshots lacking stage allocation/eligibility facts will show missing evidence rather than an invented historical score. No frozen snapshot was overwritten.
- Several existing suites remain FAIL as listed above. This delivery does not claim full acceptance or deployment readiness solely from build success.
- No production backfill, policy activation, schema change, formula change, permission widening, deployment, merge or push was performed. Test fixtures and evidence remain under ignored `scratch/` for inspection.
- Cleanup: local Next/HTTP test servers stopped. PostgreSQL fast shutdown stalled; an immediate shutdown of this task's exact scratch cluster completed successfully (`server stopped`). A later test restart may perform normal WAL recovery; committed test evidence/files are retained.

## Publication authorization — 2026-10-27

The user explicitly requested pushing this change to both configured `main` destinations:

- `https://github.com/VoVanHieu2006/-BBE-E-Learning.git`
- `https://github.com/bbetrainerteam-max/bbe_e_learning.git`

Both remote `main` tips were verified as the baseline SHA before publication. Publish the reviewed implementation and this report together using an ordinary fast-forward push. The FAIL/BLOCKED/NOT VERIFIED results above remain part of the handoff; publication does not change their status. No force push, production data operation, or manual deployment is included.
