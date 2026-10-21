# Verification record — 22 October 2026

All mutations described here used disposable PostgreSQL databases bound to `127.0.0.1:55432`. Production was used only for the read-only course/organization metadata audit.

| Check | Result |
|---|---|
| `npm run test:business-rules` | 58 passed |
| `npm run test:learning-cycles` | 24 passed, including six Chapter pause boundary cases |
| `npm run test:baseline-safety` | 6 passed |
| `npx tsc --noEmit -p tsconfig.check.json` | Passed |
| `npx prisma validate` | Passed |
| `npm run build` | Passed, including page generation and type checks |
| `npm run test:learning-cycles-integration` | Passed on real PostgreSQL |
| `npm run test:reward-pause-integration` | Passed on real PostgreSQL |
| `npm run test:learning-security` | Passed against compiled local Next application |
| `npm run test:learning-flow-integration` | Passed against compiled local Next application |
| `npm run test:leaderboard-integration` | Passed against compiled local Next application |
| `npm run test:migration-rehearsal` | All three migrations passed from the baseline schema |
| `pg_dump -Fc` → separate database → `pg_restore --exit-on-error` | Passed; users=1, progress=1, ledger total=7, programs=4, targets=18 |
| `git diff --check` | Passed |

The cycle suites were also rerun sequentially with `TS_NODE_TRANSPILE_ONLY=true` after the independent TypeScript and production-build checks. They use actual database transactions and the same services; the flag only avoids repeated compiler work. Earlier runs with ts-node type checking also passed. The logged `SingleOrganizationAffiliationRequired` PostgreSQL error is an expected rejected write asserted by the test, not a suite failure.

## Transaction and API coverage

- Legacy progress and deadline evidence survives transition import; retry does not move a deadline.
- Manual/automatic concurrent submission, immutable grading/question evidence, reward high-water marks and replay idempotency.
- Viewing-session changes and disconnected heartbeat intervals cannot manufacture elapsed watch time.
- Actual transfer reset, cancelled old attempts, omitted roster members retained in Chapter, nullable President department, durable per-user synchronization, reset retry.
- Atomic Chapter → DNA conversion, including a legacy ChapterMember without a matching Chapter organization membership; current progress and stars retained.
- Delayed monthly closure uses observed historical role/account/affiliation states; KPI completion does not recompute saved stage facts; finalized month/term snapshots remain unchanged.
- Overdue Chapter learns without a video/quiz ledger. Scheduling does not lift the pause. Opening rewards or joining DNA does not repay consumed activities in the same month/cycle.
- DNA reset follows the fixed April/October boundary; late execution uses the actual database timestamp, keeps old cycle history, and retry does not reset twice.
- Cross-Chapter apply/cancel/department/bulk deactivation denied; member resource scope enforced; GET does not apply transfers; Admin policy and retry permissions enforced; cron authentication required; leaderboard responses omit email.
- 31-day inactive identity retirement preserves stars and prevents reactivation; failed outbox work can be repaired and requeued through the Admin API.
- Legacy learning-flow fixtures were updated to the existing final-bank version API, current progression error codes, idempotent submissions and published-course access. The test now proves a learner with restrictive legacy assignment flags can still learn, assess and earn on a published course. Fixture cleanup explicitly removes its test ledger instead of relying on user-delete cascade.
- Legacy Chapter-board fixtures now include an active lead and match the existing response/formula contract. This suite validates compatibility, while the new cycle suite validates the new formula and period snapshots.

## Browser checks

Used the local UI QA database with synthetic authentication/organization data and actual course title/ID metadata only. No production learner, credential, progress or ledger records were copied.

- Admin mapping: loaded all four programs and fourteen courses; changed a draft course classification, saved it, and verified the selected program/count persisted after the response and after navigation. Fixed stale client caching by loading this configuration without cache.
- Mobile viewport 390×844: the shared navigation collapses into a menu; the matrix uses expandable course cards with one common day budget and all 18 target checkboxes. Saved a Ban Định Hướng rule and verified it remained selected with no unsaved changes.
- Menu opens and closes on navigation. The temporary viewport override was reset after QA.

## Interpretation and remaining release work

These results support code review and an isolated migration rehearsal. They do not certify production deployment, a production-backup rehearsal, unspecified original A–J fixtures, all responsive pages on every device, or the exact original weighted 30→15 cohort timing example. See README release limitations and RUNBOOK for the required Admin classification/rule/position/season review and deployment steps. Cutover remains disabled.
