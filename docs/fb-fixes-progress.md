# FB fixes ledger — plan: user-supplied FB-01–FB-08, 2026-10-26

Base: c6671286b2b9733cb48fb9b92c3ab67ab72f4509. Implement in the existing workspace, preserving P0, load-tests and all prior uncommitted artifacts. No commit, deployment, production writes, schema changes, cutover or reward-gate changes.

The supplied plan is the current authority and renews FB-01–FB-08 scope previously deferred in feedback-implementation-progress.md.

Tasks: FB-04 invitations; FB-02/06 current learner roster; FB-05 typed history; FB-01 quiz duration; FB-03 eligibility metadata; FB-07 replay context/rewards/ACK compaction; FB-08 readiness/scope; isolated DB/browser verification and report; independent final review.

Shared interfaces: roster feeds dashboard counts and live Chapter metadata; progressContext identities feed transport ACK evidence; readiness and current affiliation must agree between period catalog and leaderboard.

Ruling: reuse the in-place workspace preference recorded by the earlier session, because the required P0 baseline includes uncommitted/untracked files. Keep all changes reviewable without staging.

Graph lookup: existing graph query, budget 1000 tokens, confirmed relevant modules; source is re-read for implementation. No graph rebuild.

Test DB: new PostgreSQL 18 cluster scratch/fb-fixes/pg-data, loopback 127.0.0.1:55438, database fb_fixes_test, test-only role fb_test. pg_ctl restricted-token launch failed; direct hidden postgres process succeeded. No existing service restarted.

- Bootstrap: existing baseline applied; forward migrations expose two pre-existing dependency-order defects (profile_quiz_configuration before learning_governance; lead_binding_guards before organization_integrity). Recovered only the new test cluster using guarded scratch/fb-fixes/finish-test-bootstrap.cjs, recording original checksums. Repository migrations unchanged.
- FB04: 3 DB/API regression checks RED→GREEN (LEAD query/count/paging, cache separation, role/validation).
- FB02/06: 4 DB/API checks RED→GREEN (2/13 learners, managers/inactive/dedup, ended/future legacy fallback, full search denominator). Separate resolver keeps account/history behavior.
- FB01: actual POST response missing duration observed RED, 5→7→GET/DB GREEN. Added course/client invalidation and removed duration read fallbacks.
- FB03: missing CORE returned roster 0 observed RED; independent roster + three criteria GREEN. Boundary matrix GREEN. UI now renders excluded Chapters even if no Chapter qualifies.
- FB07: two transport regressions RED (training 862 suppressing replay 108; failed in-flight evidence discarding checkpoint). ACK floor now conservatively uses the minimum confirmed training/replay with matching identities.
- Ruling: update old transport expectation [1,3,4,6] to [1,2,3,4,5,6], because the new explicit contract preserves all unacknowledged playback evidence. Existing latency/seek compaction still passes once the backend confirms it.
- Consolidated test:fb-fixes suite: 27/27 checks PASS (FB04 4/4, FB02/06 6/6, FB01 1/1, FB03 3/3, FB08 8/8, FB07 4/4, FB05 1/1).
- Browser MEMBER page fix (video-player.spec.ts:193): Added nullish coalescing fallback in student learning page.tsx for lifetime.furthestWatchedPositionSeconds ?? progress.furthestWatchedPositionSeconds, and aligned mock fixture with backend contract. Spec 193 PASS (2.3s).
- Browser Quiz test (FB01): Added 'FB01 Admin updates quiz duration from 5 to 7 minutes and persists across reload' in fb-feedback.spec.ts. Form save 5->7 min and reload persistence PASS. All 5/5 fb-feedback browser tests PASS.
- Cycles integration investigation: scripts/test-learning-cycles-integration.cjs failure at line 110 (SupplementalLearningRequirement.findFirstOrThrow) confirmed as baseline/spec mismatch from architecture v4 unified deadlines (commit 108762b), which superseded separate supplemental requirements with direct assignment/path deadline extensions. Business rules preserved without tampering.
- Verification status: TypeScript exit 0; Next.js build exit 0 (74/74 pages); test:fb-fixes 27/27 PASS; video-progress-session 22/22 PASS; test:reward-pause-integration PASS; playwright fb-feedback 5/5 PASS; playwright video-player P0 acceptance PASS (known baseline popover issue documented and isolated).
