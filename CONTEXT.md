
CONTEXT THREAD — BBE E-Learning Upgrade

Project location:
C:\Users\Acer\Desktop\E-learning

Latest implementation progress (2026-10-11):

- Admin member detail now has a dedicated `chapterId=all` scope for MEMBER accounts without a legacy Chapter link. The endpoint accepts this scope only for an authenticated ADMIN; scoped managers still require a real Chapter permission and membership. Admin's user page falls back to this scope when the row has no Chapter.
- The course-students progress endpoint now authorizes non-Admin callers through `VIEW_MEMBER_PROGRESS` scoped to actual Chapters. It unions active legacy `ChapterMember` records with active `OrganizationMembership` records in the authorized Chapter/Department subtrees, so Ban members are included without exposing other Chapters. Admin now also sees learners assigned to a course before they start, in addition to learners with existing lesson progress. `listAccessibleChapterIds` is shared with the `/chapters/me` resolver.
- Chapter member list and both Chapter dashboard APIs now use shared `listChapterMembers`, which merges active OrganizationMembership from the Chapter/Department subtree with legacy ChapterMember data, deduplicates users and retains the earliest join date. This fixes Chapter roster and progress totals for Department members.
- Chapter KPI GET now uses the scoped `VIEW_MEMBER_PROGRESS` permission (including legacy BĐHU compatibility); KPI PUT remains restricted to ADMIN.
- After these progress-access changes, `npm run test:business-rules` passes all 20 tests, `npx tsc --noEmit` passes, and `git diff --check` passes. The optimized production build compiles and generates all 52 static pages. No DB migration was needed for these endpoint/UI changes.
- The sandboxed read-only `npx prisma migrate status` initially could not download the Windows schema-engine checksum (`ECONNREFUSED 127.0.0.1:9`). A later read-only retry with subprocess/network permission succeeded; current migration status is recorded below. No migration was applied in that check.
- Quiz question pools now fail closed: an attempt only starts when a configured quiz has exactly five pools, every question maps to one of them, and each pool has at least three questions. Attempts select exactly three questions per pool using a cryptographically shuffled selection, and reuse that exact question order for both persistence and the response. Truly legacy assessments with no pool configuration retain their existing behavior.
- Admin pool-remapping API now requires a complete, unique question-to-pool mapping, validates it before writes, rejects edits after attempts exist, and updates all mappings transactionally. The existing course editor already has the pool assignment UI; no duplicate pool screen was added.
- Admin can now revoke a Position permission from the organization page. The API deletes the grant transactionally, writes an AuditLog entry, and permission enforcement reflects the revocation immediately.
- Admin can reparent Organization Units. DNA and Chapter remain separate Root branches; Department must belong directly to a Chapter; Root cannot be nested. The API prevents cycles, records hierarchy changes in AuditLog, reconciles learning assignments for active members/position holders in the moved subtree, and uses a serializable transaction to detect concurrent structural edits.
- The organization page now renders an indented preorder tree; orphaned/cyclic legacy rows remain visible without hanging the UI.
- Quiz `forceNew` no longer cancels a learner's active attempt before validating the question bank; cancellation now happens only inside the transaction that creates the replacement attempt. Answer options are randomized with the same cryptographically unbiased shuffle helper as questions.
- `npm run test:business-rules` now passes 19 tests, including safe hierarchy moves/cycle prevention/tree rendering, pool selection, and malformed/duplicate/missing/out-of-range pool mappings.
- This continuation extracted strict video completion and anti-seek limits into shared, pure business-rule helpers. The attempt-start endpoint no longer accepts the old 2-second tolerance; it now requires the full known video duration.
- Manual and automatic quiz submission now use the same configurable 85% pass threshold and shared Star-band calculation. A unit test exposed and fixed a floating-point boundary bug that under-awarded the 95% quiz band.
- Learning rules that combine an organization and a position are now scoped to that unit's descendant tree in both reconciliation and materialization; a leader assignment in another Chapter can no longer grant the rule. Position appointments are also rejected when Position scope and Organization Unit type disagree.
- Admin organization UI now lists up to 200 position tenures and allows an Admin to end an active tenure. Ending is conditional/transactional, writes an audit event, retains history, and reconciles that user's learning assignments. New appointments are created atomically with primary-tenure rollover and an audit event.
- Added `npm run test:business-rules` with nineteen passing tests covering strict video progress, Star rules, organization/position scope, safe hierarchy moves/tree rendering, and quiz-pool selection/mapping validation.
- `npx tsc --noEmit -p tsconfig.check.json`, `git diff --check`, all 19 business-rule tests and the production build pass after the latest organization-tree changes. Production build generated all 52 static pages.
- At that attempt, Prisma could not download its Windows schema-engine checksum (`ECONNREFUSED 127.0.0.1:9`); no database migration was applied. A later read-only retry with subprocess/network permission succeeded and confirmed the strict migration remains pending.
- Chapter manager member UI now respects per-Chapter MANAGE_CHAPTER_MEMBERS scope; users with view-only access retain progress details but do not see invite, disable or remove actions.
- Scoped managers can only disable an active ordinary member. Inactive/locked accounts cannot be reactivated by managers; activation remains Admin-only.
- Removing a member now ends OrganizationMembership and position assignments in the Chapter subtree, retains their history, writes an audit event, and reconciles learning assignments in the same transaction.
- Member-list filtering now combines status, search and role instead of one filter overwriting another.
- Video completion and unlock checks now require the full configured duration. The client establishes a playback timestamp at play start; the API no longer grants 25 free seconds per heartbeat and limits progress to elapsed time at the fastest supported 2x playback rate.
- Added a follow-up data migration to revoke invalid legacy video Stars with compensating ledger entries and reopen course assignments/completions below 100%. This new migration has NOT been applied to the database yet.
- Chapter manager's member detail now shows total Stars, per-video and per-quiz Stars, attempt number/count and latest result; the detail API supports active organization membership as well as legacy ChapterMember records.
- Old `leaderboardPoint = 40% completion + 60% quiz` calculation and its API fields have been removed. Individual standings now rank by Star, then completion and quiz score; Chapter standings use the new /100 score and the public/Admin UIs show breakdowns and exclusion reasons.
- Chapter eligibility/completion now uses active members from legacy ChapterMember or the Chapter/Department organization tree, and calculates completion against each member's active mandatory course assignments (not all system courses). Missing mandatory assignments count as 0% until backfill/materialization is fixed.
- TypeScript check, Next.js lint/type validation, production compilation and static-page generation pass. The first sandboxed build was blocked by worker spawning (EPERM); the build succeeded when run with subprocess permission.
- A narrow Node/ts-node unit test script now exists for shared video/Star rules. No database-backed integration or browser/E2E suite was run.

Environment:

- Windows / PowerShell
- Next.js 14 + React 18 + TypeScript
- Prisma 6.19.3
- PostgreSQL on Supabase
- Tailwind CSS
- Existing R2/S3-compatible document storage
- Cloudinary credentials have now been added to .env:
  - NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME
  - CLOUDINARY_API_KEY
  - CLOUDINARY_API_SECRET
- No secrets were read or exposed.

Original business objective:
Upgrade the e-learning system comprehensively, not only UI:

1. Admin/BĐHU member learning-progress detail.
2. Video completion only at 100%, with anti-seek bypass controls.
3. Redesigned public landing page and course cover images.
4. Replace old competition points with Star system.
5. Repair Quiz/Test state, attempts, submissions, retry and rewards.
6. Enforce strict learning order server-side.
7. Replace rigid roles with RBAC + Organization + Position Assignment + Learning Rules.
8. Deadline-driven account locking; Admin-only unlock.
9. New fair Chapter leaderboard based on learning distribution, Star, KPI and chapter size.

Business decisions confirmed by user:

- Cloudinary selected for course-cover storage.
- Overdue mandatory learning locks the whole account.
- Current data is non-production; seeding/backfill is permitted.
- One primary BĐHU per Chapter.
- Disabling primary BĐHU should lock accounts belonging to that Chapter.
- Normal members who can only view LT content do not receive Stars and cannot assess/certify LT-only content.
- Quiz question pools: 5 pools per module/lesson; each attempt should take 3 questions per pool if configured.
- Course/final-question-bank idea: distribute questions evenly across lessons; this has not been fully implemented because current data model remains lesson-level Assessment.
- PDF reviewed: “BBE - TH cam nang cac ban - BH05.2024 v08.pdf”.
  Important PDF findings:
  - Chapter/BĐH/BĐHU/DNA terminology and hierarchy.
  - Training/handbook assessment rules.
  - Existing pass threshold discussed in handbook around 80%, while current application logic still uses 85% quiz pass threshold.
  - DNA and Chapter operating distinctions.
  - Reward/recognition context.
- No explicit request was given to change quiz passing threshold from the existing 85%; therefore 85% remains for quizzes.

Initial source audit:

- Existing model:
  - User roles: ADMIN, CHAPTER_LEADER, MEMBER.
  - Course → Session → Lesson → Video.
  - Assessment is attached to a Lesson.
  - Progress records are stored in LessonProgress.
  - Existing completion logic used approximately 85%.
  - Existing roles were hard-coded in many API routes and frontend conditions.
- Existing security/business issues found:
  - Video completion was 85%, not 100%.
  - Some staff roles bypassed video/progression rules.
  - Frontend could unlock quiz at 85%.
  - Progress logic had seek-ahead weaknesses.
  - Attempt cancellation had an ownership/auth issue.
  - Answer submission did not adequately guarantee selected option belonged to the question.
  - Submit payload could include invalid question/option combinations.
  - Attempt question order and response question order could differ because two separate randomizations were performed.
  - Editing an Assessment deleted questions that could destroy historical attempt details.
  - Quiz state / stale answer work was already partially modified by pre-existing user changes.
  - Legacy role checks remain in several APIs/UI areas; they have not all been migrated to Position/Permission checks.

Existing dirty changes before this work:
These were already modified before implementation and were preserved:

- src/app/api/v1/assessments/[assessmentId]/attempts/route.ts
- src/app/student/learning/[lessonId]/page.tsx
- src/app/student/learning/[lessonId]/quiz/page.tsx
- src/components/YouTubePlayer.tsx
- src/components/lesson/LessonQuiz.tsx

Architecture chosen:
RBAC + Organization Structure + Position Assignment + Learning Rules.

Core concepts:

- OrganizationUnit:
  - ROOT
  - DNA
  - CHAPTER
  - DEPARTMENT
  - Supports parent/child hierarchy.
- OrganizationMembership:
  - User membership in OrganizationUnit.
  - Active/inactive time range.
- Position:
  - Platform, DNA, Chapter, Department scope.
  - Not permanently attached to User.
- PositionAssignment:
  - User + Position + Unit + starts_at + ends_at + is_primary.
  - Supports six-month LT/BĐHU/DNA manager tenures and history.
- Permission:
  - Position receives permissions through PositionPermission.
- LearningRule:
  - Maps Course to Organization Unit and/or Position.
  - Controls mandatory, can_view, can_assess, can_earn_stars, effective period and due_days.
- UserLearningAssignment:
  - Materialized per-user assignment.
  - Allows historical records, deadlines, course access and rewards to remain stable.
- AccessRestriction:
  - Direct Admin restriction.
  - Deadline restriction.
  - Chapter cascade restriction.
- StarLedger:
  - Immutable, idempotent reward ledger.
  - reward_key is unique to prevent repeat rewards.
- QuestionPool:
  - Five-pool design for module quiz bank.
- ChapterMonthlyKpi:
  - Monthly Red / Yellow / Green KPI state.

Star formula implemented:
Video:

- Under 2 minutes: 0 Star.
- At least 2 minutes: ceil(durationMinutes / 3).
- Minimum 1 Star.
- Maximum 5 Stars per video.
- This caps reward farming from very long videos.
- Reward key format includes user and video, so a video can only reward once.

Quiz:

- Passing quiz: 2 Stars.
- Bonus: up to 3 extra Stars for score above 85%.
- Bonus formula:
  floor((scoreRatio - 0.85) / 0.05), clamped 0 to 3.
- Example:
  - 85%–89%: 2 Stars.
  - 90%–94%: 3 Stars.
  - 95%–99%: 4 Stars.
  - 100%: 5 Stars.
- Quiz Star rewards are idempotent using:
  - module-quiz-pass:userId:assessmentId
  - module-quiz-bonus:userId:assessmentId
- Viewer-only LT content is supported through can_assess=false and can_earn_stars=false in LearningRule/UserLearningAssignment.

Leaderboard formula implemented in:
src/app/api/v1/leaderboard/chapters/route.ts

Eligibility:

- Active Chapter only.
- DNA does not participate because query only reads Chapter records.
- Minimum 20 active MEMBER users.
- At least 50% of members must have overall learning completion >=70%.
- KPI RED excludes Chapter.
- KPI YELLOW is eligible but no KPI bonus.
- KPI GREEN adds 20 points.

Scoring:

- Completion score:
  - 45% average completion.
  - 35% median completion.
  - 20% rate of members at >=70%.
- Star score:
  - Average Stars per member.
  - Normalized against 90th percentile-like baseline among eligible Chapters only.
  - Capped at 100.
- Size score:
  - sqrt(memberCount) / sqrt(50) * 100.
  - Capped at 100.
- Final:
  - CompletionScore * 0.40
  - StarScore * 0.25
  - SizeScore * 0.15
  - KPI Green bonus +20
- This differs intentionally from original proposed 30/30/20/20 because learning distribution was given more weight.

Database/schema changes:
Modified:

- prisma/schema.prisma
- prisma/migrations/20261010_learning_organization_star/migration.sql

Added enums:

- OrganizationUnitType
- OrganizationMembershipStatus
- PositionScope
- LearningAssignmentStatus
- RestrictionType
- KpiStatus
- StarReason

Added/changed fields:

- User.auth_version
- Chapter.organization_unit_id
- Course.cover_url
- Course.cover_public_id
- Question.pool_id
- LearningRule.due_days

Added models:

- OrganizationUnit
- OrganizationMembership
- Position
- Permission
- PositionPermission
- PositionAssignment
- LearningRule
- UserLearningAssignment
- AccessRestriction
- StarLedger
- QuestionPool
- ChapterMonthlyKpi

Database migration status:

- Initial database had no Prisma migration history.
- npx prisma migrate deploy first failed with P3005 because schema was non-empty.
- A read-only Prisma diff was run:
  - Existing database matched old application schema.
  - Diff showed only intended new Organization/Star/KPI/etc. changes.
- Baseline performed:
  - npx prisma migrate resolve --applied 20250831_init
  - This only recorded initial migration history; it did not alter schema/data.
- Migration deployed successfully:
  - 20261010_learning_organization_star
- Verified:
  - npx prisma migrate status
  - Historical result at that checkpoint: database schema was up to date before the later strict-100% migration was added.

Database backfill run:
Added:

- scripts/backfill-organization.ts

Executed:

- npx ts-node -P scripts/tsconfig.json scripts/backfill-organization.ts

Result:

- chapters: 1
- createdUnits: 1
- createdMemberships: 2
- createdAssignments: 1

Backfill behavior:

- Creates CHAPTER OrganizationUnit for each legacy Chapter lacking organization_unit_id.
- Links Chapter.organization_unit_id.
- Creates OrganizationMembership for legacy ChapterMember rows.
- Creates baseline positions:
  - CHAPTER_MANAGER
  - DNA_MANAGER
  - DEPARTMENT_LEADER
  - MEMBER
- Creates permission:
  - VIEW_MEMBER_PROGRESS
- Grants VIEW_MEMBER_PROGRESS to CHAPTER_MANAGER.
- Converts legacy CHAPTER_LEADER users into CHAPTER_MANAGER PositionAssignment within their Chapter.
- First relevant BĐHU assignment is marked primary.
- Existing legacy tables/data are not deleted.

Files added:

- prisma/migrations/20261010_learning_organization_star/migration.sql
- src/lib/stars.ts
- src/lib/progression.ts
- src/lib/learning-assignments.ts
- src/lib/authorization.ts
- src/app/api/v1/admin/restrictions/route.ts
- src/app/api/v1/admin/organization/route.ts
- src/app/api/v1/admin/learning-rules/route.ts
- src/app/api/v1/admin/learning-rules/[ruleId]/materialize/route.ts
- src/app/api/v1/assessments/[assessmentId]/pools/route.ts
- src/app/api/v1/chapters/[chapterId]/kpi/route.ts
- src/app/api/v1/courses/[courseId]/cover/route.ts
- src/app/api/internal/learning/deadlines/enforce/route.ts
- src/app/api/v1/stars/me/route.ts
- scripts/backfill-organization.ts

Important modified files:

- prisma/schema.prisma
- src/lib/config/quiz.ts
- src/components/YouTubePlayer.tsx
- src/components/lesson/LessonQuiz.tsx
- src/app/page.tsx
- src/app/student/dashboard/page.tsx
- src/app/student/learning/[lessonId]/page.tsx
- src/app/student/learning/[lessonId]/quiz/page.tsx
- src/app/lessons/[lessonId]/page.tsx
- src/app/admin/courses/[courseId]/edit/page.tsx
- src/app/api/v1/lessons/[lessonId]/route.ts
- src/app/api/v1/lessons/[lessonId]/progress/route.ts
- src/app/api/v1/assessments/[assessmentId]/attempts/route.ts
- src/app/api/v1/assessments/[assessmentId]/route.ts
- src/app/api/v1/attempts/[attemptId]/answers/[questionId]/route.ts
- src/app/api/v1/attempts/[attemptId]/cancel/route.ts
- src/app/api/v1/attempts/[attemptId]/submit/route.ts
- src/app/api/internal/attempts/auto-submit/route.ts
- src/app/api/v1/chapters/[chapterId]/members/[userId]/course-progress/route.ts
- src/app/api/v1/courses/route.ts
- src/app/api/v1/courses/[courseId]/route.ts
- src/app/api/v1/leaderboard/chapters/route.ts
- src/app/api/v1/users/[userId]/route.ts
- src/app/chapter-manager/members/[userId]/page.tsx was inspected but final UI detail patch did not apply due text-encoding context mismatch. The API itself already returns learningDetail.

Video/progression implementation:
Main files:

- src/lib/progression.ts
- src/app/api/v1/lessons/[lessonId]/progress/route.ts
- src/app/api/v1/lessons/[lessonId]/route.ts
- src/app/api/v1/assessments/[assessmentId]/attempts/route.ts
- src/components/YouTubePlayer.tsx
- src/app/student/learning/[lessonId]/page.tsx
- src/app/student/learning/[lessonId]/quiz/page.tsx

Rules now:

- Video completion requires 100%, with 2-second provider tolerance:
  furthest_watched_position_seconds >= duration_seconds - 2.
- Old 85% video completion labels/gates were changed to 100%.
- Server applies anti-seek cap:
  currentFurthest + 25 seconds + 2 * elapsed seconds.
- Staff accounts no longer bypass anti-seek restrictions.
- Server checks ordered previous lesson completion.
- Direct lesson read access is also gated by previous completion.
- Quiz attempt creation checks:
  - learning assignment access
  - can_assess
  - previous lesson completion
  - full video completion
- Admin retains intended inspection/bypass path in server progression helper.
- Course outline can still expose metadata, but direct later lesson access should fail.
- There may still be legacy frontend navigation conditions in other files not yet converted to Position/Permission model.

Important player fix:
Previously YouTubePlayer sent progress itself and the learning page also sent progress, causing duplicate requests.
Now:

- If onProgress callback exists, YouTubePlayer delegates API persistence to parent callback.
- Otherwise it retains fallback API persistence for preview/debug use.
- This allows the learning page to consume server Star reward response correctly.

Star reward UI:

- Video completion response returns starReward.
- Student learning page displays lightweight animated ⭐ reward popup.
- Quiz submit response now returns starReward.
- Student quiz page displays reward popup after successful first-time reward.
- Student dashboard calls /api/v1/stars/me and displays total Stars.

Quiz/Test fixes:
Files:

- src/app/api/v1/assessments/[assessmentId]/attempts/route.ts
- src/app/api/v1/attempts/[attemptId]/answers/[questionId]/route.ts
- src/app/api/v1/attempts/[attemptId]/submit/route.ts
- src/app/api/v1/attempts/[attemptId]/cancel/route.ts
- src/app/api/internal/attempts/auto-submit/route.ts
- src/app/api/v1/assessments/[assessmentId]/route.ts
- src/app/api/v1/assessments/[assessmentId]/pools/route.ts

Implemented:

- Attempt cancel requires authentication and correct ownership.
- Answer endpoint verifies selected option belongs to specified question.
- Submit endpoint only accepts questions belonging to AttemptQuestion.
- Submit endpoint verifies selected option belongs to the matching question.
- Atomic update guards against multiple submit race conditions.
- Auto-submit path now also awards quiz Stars and syncs assignment completion.
- Original attempt selection/randomization bug fixed:
  - Question set is selected once.
  - The exact selectedQuestions set is stored in AttemptQuestion.
  - Same selected set/order is returned to client.
- Question pools:
  - If Assessment has at least 5 configured pools, each attempt chooses 3 random questions from each of first 5 pools.
  - If any pool has fewer than 3 questions, request returns QuestionPoolIncomplete (422).
  - Legacy assessments without pools retain all-question behavior.
- Assessment question replacement is blocked if attempts already exist:
  - HTTP 409
  - code: AssessmentVersionRequired
  - prevents loss of historical attempt/question detail.
- Question pools can be managed through:
  - GET /api/v1/assessments/[assessmentId]/pools
  - PUT /api/v1/assessments/[assessmentId]/pools
- PUT requires exactly five named pools.
- Existing quiz pass threshold remains scoreRatio >= 0.85.

Course cover / Cloudinary:
Files:

- src/app/api/v1/courses/[courseId]/cover/route.ts
- src/app/admin/courses/[courseId]/edit/page.tsx
- src/app/api/v1/courses/route.ts
- src/app/api/v1/courses/[courseId]/route.ts
- src/app/page.tsx

Implementation:

- Admin-only POST:
  /api/v1/courses/[courseId]/cover
- Accepts multipart field:
  file
- Allowed:
  - image/jpeg
  - image/png
  - image/webp
  - max 8 MB
- Uses server-side Cloudinary signed upload.
- CLOUDINARY_API_SECRET remains server-side.
- Default folder:
  course-covers
- Optional override:
  CLOUDINARY_FOLDER
- Uses stable Cloudinary public ID:
  course-[courseId]
- Cover URL and public ID are stored in Course:
  - cover_url
  - cover_public_id
- Course list/detail API includes coverUrl.
- Admin course edit UI includes upload input and preview.
- Course must be DRAFT; published courses must be unpublished before replacing cover.
- Public landing page fetches /api/v1/courses?limit=8 and renders responsive featured course gallery using coverUrl.

Cloudinary has not been tested through an authenticated browser upload in this thread. The code compiles; manual test should be:

1. Login as Admin.
2. Open Admin → Courses → edit a DRAFT course.
3. Upload JPG/PNG/WebP under 8 MB.
4. Confirm Cloudinary asset and Course coverUrl update.
5. Confirm landing page displays it.

Member progress detail:
API:

- GET /api/v1/chapters/[chapterId]/members/[userId]/course-progress

Returns:

- user summary
- total Stars
- courses summary
- learningDetail:
  - course
  - module/session
  - lesson
  - video ID/title/duration/watched seconds/watched percentage/completed timestamps
  - assessment history
  - attempt number
  - score percentage
  - pass status
  - submission time

Authorization:

- ADMIN can view.
- Legacy CHAPTER_LEADER can view only their Chapter.
- Position-based manager can view if:
  - active PositionAssignment scoped to Chapter unit
  - position has VIEW_MEMBER_PROGRESS permission.
- Existing member-detail UI currently mainly displays summary API data. It has not been fully redesigned to render every nested learningDetail item.

Organization/Permission APIs:
GET/POST:

- /api/v1/admin/organization

Supported POST actions:

- CREATE_UNIT
- CREATE_POSITION
- CREATE_PERMISSION
- GRANT_PERMISSION
- ADD_MEMBERSHIP
- APPOINT_POSITION
- END_POSITION

Details:

- APPOINT_POSITION supports isPrimary and closes prior primary assignment in same Unit.
- Position Assignment uses startsAt/endsAt.
- After add membership, appoint position or end position:
  reconcileLearningAssignmentsForUser is called.

Learning Rule APIs:

- GET /api/v1/admin/learning-rules
- POST /api/v1/admin/learning-rules
- POST /api/v1/admin/learning-rules/[ruleId]/materialize

Rule fields:

- courseId
- organizationUnitId optional
- positionId optional
- mandatory
- canView
- canAssess
- canEarnStars
- dueDays
- effectiveFrom
- effectiveUntil

Materialization:

- Finds active users matching Unit and/or Position.
- Creates UserLearningAssignment if none active for that rule.
- dueAt uses explicit supplied dueAt or rule.due_days from current time.
- Existing assignments are not deleted.

Automatic reconciliation:
File:

- src/lib/learning-assignments.ts

Function:

- reconcileLearningAssignmentsForUser(userId)

Behavior:

- Finds active memberships, active positions and effective learning rules.
- Ends active assignments whose rule no longer applies.
- Creates missing assignments for newly applicable rules.
- Uses due_days to calculate deadline.
- This is invoked after membership/position modifications through Organization API.

Deadline/account locking:
Files:

- src/app/api/internal/learning/deadlines/enforce/route.ts
- src/app/api/v1/admin/restrictions/route.ts
- src/app/api/v1/users/[userId]/route.ts

Deadline endpoint:

- POST /api/internal/learning/deadlines/enforce
- Protected by CRON_SECRET or Admin token.
- Finds mandatory active assignments whose due_at has passed and status is ASSIGNED or IN_PROGRESS.
- Sets assignment OVERDUE.
- Creates AccessRestriction:
  - type DEADLINE
  - source_reference learning-assignment:[id]
- Sets User.status=LOCKED.
- Increments auth_version.
- Avoids duplicate active restriction for same overdue assignment.

Restriction endpoint:

- POST /api/v1/admin/restrictions
- Admin only.
- Supports direct User lock/unlock.
- Supports Chapter cascade lock/unlock.
- Direct lock records DIRECT_ADMIN or DEADLINE.
- Chapter cascade records CHAPTER_CASCADE against Organization Unit.
- Unlock closes restrictions with lifted_at and lifted_by_user_id.
- Chapter unlock does not reactivate users still under direct restriction.
- BĐHU legacy user PATCH route was changed so BĐHU cannot set a member status back to ACTIVE.
- Important remaining limitation:
  Existing generic legacy user status API and all old UI flows have not been completely consolidated around AccessRestriction. Further audit is required so every lock/unlock action uses restriction records consistently.

KPI API:

- GET /api/v1/chapters/[chapterId]/kpi
  - Admin or legacy BĐHU scoped to their Chapter.
- PUT /api/v1/chapters/[chapterId]/kpi
  - Admin only.
  - Supports monthly RED/YELLOW/GREEN.

Testing/validation run:
Successful:

- npx prisma generate
- npx tsc --noEmit -p tsconfig.check.json
- git diff --check
- npx prisma migrate status
  - Historical check before the strict-100% migration was added; see the latest status below.
- Earlier organization/Star migration deployment successful.
- Backfill script successful.

Prisma validation:

- npx prisma validate was previously successful.
- Later attempts sometimes failed because Prisma tried to download schema-engine checksum and network proxy returned:
  connect ECONNREFUSED 127.0.0.1:9
- A later read-only migrate-status retry with subprocess/network permission succeeded; the remaining issue is whether to apply to the currently configured Supabase environment, not schema-engine availability.
- npx prisma generate successfully parsed and generated client after final schema changes.

Build:

- Latest `npm run build` succeeded after allowing Next.js worker subprocesses outside the restricted sandbox.
- `tsc --noEmit -p tsconfig.check.json` passes.
- Build/lint/type validation does not substitute for database-backed authorization, progression, quiz, lock/unlock or leaderboard tests.

Known incomplete work:

1. Complete Admin UI:
   - `/admin/organization` now has basic forms/tables for creating Organization Units and Positions, creating/materializing/deactivating Learning Rules, membership and position-tenure lifecycle, permission grants, monthly Chapter KPI, account restrictions and restriction history.
   - Position-assignment, membership, learning-rule and user selectors now support server-side search/pagination; API input/ID validation and confirmations for broad rule materialization are implemented. Remaining validation is authenticated integration/browser QA.
   - The indented hierarchy view, topology-safe reparenting and audit, plus Position-permission revocation are implemented.
2. Full legacy-role migration:
   - Many routes still use ADMIN / CHAPTER_LEADER / MEMBER checks.
   - Chapter member list/detail, invitations, and member-management actions now use scoped Position Permission with legacy compatibility.
   - Other legacy role guards remain in several APIs and frontend conditions.
   - Need systematic replacement/compatibility strategy for:
     - chapter dashboard
     - invitations
     - comments
     - course visibility and student self-service routes outside the scoped progress endpoints
     - chapter membership management
     - KPI management access
     - DNA manager access
     - lock/unlock flows
3. DNA implementation:
   - Database supports DNA Organization Unit and DNA_MANAGER Position.
   - A shared `/organization-manager` workspace now exposes scoped roster/progress, add/remove membership, invitation, resend and cancel flows for DNA, Chapter and Department units. The backing APIs check active PositionAssignment permissions on the selected unit or an ancestor; DNA scope does not implicitly grant Chapter access.
   - Admin remains responsible for creating the unit and appointing/ending the DNA manager tenure. Authenticated browser/database verification is still outstanding.
4. Department/LT implementation:
   - Database supports Department and DEPARTMENT_LEADER. The generic organization workspace supports roster and progress operations at Department scope; the organization Admin UI retains responsibility for tenure appointments and termination.
   - `scripts/backfill-organization.ts` now grants DEPARTMENT_LEADER the scoped view/manage permissions, but has not been run against the hosted DB.
   - No automatic legacy Department data migration because legacy schema has no department model.
5. Final Course quiz:
   - Current Assessment remains Lesson-level.
   - The requested final-course quiz with even per-lesson question allocation has not been implemented.
6. Learning assignment access:
   - Progression helper enforces UserLearningAssignment if assignments exist.
   - Legacy fallback allows published courses when assignments are not materialized.
   - This was intentional for non-breaking migration.
   - Eventually remove/limit fallback once every user/course is materialized.
7. Course completion:
   - Current course assignment completion is based on all lessons completed.
   - There is no separate final-course assessment requirement yet.
8. Leaderboard:
   - Backend formula and public/Admin breakdown UI are implemented; individual leaderboard uses Star instead of the old points formula.
   - Still verify month rollover, KPI configuration, organization-membership counts and score behavior with real seeded data.
9. Reward animation:
   - Basic popup animation exists.
   - “Stars flying upward”, persistent animated counter and richer celebration remain unimplemented.
10. Public landing:

- Featured course gallery exists.
- Full marketing landing redesign, autoplay carousel controls, testimonials, richer sections and final design QA remain incomplete.

11. Detailed progress UI:

- Chapter manager member detail now displays nested course/module/video/quiz progress, Stars, attempt count, latest score and pass state.
- Course-students, Chapter roster, and Chapter dashboard APIs now all resolve membership through the shared Chapter/Department-tree projection; course-students is a summary endpoint, while member detail carries nested video/quiz/Star detail.
- Admin can now open detailed progress for MEMBER rows with no Chapter using the Admin-only `all` scope. Verify actual API authorization against seeded DNA/Chapter/Department users in an authenticated environment; no authenticated integration/browser tests are available yet.

12. Tests:

- `npm run test:business-rules` covers strict video completion, progress caps, Star formulas, organization/position scope, safe hierarchy moves/tree rendering, legacy/organization membership merge, quiz-pool selection/mapping, Learning Rule parsing, Admin-list pagination/ID rules, and legacy-permission compatibility boundaries (36 tests as of 2026-10-11).
- No database-backed integration or browser/E2E suite exists yet.
- Important tests still needed:
  - video progress API authorization and rejection of direct seek attempts.
  - progression direct API denial.
  - no duplicate Star reward.
  - invalid quiz answer option denial.
  - attempt restart/resume/reset.
  - database-backed question pool selection/mapping endpoint behavior.
  - role/position scope (pure scope rules are covered; API/database integration still needs tests).
  - deadline locking and Admin-only unlocking.
  - leaderboard eligibility/formula.

13. Migration safeguards (historical pre-deploy check, 2026-10-11; superseded by the latest rollout note at the end):

- Latest `npx prisma migrate status` found five migration directories: three are recorded as applied, and `20261011_strict_video_100_percent` plus `20261012_invitation_organization_unit` remain pending. A duplicate empty invitation migration directory was detected and removed after confirming it had no files; the status check then showed only the single valid invitation migration.
- Added `scripts/audit-strict-video-migration.ts` and `npm run db:audit-strict-video`. The read-only preflight on the currently configured database found 0 lesson records to reopen, 0 assignments to recalculate, and 0 Star entries / Stars to reverse. It ran no UPDATE/INSERT statements and changed no data.
- Schema-engine access succeeded when the read-only status command was run with the required subprocess/network permission. The configured target is a hosted Supabase Postgres endpoint (`aws-0-us-west-1.pooler.supabase.com`), but its environment (staging vs production) is not established. Do not run `prisma migrate deploy` until the target is confirmed; do not bypass Prisma migration history with direct SQL.
- For any new environment, initial migration still needs baseline if schema was created outside Prisma migrations.

14. Existing untracked files:

- “BBE - TH cam nang cac ban - BH05.2024 v08.pdf”
- Test.txt
  These were already in workspace and were not intentionally modified/deleted.

Completed in this continuation (2026-10-11):

- Rechecked Prisma migration status with network/subprocess permission: only `20261011_strict_video_100_percent` remains pending. No migration was applied.
- Added a repeatable read-only preflight command, `npm run db:audit-strict-video`, to report only aggregate impact counts before that migration. Current result: 0 completed lessons to reopen, 0 assignments to recalculate, and 0 Star entries/Stars to reverse; no rows changed.
- Added `/student/stars` with the member's current balance, paginated transaction history, empty/loading/error states, and mobile-friendly layout.
- Extended `GET /api/v1/stars/me` with stable pagination, safe limit caps, and page clamping while preserving the existing `balance` and `recent` response fields for old consumers. Every ledger query remains scoped to the authenticated user.
- Added a student sidebar link and pagination-rule tests. Business-rule tests now pass 22/22; TypeScript check and production build pass.
- Extracted quiz scoring into `src/lib/quiz-attempt-rules.ts` and wired the submit endpoint to use it for both persisted score and response results. Cross-question option IDs cannot earn points; unanswered questions remain incorrect; invalid/non-positive point values are safely defaulted.
- Quiz scoring now uses one shared grader in manual submit, result retrieval and cron auto-submit. Batch answer-save and submit reject malformed payloads, question IDs outside the active attempt, and option IDs belonging to another question. Answer-save, manual-submit and cron auto-submit share a PostgreSQL attempt-row lock; manual answer persistence, grading and status transition run in one transaction, preventing stale scores and duplicate submissions during races. GET result no longer trusts potentially stale `AttemptAnswer.is_correct` values.
- The Quiz UI now derives its remaining timer from the server-provided `expiresAt`; starting a new attempt resets only its own in-memory answers and no longer deletes drafts belonging to other active quiz attempts. The business-rule suite passes 28/28, TypeScript and `git diff --check` pass, and the optimized production build generated all 53 static pages. Authenticated database/API integration tests remain outstanding.
- No schema change or data migration was needed for Star history; it reads the existing `StarLedger` ledger.

The following checklist was current before the latest continuation and is superseded by the updated checklist at the end of this file.

Organization-admin hardening batch completed (2026-10-11): server-side search/status/unit/position filters and capped pagination for Memberships, Position Assignments, and Learning Rules; Admin UI paging and user-search selectors capped at 100 options; strict Learning Rule ID/date/deadline/flag validation; mutation ID/body validation and confirmations for broad rule materialization.

Verification for this batch: `npm run test:business-rules` 34/34; `npx tsc --noEmit -p tsconfig.check.json`; `git diff --check`; and `npm run build` all pass (53 static pages). Authenticated API/database tests were not run because no isolated test database is configured; do not use the current hosted Supabase database for write tests.

The remaining items listed in this historical snapshot are superseded by the updated checklist at the end of this file.

Completed in this continuation (2026-10-11):

- Added organization-scoped manager APIs and UI for listing DNA/Chapter/Department scopes, viewing scoped members and per-user progress, adding/removing memberships, and issuing/managing invitations. The API enforces Position Permission on the requested unit and supports legacy ChapterMember compatibility where applicable.
- Added an additive Invitation schema migration so a pending invite targets exactly one Chapter or Organization Unit. At the time of this note it had not yet been applied; the later successful rollout is recorded below. Existing Chapter invitations remain supported.
- Fixed authorization inheritance so only active target units and active ancestors contribute scope; permissions flow from a parent down to descendants, not sideways/up. Legacy CHAPTER_LEADER compatibility is restricted to VIEW_MEMBER_PROGRESS and MANAGE_CHAPTER_MEMBERS.
- Scoped managers can now cancel/resend invitations created by another manager in the same authorized unit; invitees outside that manager's scope remain inaccessible. Legacy BĐHU can choose a Department in their Chapter tree, and the invitation is attached to that Department rather than silently falling back to the Chapter root.
- Granted the DEPARTMENT_LEADER position baseline progress/member-management permissions in the organization backfill script. The script itself was not run against the hosted database.
- Added tests for downward-only position scopes and the legacy permission allowlist. Latest checks: business rules 36/36, TypeScript check passes, `git diff --check` passes, and production build succeeds with 55 static pages when Next.js can spawn its workers.
- Graphify remained unavailable because its executable points to a deleted Python interpreter (`C:\Users\Acer\anaconda3\python.exe`); the local Python environment was left unchanged and code was audited directly.
- At the time of this note no migration had been applied. The later user-confirmed test rollout and final status are recorded below.

Deployed smoke test (2026-10-11, `https://bbeelearning.vercel.app/`):

- Public homepage, `/student/courses`, and `/login` all loaded. No credentials were entered and no authentication was attempted.
- The deployed homepage showed the hero and feature cards, but not the featured-course gallery/carousel that exists in local `src/app/page.tsx`; this deployment appears not to include the current local landing-page code, or may be serving a different commit.
- The public course catalog eventually loaded one course card. Its visible card had no cover image; the API data may have no cover configured for that course. This is a data/configuration observation, not proof that Cloudinary upload is failing.
- Only desktop viewport was available in this deployed smoke test. A later local 390×844 mobile check is recorded below; neither check validates authenticated flows or Cloudinary upload.

Latest continuation update (2026-10-11; this supersedes earlier pending-migration and remaining-work notes):

- User confirmed the configured Supabase target is for testing and that Admin-managed data should be preserved. No reset, seed, or Admin-configuration write was performed.
- Before migration, the read-only audit reported zero lesson completions to reopen, zero learning assignments to recalculate, and zero Star reversals. The strict-video migration initially failed because a SQL `CASE` returned text for the PostgreSQL enum `learning_assignment_status`. Post-failure read-only checks confirmed no affected rows or partial schema changes. The migration was marked rolled back in Prisma metadata, the SQL was corrected with an explicit enum cast, and `npx prisma migrate deploy` then applied both `20261011_strict_video_100_percent` and `20261012_invitation_organization_unit` successfully. `npx prisma migrate status` now reports the schema up to date. The strict-video change touched no Admin configuration; the invitation migration is additive and preserves Chapter invitations.
- Removed the duplicate empty local migration directory `prisma/migrations/20261011130000_invitation_organization_unit` after verifying it contained no files. No database rows or source files were deleted.
- Rebuilt the public landing page in `src/app/page.tsx`: public content renders immediately without waiting on localStorage hydration; responsive marketing hero/CTA/feature sections; featured-course horizontal carousel with timed advance, pause-on-hover/focus, manual controls, image fallback, and reduced-motion support.
- Added shared `src/components/StarRewardCelebration.tsx` and subtle particle/glow animations with reduced-motion support; the video and quiz reward surfaces now use it. Star award amounts and idempotency remain enforced server-side by the Star ledger.
- Extracted the existing Chapter leaderboard thresholds/weights/calculations into `src/lib/chapter-leaderboard-rules.ts`; route behavior is unchanged. Added tests for 20-member minimum, 50% at ≥70% completion, RED KPI exclusion, distribution fairness, capped/per-member Star normalization, GREEN bonus, and 30-vs-50 size effect. For otherwise identical Chapters, 30 members score ~3.38 points less than 50 from the 15% size component alone.
- Verification: `npm run test:business-rules` passes 40/40; `npx tsc --noEmit -p tsconfig.check.json` passes; `git diff --check` passes; `npm run build` passes and generates all 55 static pages.
- Local browser QA: desktop screenshot reviewed; at 390×844, page has no horizontal overflow and the browser console has no errors. The configured local Prisma runtime cannot establish its TLS connection on this Windows host, so the local courses API returned an error and no real course cards were available to exercise the carousel. The previously tested Vercel URL still appears to serve an older landing-page build; no deployment was triggered.
- Graphify was inspected but could not run because its launcher points to missing Python `C:\Users\Acer\anaconda3\python.exe`; no Python environment was installed or changed. Source relationships were reviewed directly.

Current remaining work, prioritized (estimated **2 grouped work runs**, plus Vercel environment/deployment actions):

1. **Authorization consolidation + API integration tests:** route-by-route review of remaining legacy role checks; add authenticated tests for progression, video anti-seek, quiz retry/reset/submit, duplicate rewards, deadlines and organization scopes. A dedicated isolated `TEST_DATABASE_URL` is needed; do not run write tests against the shared database holding Admin configuration.
2. **Leaderboard/database validation:** pure score rules and the 30/50 comparison are tested. Validate KPI month rollover, Chapter membership aggregation, completion queries and ranking with a disposable isolated dataset.
3. **Deployment/Cloudinary verification:** the Vercel deployment must include the current source and have `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET` configured in its environment. Then perform one Admin-authenticated cover upload and verify desktop/mobile public rendering. No upload or deployment has been performed in this continuation.
4. **Course-final exam is a scope check, not silently assumed:** existing progression implements quiz checkpoints per module and the `/student/courses/[courseId]/quiz` page is only an informational legacy page. A separate final-course assessment and even distribution across lessons would require an additional schema/admin/API/attempt design; it is not necessary for the stated module-to-module gate unless that separate final exam remains a confirmed requirement.

Latest continuation update (2026-10-12):

- Authorization/Quiz security audit found that the deprecated course-level assessment GET endpoint exposed every lesson's question bank to unauthenticated callers, while the lesson and assessment detail endpoints exposed the full question bank to logged-in learners and answer keys to legacy `CHAPTER_LEADER` users. This bypassed attempt sampling and made quiz answers discoverable before taking a quiz.
- Changed `GET /api/v1/courses/[courseId]/assessment` to return `410 Gone` without querying question data; its deprecated POST now also returns `410`.
- Changed `GET /api/v1/lessons/[lessonId]/assessment` and `GET /api/v1/assessments/[assessmentId]` to require an authenticated Admin before reading/returning question banks or correct answers. Learners continue to receive only the selected questions for their own attempt and passed-attempt feedback through the attempt APIs.
- Removed the Chapter manager's answer-key preview modal/action; its course content panel now displays quiz question count only. Existing member progress, course/video preview, and score views remain.
- No schema/migration/database changes or hosted writes were made.
- Verification: `npm run test:business-rules` 40/40; `npx tsc --noEmit -p tsconfig.check.json`; `git diff --check`; and `npm run build` all pass. The default sandbox build attempt hit `spawn EPERM`; rerunning with permission for Next.js child workers completed successfully and generated all 55 static pages.

Updated remaining work:

1. **Authorization consolidation + authenticated API tests:** continue auditing legacy role checks (especially dashboards, comments, membership/course visibility, restrictions, and DNA/Department position access). The question-bank endpoints identified in this run are now closed to non-Admin users. Authenticated tests still needed for progression, video anti-seek, quiz retry/reset/submit, duplicate rewards, deadlines, and organization scope. Use a disposable isolated `TEST_DATABASE_URL`; do not write tests to the shared hosted database.
2. **Leaderboard/database validation:** pure score rules and 30/50 member normalization are covered by tests. Validate KPI month rollover, Chapter membership aggregation, mandatory completion calculations, and ranking with a disposable isolated dataset.
3. **Deployment/Cloudinary verification:** ensure the deployed Vercel build contains current source and has `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`; then perform one Admin-authenticated cover upload and desktop/mobile rendering check. No upload/deployment was triggered in this run.
4. **Course-final exam decision:** current progression has per-module quiz checkpoints. The legacy course quiz page is informational; separate final-course exam and even question distribution across lessons have not been implemented. Confirm whether this is still required before adding a second assessment model.

Latest continuation update (2026-10-12, progression/resource authorization batch):

- Closed the anonymous-public-lesson bypass: `GET /api/v1/lessons/[lessonId]` now requires an active authenticated user and runs the existing server-side `VIEW` progression/assignment gate for every non-Admin, regardless of the course's `PUBLIC` visibility. Admin can still inspect unpublished lessons.
- `GET /api/v1/courses/[courseId]` remains an outline endpoint, but only Admin receives the YouTube media ID/URL. Non-Admin callers get lesson outline/duration metadata, not a directly playable media URL. The Chapter manager course panel was changed from unrestricted video preview to outline-only; videos are opened through the ordered learning route.
- `GET /api/v1/documents/[documentId]/download` now requires authentication, published course status (unless Admin), and the same lesson progression check for non-Admin. A published/public course no longer makes lesson documents downloadable outside the assigned path.
- Lesson comment GET and POST now require authentication and `VIEW` progression. The client sends its access token when loading the discussion. Comment deletion is limited to its author or global Admin; legacy Chapter Leader no longer has global delete privileges. Added pure regression tests for this rule.
- No schema/migration/database writes or hosted data changes were made.
- Verification: business-rule tests **41/41**, `npx tsc --noEmit -p tsconfig.check.json`, `git diff --check`, and `npm run build` pass; build generated all 55 static pages. Local authenticated DB/API integration was not run because the configured database is shared and Admin-managed data must be preserved.

Updated remaining work:

1. **Finish legacy authorization audit + isolated integration tests:** continue through remaining API role guards (membership/invitations, chapter KPI, account restrictions, comments and non-progress endpoints); comments and direct lesson/document/media paths addressed above. Add database/API tests for progression order, video anti-seek, quiz attempt transitions/reward idempotency, deadline locks, and DNA/Department scopes using a disposable isolated `TEST_DATABASE_URL`.
2. **Leaderboard database validation:** pure rules are tested, but KPI month rollover, Chapter membership aggregation, mandatory assignment completion and ranking still need a disposable seeded dataset.
3. **Vercel/Cloudinary verification:** check Vercel has the current source and the three Cloudinary env vars, then test an Admin cover upload and public desktop/mobile rendering. No deployment/upload has been triggered.
4. **Final-course exam decision:** current progression requires a pass at each module quiz. Confirm whether a separate course-final assessment is still a requirement before introducing the additional model.

Latest continuation update (2026-10-12, course-final exam implementation; user confirmed both per-lesson quizzes and a course-final exam are required):

- Added explicit `AssessmentType` (`LESSON` / `COURSE_FINAL`) and optional owner references in `prisma/schema.prisma`. Existing lesson assessments retain their `lesson_id`; no attempt/history records are re-keyed or deleted.
- Added additive migration `prisma/migrations/20261013_course_final_assessment/migration.sql`. It backfills existing assessments to `LESSON` via a column default, adds nullable course ownership and a unique one-to-one final assessment per course, plus a database CHECK requiring each assessment to have exactly one owner. The migration has **not** been applied to Supabase; no database writes were made in this continuation.
- Added Admin-only authoring CRUD at `/api/v1/courses/[courseId]/final-assessment`. Learners can only read safe metadata, progression gates, and their attempt history; they never receive the question bank/answer keys. Question authoring requires exactly five pools, at least three questions per pool, valid choices, and preserves any assessment with existing attempts (returns 409 instead of destroying history).
- Updated the shared attempt-creation and submit paths to branch by assessment type. Final-exam creation/submit is server-gated on active course assignment with `can_view`/`can_assess`, all course videos watched at 100%, and every configured per-lesson assessment passed. Per-lesson quiz behavior remains attached to lessons/module checkpoints. Cron auto-submit now also awards final-exam Star rewards.
- Course completion now requires all lesson videos, all configured per-lesson quizzes, and (when configured) the final exam. Creating a final exam reopens previously completed assignments so the newly required exam is reflected in deadline/completion status. Generic assessment deletion now returns 409 if attempts exist rather than deleting learner history.
- Added the final-exam learner page at `/student/courses/[courseId]/quiz`, course-detail entry point, Admin builder card, attempt history/locked state, cooldown countdown/retry state, result preservation, and Star celebration. It reuses the existing secure attempt/questions/answer/result handling.
- Final-exam reward: 3 Stars for passing at 85%, plus 1 Star per complete 5-point band above the pass line, capped at 2 bonus Stars (5 maximum); reward ledger keys remain unique per learner/assessment. Final exam samples 3 questions from each of the same five configured pools (15 questions per attempt), assumed course-wide rather than evenly allocated by lesson because no lesson-level distribution rule was specified.
- Updated learner course progress to use a final-exam attempt for the course-level assessment link and report quiz scores as percentages. Progress now distinguishes pending lesson quizzes from the final exam, so a course with per-lesson quizzes but no final exam cannot appear complete or link to a nonexistent final exam. Added pure tests for video/lesson-quiz/final prerequisites and capped Star rewards.
- Verification: Prisma schema validates and Prisma Client generates; TypeScript passes; business-rule tests pass **45/45**; `git diff --check` passes. Final production build succeeded with Next worker-process permission and generated all 55 pages. No authenticated Supabase API test, migration deploy, Vercel deploy, or learner-data mutation was run.
- Graphify remains unavailable (launcher points at deleted Python `C:\Users\Acer\anaconda3\python.exe`); source audit was used instead.

Updated remaining work:

1. **Run the additive course-final migration and verify the real DB path:** after the currently configured Supabase target is reconfirmed as the test environment, apply `20261013_course_final_assessment` without reset/seed; then smoke-test Admin create/read/edit, learner lock → unlock → attempt/score/pass/Star, retry, duplicate-reward protection, and assignment completion. The schema migration is currently pending, so this feature is not live on the database/deployment yet.
2. **Finish legacy authorization audit + authenticated integration tests:** route-by-route review of remaining role checks; use a disposable `TEST_DATABASE_URL` for progression order, video anti-seek, quiz attempt transitions/reward idempotency, deadlines, and DNA/Department scope. Do not write tests to the shared DB holding Admin configuration.
3. **Leaderboard database validation:** pure score rules and 30/50 normalization are tested; KPI month rollover, Chapter member aggregation, mandatory completion calculations, and ranking still need an isolated seeded dataset.
4. **Vercel/Cloudinary verification:** deploy only after its DB migration is applied; confirm the deployment has `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`, then test an Admin-authenticated cover upload and public desktop/mobile rendering. No deploy/upload was triggered.

Latest continuation update (2026-10-12, course-final migration rollout):

- Connected to the configured Supabase database after the user-confirmed test-environment context. `prisma migrate status` initially found two pending course-final migration folders; inspection showed `20261012_course_final_assessment` was an empty, untracked directory with no `migration.sql` and no corresponding `_prisma_migrations` record. Removed only that confirmed empty placeholder directory; no migration/data file was removed.
- The only real pending migration was `20261013_course_final_assessment`. `npx prisma migrate deploy` applied it successfully. No reset, seed, backfill script, test fixture, Admin setting, learner progress, quiz attempt, or Star ledger mutation was run. Existing Assessment rows receive the new `type` default `LESSON`; existing lesson ownership/history is preserved.
- Follow-up `npx prisma migrate status` reports **Database schema is up to date** (six local SQL migrations found). The DB migration history was queried read-only before rollout to verify existing migrations and the absent orphan migration record.
- Verification after rollout: `npm run test:business-rules` passes **45/45**; `npx tsc --noEmit -p tsconfig.check.json` passes. A direct ad-hoc information_schema diagnostic had a PowerShell quoting/syntax failure before executing any SQL; migration deploy/status are successful, but the diagnostic did not independently enumerate constraints.
- No Vercel deployment or authenticated Admin/learner end-to-end flow was performed. Current source + migration are ready locally, but learner/admin runtime smoke tests still need an authenticated session/test account and the corresponding Vercel deployment.
- Graphify remains unavailable because its launcher references the missing Python interpreter `C:\Users\Acer\anaconda3\python.exe`; the local Python installation was not changed. Source audit and Prisma's actual DB migration status were used instead.

Updated remaining work:

1. **Authenticated course-final smoke tests:** verify Admin authoring/editing, learner progression lock/unlock, attempt, grading/pass, Star idempotency, retry/cooldown, and assignment completion against the now-migrated test DB using authorized test accounts; do not modify Admin configuration.
2. **Finish legacy authorization audit + isolated integration tests:** review remaining dashboard, comments, membership, KPI, account restrictions, DNA/Department access. Exercise progression order, video anti-seek, quiz attempt transitions/reward idempotency, deadlines, and organization scopes using disposable test fixtures or a dedicated isolated `TEST_DATABASE_URL`.
3. **Leaderboard database validation:** pure rules and 30/50 normalization are covered; validate KPI month rollover, Chapter aggregation, mandatory assignment completion, and ranking with an isolated dataset.
4. **Vercel deployment and Cloudinary verification:** deployment was not triggered. Confirm the Vercel build tracks current source and contains `NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`; then use an Admin-authenticated session for one cover upload and verify public desktop/mobile rendering.

Latest continuation update (2026-10-12, final-exam progress visibility and learner-history authorization):

- Both scoped member-detail APIs now include the course-final assessment's submitted/auto-submitted attempt count, latest score/pass/status/time, and Stars from the existing ledger: Chapter detail (`/api/v1/chapters/[chapterId]/members/[userId]/course-progress`) and DNA/organization-unit detail (`/api/v1/organization/units/[unitId]/members/[userId]/progress`).
- Admin Users, Chapter Manager member detail, and Organization Manager member detail now display that final-exam result in the course panel in addition to per-lesson quizzes and video progress.
- Removed the legacy `role === MEMBER` restriction from `GET /api/v1/assessments/[assessmentId]/attempts/me`. The endpoint is authenticated and scopes every query to the caller's own user ID; tying self-history to the legacy role prevented promoted Chapter/DNA/Department leaders from reviewing their own quiz attempts.
- Verification: TypeScript check passes; business-rule suite **45/45**; `git diff --check` passes; production build passes and generated all 55 static pages. The default sandbox build hit Windows `spawn EPERM`; rerun with Next.js worker permission succeeded. No DB rows or further schema changes were made.

Updated remaining work (latest status):

1. **Authenticated course-final smoke test:** the migration is live in the configured Supabase test DB, but Admin authoring/editing, learner lock/unlock, attempt, pass/Star, retry/cooldown, and assignment completion still need an authorized test session. Preserve Admin configuration.
2. **Continue authorization audit + isolated integration tests:** the self-attempt-history role gate is fixed; review remaining legacy dashboard, membership, KPI, restrictions, and DNA/Department role/position checks. Exercise the backend progression, video anti-seek, quiz, deadline-lock and scope behavior using disposable fixtures or a dedicated isolated `TEST_DATABASE_URL`.
3. **Leaderboard database validation:** rules and 30/50 size normalization are covered; validate month rollover, Chapter member aggregation, required completion and ranking with an isolated dataset.
4. **Vercel/Cloudinary:** no deployment/upload was performed. Confirm the deployed build/env and test one Admin cover upload plus public desktop/mobile rendering.

Latest continuation update (2026-10-12, Chapter restriction scope and Admin-only unlock audit):

- Added `src/lib/account-restrictions.ts` to derive Chapter accounts from all three sources: legacy `ChapterMember`, active `OrganizationMembership` in the Chapter subtree, and active `PositionAssignment` in that subtree. Chapter restrictions now cover new-model members and position holders, not only legacy roster rows.
- Added Chapter-scoped manager resolution based on active CHAPTER-scope tenures holding `MANAGE_CHAPTER_MEMBERS`. Admin deactivation/locking of a position-based Chapter manager now applies the same Chapter cascade as legacy `CHAPTER_LEADER` accounts. DNA and Department manager tenures do not trigger a whole-Chapter cascade.
- Chapter lock/unlock now includes org-only members, protects ADMIN accounts, and refuses to report success for a user who still has another active restriction. Direct Admin unlock and password reset use the same direct + cascade restriction check, so reset cannot bypass an active restriction.
- New Chapter cascade events persist a Chapter-level cause plus per-user target rows in `access_restrictions`. This snapshots the accounts affected, so a later membership change does not erase a currently locked account's audit reason. Existing Chapter-only restriction rows remain supported through dynamic scope resolution; if any such old restriction is still active, consider backfilling its current targets during the authenticated DB test before production rollout.
- Tightened the Admin restriction API's action/target/reason/source-reference validation and disallowed locking ADMIN accounts through the user lock path. Added pure tests for union of legacy/org/position account sources and for not activating while another restriction remains.
- Verification: `npx tsc --noEmit -p tsconfig.check.json` passes; business rules **47/47**; `git diff --check` passes; production build passes and generates all 55 static pages (the sandbox's default worker spawn hits Windows EPERM, so the build was rerun with Next worker permission). No schema migration, DB mutation, seed, or Vercel deployment occurred in this batch.
- Authenticated DB/API integration remains unrun. Graphify remains unavailable: launcher references missing Anaconda Python and the available Python 3.12 does not have the module; no Python/package install was made. Source audit was used directly.

Updated remaining work (latest):

1. **Authenticated restriction/cascade smoke test:** with authorized Admin + member accounts, test Chapter lock, BĐHU disable, user removal while locked, password reset while locked, multiple overlapping direct/deadline/Chapter restrictions, and the eventual Admin lift. Preserve Admin configuration. Inspect whether any active pre-existing Chapter-only restrictions need target snapshots before production.
2. **Continue route-by-route authorization audit + integration tests:** dashboards, membership/invitation, KPI, learning rules, DNA/Department position scopes, progression/quiz/video/deadlines remain to test with disposable fixtures or an isolated `TEST_DATABASE_URL`.
3. **Leaderboard database validation:** rules and 30/50 size normalization are covered; validate month rollover, Chapter aggregation, required completion and ranking with an isolated dataset.
4. **Vercel/Cloudinary verification:** no deployment/upload was performed. Confirm the deployed build/env and test one Admin cover upload plus public desktop/mobile rendering.

Latest continuation update (2026-10-12, large run 1 — authorization audit and deadline hardening):

- Re-audited API route authentication/authorization for account restrictions, deadlines, Chapter dashboards/members, organization-scoped members/positions, invitations, KPI, learning rules, quiz attempts/progression, and public/authentication endpoints. The routes not calling `authenticate` are public auth/invitation/health flows, the intentionally deprecated course-assessment endpoint (410), public catalog/leaderboard paths, or cron paths with explicit Cron-secret/Admin authorization.
- Fixed a deadline enforcement flaw: the cron path could lock an `ADMIN` account if it had an overdue mandatory assignment. Deadline enforcement now protects Admin accounts, transitions only assignments still overdue (so it cannot overwrite a concurrently completed assignment), and synchronizes video/lesson-quiz/final-exam completion before applying a lock. The learning record may still be marked overdue for an Admin assignment, but the account is not disabled and no deadline restriction is created.
- Fixed stale legacy Chapter authorization: `authenticate` now derives Chapter scope from current `ChapterMember` data on database reads, and rechecks the current Chapter membership when a cached legacy `CHAPTER_LEADER` session is used. It no longer relies on a stale `chapterId` JWT claim for legacy authorization. Chapter/org membership add/remove routes invalidate the affected user's auth cache after mutation.
- Added regression tests for Admin deadline-lock exclusion and deriving legacy Chapter scope from current membership. `npm run test:business-rules` passes **49/49**; `npx tsc --noEmit -p tsconfig.check.json`, `git diff --check`, and production `npm run build` pass. Build generated all 55 static pages (default sandbox worker spawn required permission; authorized rerun succeeded).
- No `TEST_DATABASE_URL` is configured in the local environment, so no authenticated database/API integration tests were run. The configured hosted Supabase database was not queried or modified in this batch; no migration, seed, learner-data mutation, or Vercel deployment occurred.
- Graphify remains unavailable because its launcher points to missing Python `C:\Users\Acer\anaconda3\python.exe`; no package/interpreter was installed. Source audit was used directly.

Updated remaining work after large run 1:

1. **Authenticated security/learning integration tests:** use a dedicated disposable `TEST_DATABASE_URL` (or authorized disposable test accounts) to exercise Chapter/DNA/Department scope, course-final authoring and attempt flow, ordered progression, 100% video anti-seek, quiz retry/submit/reward idempotency, direct/deadline/Chapter restriction overlap, password reset while locked, and Admin-only unlock. Do not run write tests against the shared DB with Admin configuration.
2. **Leaderboard database validation:** validate KPI month rollover, Chapter membership aggregation, required-completion eligibility, and ranking on an isolated seeded dataset; pure scoring rules and size fairness tests already pass.
3. **Vercel/Cloudinary end-to-end verification:** confirm the current source is deployed and Vercel has the three Cloudinary variables; then test one Admin cover upload and public desktop/mobile rendering. No upload or deployment has been performed.

Latest continuation update (2026-10-12, large run 2 — Chapter leaderboard correctness):

- Audited the Chapter leaderboard aggregation and found that its mandatory-program completion percentage counted completed videos only, while course/assignment completion also requires applicable lesson quizzes and the optional course-final exam.
- Updated `src/app/api/v1/leaderboard/chapters/route.ts` to compute progress over active, visible, mandatory assignments: one milestone per video plus each lesson/final assessment the learner is allowed to take. It counts only submitted/auto-submitted passing attempts. Viewer-only assignments do not require assessments they cannot take; hidden assignments are excluded; duplicate assignment rules do not double-count identical milestones; members with no required assignment remain at 0% (consistent with the existing eligibility policy).
- Added pure helper `calculateMandatoryCompletionPercentByUser` in `src/lib/chapter-leaderboard-rules.ts` and tests for video/quiz/final-exam weighting, viewer-only access, hidden courses, duplicate requirements, and missing assignments.
- Tightened KPI input validation in `src/app/api/v1/chapters/[chapterId]/kpi/route.ts`: only an explicit valid `YYYY-MM` is accepted (no silent fallback to the current month); status is enum-checked; note must be text up to 500 characters. Added tests for UTC month normalization and malformed inputs. No schema migration was required.
- Existing score weights remain 40% completion (45% average + 35% median + 20% at-70% rate), 25% normalized average Stars/member, 15% sqrt/capped Chapter size, and 20-point GREEN KPI bonus; RED excludes, YELLOW has no bonus. The 30/50 comparison and distribution/eligibility cases remain covered. Stars remain lifetime ledger balance normalized per member, matching the existing Chapter Star interpretation; KPI and displayed ranking period are monthly.
- Verification: business-rule suite **55/55**; `npx tsc --noEmit -p tsconfig.check.json`; `git diff --check`; production `npm run build` compiled and generated all 55 static pages. The default sandbox build hit Windows `spawn EPERM`; authorized local build succeeded. No database was queried or modified, no migration/seed/deploy/upload was run.
- Graphify remains unavailable (missing configured Anaconda Python and module); source was audited directly. No external packages/interpreters were installed.

Work list after large run 2 (historical; item 1 was completed in the latest continuation update below):

1. **Isolated authenticated integration/data validation:** completed below using a disposable local PostgreSQL database and authenticated API sessions. The configured/shared DB was not used.
2. **Vercel/Cloudinary smoke verification:** confirm the deployed source and the three Cloudinary env vars, then use an Admin session to upload one cover and check public desktop/mobile rendering. No deploy or upload was performed.

Latest continuation update (2026-10-12, isolated Chapter leaderboard/KPI integration):

- Created and ran a disposable PostgreSQL 18 cluster under the OS temp directory, listening on loopback only. Both `DATABASE_URL` and `DIRECT_URL` were explicitly overridden to that test database. No Supabase queries, writes, migrations, or deploys were performed.
- Added `scripts/test-chapter-leaderboard-integration.mjs` and the `npm run test:leaderboard-integration` script. The runner requires a loopback `TEST_DATABASE_URL` ending in the exact database name `bbe_test_leaderboard`, and a loopback `TEST_APP_URL`; it refuses non-local targets. It uses the app's real auth/API routes and removes seeded fixtures in `finally`.
- Integration coverage: Admin-only KPI writes; unauthenticated/MEMBER authorization; invalid month/status/note validation; Chapter-member union/deduplication across legacy and organization membership; 20-member completion distribution; mandatory videos and lesson quizzes; YELLOW score; immediate YELLOW-to-GREEN leaderboard cache invalidation; RED exclusion. The API integration passed. Fixture cleanup verified zero test users, Chapters, courses, and org units. The local app server and PostgreSQL cluster were stopped and the temporary directory removed.
- Added `src/lib/chapter-leaderboard-cache.ts`, used by `src/app/api/v1/leaderboard/chapters/route.ts`; successful KPI updates in `src/app/api/v1/chapters/[chapterId]/kpi/route.ts` now invalidate cached rankings immediately. Cache TTL/invalidations are also covered by business-rule tests.
- Migration finding: on a pristine temporary DB, `prisma migrate deploy` fails at `20261013_course_final_assessment`: the initial `20250831_init` migration defines `assessments.course_id` and does not create `lesson_id`, while the later migration assumes `lesson_id` exists and attempts to add `course_id` again. The suspect migration was not edited because it may already be applied to the configured Supabase database; altering an applied migration risks checksum/history drift. To test API behavior only, the disposable DB was aligned with current `schema.prisma` using `prisma db push --accept-data-loss --skip-generate`, then discarded. Reconcile migration history/schema before a clean-database rollout, after safely confirming the actual target DB migration state.
- Verification: `npm run test:business-rules` **56/56 passed**; `npx tsc --noEmit -p tsconfig.check.json` passed; `node --check scripts/test-chapter-leaderboard-integration.mjs` passed; production `npm run build` passed and generated all 55 static pages; `git diff --check` passed before this context update.

Remaining work:

1. Run the broader authenticated API integration suite for learning progression, lesson/final quizzes, attempts/retries/rewards, and role/organization restrictions against an isolated DB.
2. Verify the Vercel deployment and Cloudinary env configuration; with an Admin session, upload a test course cover and check public desktop/mobile rendering. No external deployment or upload has been performed.
3. Graphify remains unavailable in this environment (its configured Anaconda interpreter/module is missing); source audit and project tests were used instead. No packages/interpreters were installed.

Latest continuation update (2026-10-12, safe migration baseline):

- Rechecked Graphify as required for this codebase task: `graphify-out/graph.json` is absent and `graphify --version` fails because the configured `C:\Users\Acer\anaconda3\python.exe` is missing. Continued with direct source/migration inspection; installed nothing.
- `prisma migrate status` could not run initially because Prisma attempted to fetch its schema engine and outbound network was blocked. A read-only PrismaClient transaction was then used against the configured DB, with `SET TRANSACTION READ ONLY`; it queried only `_prisma_migrations` metadata and `information_schema.columns` for `assessments`, not application/user rows.
- The configured DB has all six local migration names recorded as successful, and every recorded checksum matches the corresponding local SQL file. It has the current assessment columns (`type`, nullable `lesson_id`, nullable `course_id`). `20261011_strict_video_100_percent` has one earlier rolled-back failure record (enum/text cast issue) and a later successful record; no unresolved failure remains. No DB changes were made.
- Important reproducibility finding: despite matching checksums and applied history, a pristine DB cannot replay this repo's migrations because `20250831_init` creates `assessments.course_id` while `20261013_course_final_assessment` attempts to add it and assumes a `lesson_id` column. The configured DB schema therefore was not produced by replaying the checked-in migrations in order (out-of-band schema sync/hotfix is a plausible explanation, but not proven). Do not edit historical migrations.
- Added a generated current-schema snapshot at `prisma/bootstrap/20261012_schema.sql`, paired with `prisma/bootstrap/20261012_manifest.json`. Added `scripts/baseline-empty-database.mjs` and `npm run db:baseline-empty` as a safe path for a separately provisioned, brand-new database. It requires `BASELINE_DATABASE_URL` (never falls back to app DB URLs), exact `BASELINE_CONFIRM_DATABASE`, and an additional explicit remote-target confirmation; it refuses partial/populated mismatches, is resumable after its atomic schema install, and is a no-op when schema/history already match. Added usage and scope warnings in `prisma/bootstrap/README.md`.
- Added `scripts/baseline-empty-database.test.mjs` and `npm run test:baseline-safety`: **6/6 tests passed**. Real local PostgreSQL 18 bootstrap test created the schema, marked all six migrations applied, reran as a no-op, and `prisma migrate status` reported **Database schema is up to date!** The test cluster was stopped and deleted. It did not touch Supabase.
- The Prisma-generated snapshot contains 32 tables. Existing configured DB and its migration checksums remain untouched. `git diff --check` passed.

Latest continuation update (2026-10-12, isolated learning-flow/security integration and deployed landing smoke test):

- Added `scripts/test-learning-flow-integration.mjs` and `npm run test:learning-flow-integration`. The runner requires the exact loopback DB name `bbe_test_learning_flow` plus a loopback app URL, explicitly overrides Prisma's DB URL, uses short-lived integration JWTs, and deletes only its uniquely named fixtures in `finally`.
- The real API integration passed across Admin-only lesson/final-exam authoring; the five-pool final-exam API; immediate seek capped to zero; 99.44% video progress not completing or paying; exact 100% video reward; sequential video and quiz unlocks; viewer-only assignment access without quiz/Stars; cross-question answer rejection; failed/pass grading and private results; immutable submit; cooldown and attempt numbering; blank retry answers; one-time lesson/final Stars; course completion; and Chapter/DNA manager boundaries.
- The same integration verified Admin-only restrictions, BĐHU disable cascading to Chapter accounts, BĐHU inability to unlock, overlapping direct + Chapter causes, Admin-only lift audit (actor and timestamp), and overdue mandatory assignment locking tied to the exact assignment. Local Cloudinary route validation rejected a non-image with `InvalidImage` before any outbound upload.
- The `bbeelearning.vercel.app` public landing page was checked at desktop and 390px mobile viewport. The deployed page has no horizontal overflow at mobile width, but it does **not match current source**: it renders the older “Học tập chuyên sâu / Nâng tầm kỹ năng cùng BBE” hero and no “Khóa học nổi bật” carousel, while source now renders “Học có lộ trình / Tiến bộ mỗi ngày” and the carousel. This is strong evidence the current changes are not yet deployed.
- `.env` contains all three Cloudinary variable names; their values were not printed. The deployed Vercel variables and the actual Cloudinary credentials/upload were **not verified**. No image was transmitted, no Cloudinary asset was created, and no deployment was triggered. The opened Vercel page had no Admin session, so authenticated remote upload could not be tested safely.
- Verification this run: learning-flow API integration passed; business rules **56/56**; baseline safety **6/6** (the Node test runner needed process-spawn permission after sandbox `EPERM`); `npx tsc --noEmit -p tsconfig.check.json`; `node --check`; package JSON parse; and `git diff --check` all passed. A disposable PostgreSQL 18 cluster and local Next server were stopped; the exact verified temporary directory was removed. No Supabase query, write, migration, Vercel deploy, or Cloudinary upload occurred.

Updated remaining work:

1. **Deploy the current source** to Vercel, then re-check that the deployed page matches the source and that the three Cloudinary env vars exist there. The current URL serves an older build.
2. **Authenticated Cloudinary end-to-end test:** after the current build is deployed and an Admin is signed in, choose/approve a disposable cover image, upload to a new test course, verify the saved cover and responsive carousel, and clean up only test resources if authorized. Local variable names are present, but actual key validity and Vercel configuration remain unknown.
3. Graphify is still unavailable because its launcher points at missing `C:\Users\Acer\anaconda3\python.exe`; code/source audit and direct tests were used instead. This does not block the tested application behavior.

