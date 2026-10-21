# BBE learning cycles — implementation and release review

Baseline: `58b8472f2b3e08bb213a1c97b9322d3574268981`. Branch: `feat/learning-cycles-rewards`.

This is a reviewable implementation. Production has only been read in a read-only transaction. Neither migrations nor cutover have been applied to production. Course classification proposals are not approvals.

## Requirement coverage

| Requirement group | Implementation | Verification |
|---|---|---|
| UTC+7 months, shortened first official month, learning cycles and terms | `learning-cycle-rules`, `learning-periods`, additive schema | Unit month boundaries; migration rehearsal |
| Monthly video replay independent of training | `video-heartbeat`, viewing session UUID, bounded heartbeat intervals, cycle progress | Real PostgreSQL integration: replay, long disconnection, session rotation |
| One quiz reward policy | `quiz-submission` shared by manual and automatic submissions; immutable question/grading snapshots; transactional high-water marks | Concurrent submissions, retry, bank changes, cancelled old-cycle attempts |
| Progression and retained access | `progression`, `learning-unlocks`, cycle-aware completion | Existing business rules and learning-cycle integration |
| Organization transitions | `organization-transition`, scoped department mutations, deferred single-affiliation constraint | Chapter → DNA retains cycle/history; direct dual affiliation rejected |
| Transfers | Atomic pre-reset snapshot and reset; season uniqueness; omitted people retain Chapter; President is Chapter position; durable per-person outbox | Transaction/retry integration, cancelled attempts, omitted roster |
| Personal and Chapter rankings | Four groups × month/term; role/account/affiliation/publication histories; staged Chapter formula; saved closed snapshots; pending KPI completion | Unit formula/tie-break rules; delayed close, historical eligibility, immutable month/term integration |
| Four programs and 18 targets | Canonical catalog, Admin mapping screen, responsive mandatory matrix, program course tree | Read-only actual-course audit; UI review |
| Shared deadlines | Cycle path and budget/change history, legacy deadline floor, stable retry, completed-course recognition, removal/reduced-budget grace | Unit examples and transactional reconciliation |
| Published course updates | Requirement snapshots, supplemental obligations and notices, batched lesson additions with extra time | Publish/retry integration |
| Deactivation and retention | Immediate account-state history; 30-day identity tombstone, retained results/ledger/snapshots; credential removal | HTTP security/retirement regression |
| Scheduler and recovery | Independent minute scheduler, expected/actual timestamps, outbox retry/backoff, persisted transfer failure | Integration and HTTP scheduler authorization tests |
| Authorization | Resource scope on transfer apply/cancel/department/bulk deactivation; no read-side transfers; no leaderboard emails | HTTP security regression |

The original numbered 1–41 prompt and complete A–J fixture definitions were not supplied in this implementation context. This table maps the requirement groups present in the approved plan; it does not claim a reconstructed 41-item acceptance audit.

## Data and API changes

Migrations are additive and transactional:

1. `20261021_learning_cycles`: period/cycle/reward/path/content/snapshot/outbox models, nullable compatibility columns and historical FK protection.
2. `20261022_learning_guards`: canonical catalogs, partial uniqueness, checks, observed account/affiliation/publication history triggers, President position and deferred single-affiliation constraints.
3. `20261022_reward_pause`: unique season boundary restricted to April/October midnight in Vietnam, and explicit suppressed-video reward evidence.

Legacy timestamp columns retain their representation. The audited database session timezone was UTC; no conversion to `timestamptz` and no inferred historical term assignment were performed. Existing stars retain `LEGACY` provenance. Legacy progress is imported into a transition cycle without resetting it; imported deadline evidence remains recorded.

New read/configuration routes include `/api/v1/learning/me`, `/api/v1/learning/periods`, and `/api/v1/admin/learning-policy`. Existing leaderboard routes accept the new period/group parameters. New closed rankings use persisted snapshots. The Admin mapping UI is `/admin/learning-policy`; mandatory targets are configured at `/admin/courses/mandatory`.

The monthly high-water reward configuration freezes at the first attempt in that month/cycle. Attempts store selected question contents and grading parameters. A reset cancels active old-cycle attempts with a reason. Reward timestamps are sampled from the database after locking the relevant scope.

Chapter rewards pause at 00:00 on April 1 / October 1 Vietnam time if the corresponding season has no successful application. Scheduling does not lift the pause. The backend still records learning progress, consumes the paused quiz high-water opportunity and marks paused video completion as suppressed, without creating a ledger entry. Opening rewards or moving to DNA cannot claim these suppressed activities in the same month/cycle. A successful training reset creates a new cycle in which fresh learning may earn normally. DNA independently resets at the fixed April/October boundary, using actual execution time if the scheduler is late. A missing season configuration fails closed and is visible in the reward read model.

## Classification review

See [mapping-proposals.md](mapping-proposals.md) for the actual 14 courses (12 published), IDs, proposed programs and reasons. All proposals require review. The intended 8/8/4 core curriculum cannot be inferred from this catalog and is not fabricated. The Admin must inspect content and approve the classification of every published course before the new 70% formula is activated. Extended courses never enter its denominator.

## Release gates and limitations

- Keep `LEARNING_CUTOVER_ENABLED` unset or `false` until classification, legacy rules/aliases, season dates and operational checks have been reviewed. Production remains on the legacy policy before cutover.
- Review existing mandatory rules against the 18 canonical targets. Legacy scope rules remain compatible and are not silently deleted or guessed into new targets. The matrix can update matching scopes; old rules outside those scopes require explicit Admin review. Scheduling cutover rejects unreviewed rules, unclassified published courses, ambiguous `CHAPTER_MANAGER` appointments and missing current season configuration.
- The published lesson-bank authoring API still enforces its existing immutable-used-bank restriction. Started attempts are protected by snapshots; a complete version-authoring UI for every legacy lesson bank is outside this patch.
- Supplemental obligations cover published lesson additions. Video replacement and arbitrary edits of existing lesson content do not automatically create a new supplemental obligation.
- Legacy leaderboard views remain available alongside the new period rankings. Old historical records without temporal evidence are not retroactively reclassified.
- The standalone scheduler must be provisioned to obtain minute cadence. Daily Vercel fallback crons are not a substitute for it.
- The exact original 30 → 15 example's average `22.30` and rate `50.56%` require its full timing/cohort fixtures. Tests verify the six-point formula and an explicit equal-duration fixture, without substituting invented dates for that acceptance case.

See [RUNBOOK.md](RUNBOOK.md) for migration, activation and recovery steps. Validation results are recorded in [VERIFICATION.md](VERIFICATION.md).
