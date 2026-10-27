# BBE UI / request audit — checkpoint 1

Date: 2026-10-27. Inspected HEAD: `cf88238ffb015cab7798256e270175f602a9724d`.
Scope: Lead Chapter Pilot; other roles inventoried for later migration only.
This checkpoint records the pre-implementation source. Runtime changes and final measurements are tracked in [the final report](UI_UX_PERFORMANCE_FINAL_REPORT.md).

## Provenance and protected work

- Branch at entry: `main`. Existing modifications: `package.json`, `package-lock.json` (Motion addition; 58 added lines in aggregate). Do not reset, stage, upgrade or overwrite them.
- Existing untracked skills/configuration: `.agents/skills/{design-taste-frontend,impeccable,web-design-guidelines}`, `.claude`, `.codex`, `.cursor`, `.devin`, `skills-lock.json`. Leave intact.
- Existing video/fullscreen/progress repairs are part of HEAD. No player or application shell changes in checkpoints 1–3.
- Work in this checkpoint is documentation and a standalone opt-in design specimen, with no production imports, routes or database access. No branch/worktree mutation required. Runtime implementation remains a subsequent checkpoint.
- Existing graph (2026-10-12, 1,008 nodes) located client/dashboard/courses dependencies; current source was then re-read because that graph predates HEAD. Graph query was truncated at a 650-token budget and is navigation evidence only.

## Request accounting

| Class | Definition / examples | Count separately |
| --- | --- | --- |
| Business GET | dashboard members/courses, roster/history, leaderboard, `/learning/me` | Yes, including mandatory LearningCycle checks |
| Auth/security | `/auth/me`, refresh and logout (POSTs remain auth traffic) | Yes; never relabel business requests |
| Mutation | parse-sheet POST, schedule/apply/cancel, member edits and invitations | By method + endpoint; parse is not a cacheable GET |
| RSC/navigation | document / Next Flight and route/code prefetch | Excluded from business GET counts |
| Assets | JS/CSS/fonts/images/video/YouTube | Separate; player traffic must remain observable |

Strip only diagnostic `_t` when grouping recorded URLs. Retain real filters, pagination and Chapter scope. Do not save bearer tokens, cookie values, request bodies containing roster details or token-bearing legacy cache keys to reports.

## Pilot inventory (relative to `/api/v1`)

`C` is the server-verified Chapter ID, never an unverified storage affiliation.

| Surface | Mount / view change | Lazy interaction / mutation | Current invalidation / hazard |
| --- | --- | --- | --- |
| Chapter layout | Storage-based role check; `/auth/refresh` if missing credentials; `/auth/me` for effective manager scope in fallback paths | Idle prefetch four URLs: `chapters/C/dashboard/members`, same with `search=`, `dashboard/courses`, `invitations?chapterId=C` | Timer is not cancelled; locally stored legacy role can authorize UI without revalidation |
| Sidebar | Reads storage; route/code prefetch on hover | Business prefetch for target view; POST `auth/logout` | Logout clears storage after network settles; client maps not explicitly revoked |
| Dashboard | GET `chapters/C/dashboard/members` and `chapters/C/dashboard/courses` on every mount | Refresh calls those two GETs | Clears all `/chapters`; cached lookup is disabled by client matcher |
| Courses | GET same `chapters/C/dashboard/courses` | GET `courses/K/students?chapterId=C`, `courses/K`, `assessments/A` on modal opening | Refresh clears `/chapters` and `/courses`; player imported eagerly, modal data lazy |
| Term Transition: current | GET `chapters/C/current-roster` on mount / opening current | Countdown at 1 second; due callback refreshes roster; member PATCH `users/U`; PATCH member department; POST `members/bulk-deactivate` | Broad `/chapters`, `/users`; force roster also GETs `auth/me` |
| Term Transition: history | GET `chapters/C/reorganizations` on each history opening | POST `reorganizations/parse-sheet`, POST collection to schedule, POST batch to apply, DELETE batch to cancel | Learning/course clears and both view reloads in `finally`, including failed/cancelled operations |
| Members | GET `chapters/C/dashboard/members` with search/includeInactive and view parameters | GET member course-progress; invitation POST; user PATCH | Broad chapter/user/invitation invalidation; outside first three-page migration |
| Member detail | GET Chapter member detail | PATCH user | Broad chapter/user invalidation |
| Invitations | GET `invitations?chapterId=C` | POST member invitation/resend; DELETE invitation | Invitation prefix invalidation |
| Leaderboard | `UnifiedLeaderboard`: GET `learning/periods`, GET `leaderboard?…` when selection changes | GET member course-progress | Separate cache/permission audit required; no automatic Pilot migration |

The generated [source inventory](docs/ui-cache-checkpoints/REQUEST_SOURCE_INVENTORY.md) lists call sites, effects and timers across all role pages/components; dynamic URLs are source expressions, not a claim about actual traffic. Admin, Lead DNA, Member and Guest remain outside the Pilot runtime allowlist.

## Root causes and security risks

- `src/lib/api/client.ts:29`: `currentOrganizationView()` matches every `/chapters` path, as well as sensitive learning endpoints. Cache reads return null and GETs become `noCache`. Removing the matcher globally would remove a permission/freshness safeguard.
- `src/lib/api/client.ts:41`: bearer token is embedded in the memory key and persisted under `api_cache:` in sessionStorage. Private responses also persist. Delete only those old entries during migration, without printing keys.
- `src/lib/api/client.ts:189`: `noCache` removes in-flight ownership and skips deduplication. Two refreshes can create two GETs; older request `finally` can remove newer ownership.
- Successful GET writes have no generation/account guard. Clearing a map does not prevent an older promise writing back after invalidation or account change.
- `src/app/chapter-manager/dashboard/page.tsx:47` and Courses refresh use broad clears; unrelated tabs lose data.
- `src/app/chapter-manager/term-transition/page.tsx:226`: legacy draft uses Chapter alone. It restores parsed content without owner verification, stores only part of form state and silently ignores storage failures. Do not restore, migrate or delete those legacy drafts in new code.
- Layout exposes a `managedChapters.length > 1` selector. Product rule: one Lead Chapter manages one Chapter. Record conflict; do not widen scope, repair assignments, change schemas or change authorization in this task.
- GET current-roster and history both call `applyDueChapterReorganizations()` before responding. Session caching must retain a due-date trigger and recheck on foreground return; otherwise it delays side effects currently triggered by reads.
- `Sidebar.tsx:218`: logo lacks intrinsic width/height. `dashboard/page.tsx:95`: long title in an unwrapped header can crowd refresh on mobile. `globals.css`: duplicate transition rules and generic `transition: all` need a scoped follow-up; do not touch player ancestors for visual effects.

## Baseline evidence and limits

Inherited from the supplied plan, **not re-measured in this checkpoint**: Chromium, width 1440px, mocked API; warmed 10 Dashboard ↔ Courses rounds: **30 business GET**; 10 Current ↔ History rounds: **20 GET** after first roster; idle **4 GET**; member hover **1 GET**. Dashboard refresh used exactly two business endpoints. Browser version, latency, fixture version, trace and stable-state predicate were not supplied, so this is a reference baseline, not a reproducible performance result.

No backend correctness, permission enforcement or real schedule application is proven by a mocked response. No before/after cache saving is claimed here.

## Dependency advisory reconciliation

The supplied baseline reports 7 advisories (1 critical, 5 high, 1 moderate), without package names or advisory IDs. On this checkout, both `npm audit --json` and `npm audit --json --prefer-online --registry=https://registry.npmjs.org` returned 0 vulnerabilities, auditReportVersion 2, 227 dependencies. No dependencies were upgraded. This discrepancy remains **NOT VERIFIED**: the original seven cannot receive a responsible reachability assessment without their IDs and dependency paths. A zero registry result does not prove absence of vulnerabilities.

Before runtime rollout, map each recovered advisory to direct/transitive path, production versus tooling, reachable server/client functionality, exploit prerequisites and a separately reviewed remediation. Do not use `audit fix --force`.

## Checkpoint verdict

**PASS**: source audit, protected-patch identification and request taxonomy. **NOT VERIFIED**: independently reproduced network baseline, original seven advisory impacts, runtime security/video/business gates. No application runtime changes at this checkpoint. Evidence and next gates: [final status](UI_UX_PERFORMANCE_FINAL_REPORT.md).

## Kiểm chứng bổ sung sau quyền Supabase phát triển

Người dùng đã cho phép dùng database hiện tại. Báo cáo ban đầu về localhost-only là điều kiện lịch sử, đã được thay bằng guard development target thật, backup và namespace fixture riêng. Không chạy các thao tác policy/cutover/migration toàn cục vào public. Project/database, script-write audit, fixture inventory và PASS/FAIL/NV được cập nhật ở docs/ui-cache-checkpoints/DEVELOPMENT_INTEGRATION_REPORT.md. Sau test, public60 bảng/2711 dòng và schema metadata có cùng digest với backup trước test. UI mock vẫn chỉ chứng minh frontend, không được đổi thành bằng chứng backend thật.
