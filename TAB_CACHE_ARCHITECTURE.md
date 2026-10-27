# BBE tab cache architecture — checkpoint 2

Status: specification implemented for the Lead Chapter Pilot; acceptance gates remain tracked in [the final report](UI_UX_PERFORMANCE_FINAL_REPORT.md). Existing API contracts and business formulas remain authoritative.

Implementation scope: session policy is selected only for the four exact verified Chapter URLs below; all four currently have no query parameters. Legacy query-string ordering remains unchanged until those endpoints receive their own migration audit. Resource keys live inside an owner/epoch-scoped cache; tab snapshots live inside the same scope. The 10 MiB budget measures serialized UTF-8 payload/key bytes plus per-entry accounting overhead, not total JavaScript heap.

## Interfaces and migration boundary

Extend `src/lib/api/client.ts`; retain `apiFetch`, `getCachedApiData`, `clearApiCache` signatures for existing callers. Introduce an explicit query API and `useApiQuery<T>()` returning `{ data, status, error, updatedAt, refresh }`. `status` is `idle | loading | success | error`; refreshing an existing result keeps data and exposes a separate refreshing flag. Never cache mutations or non-success responses.

Policies: `session` returns valid memory data until invalidation; `always-validate` always checks server but deduplicates concurrent identical GETs; `legacy` preserves existing callers until individually migrated. No 30-second expiry for session queries; F5 begins a new memory session. No new state framework.

Initial allowlist only:

| Resource | Endpoint | Policy / sharing |
| --- | --- | --- |
| chapter-dashboard-members | `/chapters/C/dashboard/members` | session; exact parameters only |
| chapter-dashboard-courses | `/chapters/C/dashboard/courses` | session; Dashboard + Courses share identical payload |
| chapter-current-roster | `/chapters/C/current-roster` | session with due-date invalidation |
| chapter-transfer-history | `/chapters/C/reorganizations` GET | session with due-date invalidation |
| verified-session | `/auth/me` | always-validate; never private business session cache |
| learning-cycle | `/learning/me` | always-validate where existing LearningCycle flow requires it; business GET |

Course content/students/assessment remain existing lazy requests until their separate permission/freshness review. All other sensitive endpoints keep `currentOrganizationView()` protection. No blanket caching of GETs or blanket removal of its matcher.

## Identity and cache keys

Use deterministic serialization of `[userId, epoch, scopeFingerprint, chapterId|null, dnaId|null, resource, canonicalParameters]`. Obtain identity and effective scope from a successful server `/auth/me`, not from decoded token claims or localStorage user. Scope fingerprint includes verified role, manager kind, manageable unit IDs and permissions (stable sorted arrays). Detect scope loss even when user ID is unchanged. Canonicalize query parameter ordering; preserve empty versus absent parameters unless endpoint equivalence is proved. Never include bearer/refresh tokens, email or roster content in keys.

Resolve `me` to verified Chapter before selecting an entry; no cross-Chapter fallback. Shared resources omit route; tab snapshots add pathname + view + query selection. No implicit sharing of members list filtered with `includeInactive=1` and dashboard summary.

## Session lifecycle and authorization

1. Protected route navigation, foreground visibility return, `pageshow` (including BFCache), and pre-mutation call a shared session verifier. Coalesce simultaneous checks; bind each promise to captured account/epoch. No idle auth polling.
2. While verification is pending, withhold private account/scope content, including cached data and drafts. Keep shell geometry; show verification state. Transient network failure blocks new private exposure/mutations and offers retry; it must not silently authorize from stale storage.
3. On success with same verified identity/scope, reopen memory queries. On changed identity/scope, increment epoch, abort owned requests, clear private query/tab state and visible drafts **before** showing new content. Refresh token renewal for the same account alone does not create a new resource key.
4. On logout start (before awaiting server), 401 refresh failure, 403 scope loss, storage account change or BFCache restoration into a logged-out session: revoke current identity, increment epoch, abort, clear memory and visible drafts. Persisted owner drafts stay on disk. Handle same-document auth events and cross-tab `storage` events; do not rely on `storage` firing in its origin tab.
5. Serialize token refresh. A refresh response can update credentials only if its captured account/epoch still owns the session. The layout's direct refresh and the client's refresh must use one owner-aware primitive; otherwise logout can be undone by late refresh.

Auth gates complement server authorization; they do not alter it. A single Chapter remains the intended product scope. Unexpected multiple managed Chapters must not be turned into new permissions by the cache layer.

## Concurrency, errors and ownership

Each query entry has generation, last successful data/time, subscriptions, in-flight promise, controller, dirty flag and LRU access index. A GET captures epoch, scope, query generation and unique promise owner. Reuse the same in-flight promise for ordinary GET and refresh within that generation. Refresh keeps last successful data, bypasses settled data, and starts at most one request. Double-click refresh must not increment generation per click.

Mutation/invalidation increments generation and aborts earlier reads. Publish a response only when epoch/scope/generation and promise owner still match; apply the same guard to hook state and side effects, not just map writes. In `finally`, clear ownership only if still the owner. Unmount removes subscription, not a shared request needed by another subscriber. Old success must not return as current success after account switch.

Network/500 errors preserve same-account successful data and `updatedAt`; show error + retry and stale-data indication. Partial Dashboard success updates each resource independently; display per-panel sync time, or use minimum successful timestamp for a complete-view label. Never label the entire view newly synchronized after one endpoint failed. 401/403 follow session revocation rather than retaining visible private stale data. Ambiguous mutation timeout does not imply success: revalidate affected state; never optimistically report reset/application.

## Capacity and tab state

Private API responses live in memory only. At client initialization enumerate sessionStorage and remove entries beginning `api_cache:` without logging names or values. Catch denied storage; do not make memory cache depend on it. No new API response persistence.

Default hard limits: 128 queries and 10 MiB serialized UTF-8 payload bytes, with accounted metadata; 32 tab snapshots. Estimate once per successful response, not per render. Prefer eviction of unsubscribed, least recently used queries; if all are active, keep active view state outside cache and decline caching additional/oversized results rather than exceed limits. Release unused request metadata. Drafts use a separate owner store and never enter LRU.

Snapshots retain filter/search text, pagination, selected current/history view, expanded rows and scroll offset. Restore only after identity verification and layout/data readiness; clamp scroll when rows shrink. Refresh must not reset snapshot or scroll. Do not persist iframe/React element instances or force player remounts to restore state.

## Mutation → resource matrix

All rows are scoped to verified affected Chapter and user. Refetch visible subscribed resources; mark unseen resources dirty so the next opening loads once.

| Confirmed result | Invalidate / reconcile | Preserve |
| --- | --- | --- |
| parse-sheet success | Draft parse result only | Dashboard, courses, current/history |
| future schedule accepted | current roster scheduledBatch + history | Learning/progress and dashboard courses unless server confirms applied |
| schedule cancelled | current roster + history | Learning/progress; draft |
| apply confirmed `appliedImmediately` / `item.status=APPLIED` | roster, history, affected member summaries/courses, relevant learning-cycle/progress/leaderboard resources | Unrelated Chapters, filters, scroll |
| due deadline reached | dirty roster/history; fetch visible view so existing applyDue flow runs; inspect result before reset invalidation | Draft; no hidden-route timer |
| assignment/department edit | roster, affected member detail/list; permission scope if manager affiliation changes | Course content; unrelated user detail |
| activate/deactivate/bulk change | roster, member summary/list/detail, affected progress aggregates and leaderboard | Unrelated Chapter resources |
| invitation create/resend/delete | matching invitation list; member summaries only if membership actually changes | Courses, roster absent membership change |
| course publish/edit/unpublish (later role rollout) | affected course detail/list + Chapter course aggregates as dictated by response | Member identities and transfer draft |
| mutation failed / timeout | revalidate affected visible source of truth; no asserted application/reset | Last verified data until auth revocation |

Do not infer successful application from HTTP 200 schedule acceptance alone. Existing server invalidation stays in place after committed transactions.

## Scheduled transitions

Capture known effectiveAt from successful roster/history results. A visible Current/History view owns at most one due timer, cleared on hide/unmount. Deadline expiry dirties both resources and refreshes the visible one once. On navigation/foreground return, compare deadline to current time before returning session cache, even if no timer ran. If deadline is far away, cap timeout and reschedule to avoid 32-bit overflow. Unknown schedules created elsewhere cannot be discovered indefinitely without a server notification or a business GET; document this freshness limitation and retain manual refresh. Do not pretend `/auth/me` supplies all business-state changes.

## Draft version 1

Key: `bbe:term-transition:v1:<userId>:<chapterId>`. Value: `{version:1, ownerUserId, chapterId, savedAt, sheetUrl, parsedResult, effectiveAt, termNumber, positionSelections}`. Validate envelope/types and all ownership fields against currently verified scope before reading into UI. Treat stored text as untrusted. Do not read, migrate, auto-restore or remove `bbe_term_transition_draft_*` legacy values.

Update owner memory synchronously on every edit. Debounce durable writes (300ms); flush on route departure, pagehide and visibility loss. Keep a dirty flag until persistence succeeds. Storage quota/security errors show “Bản nháp chưa được lưu trên thiết bị. Giữ trang này mở và thử lưu lại.” with retry; keep memory and warn on unload when durable save failed. Flush is best effort, not a guarantee against process termination before the debounce. F5 restoration requires a successful durable write. Refresh leaves all draft fields intact. Logout/account switch clears visible memory without deleting owner disk data; returning owner must reverify Chapter access before restoring it.

## Verification contract

Use [C01–C10 and status ledger](UI_UX_PERFORMANCE_FINAL_REPORT.md). Cache unit tests require deferred promises, fake time and two identities; browser tests need stable data predicates, category-aware network capture and separate mocked versus real-backend results. No deployment. **PASS**: specification covers interfaces, ownership, capacity, freshness and mutation matrix. **NOT VERIFIED**: runtime implementation and all security/race guarantees.
