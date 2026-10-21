# Release runbook

## Before schema deployment

1. Freeze the release revision and inventory active application writers and scheduler instances.
2. Back up the application database with `pg_dump -Fc`. Restore it to a separate database and compare user/progress/assignment/attempt counts, total ledger amount and representative deadline/timestamp values. The included rehearsal proves the mechanics on synthetic data; rehearse again on a protected production backup before deployment.
3. Inspect migration history. Do not run historical seed/cleanup scripts or use `prisma db push` against production. This repository has existing baseline handling; do not assume its oldest migrations can recreate an empty database without the documented baseline procedure.
4. Review both new SQL migrations, catalog aliases, lock duration and deployment maintenance window. Use `prisma migrate deploy` through the application's existing deployment process only after migration history has been reconciled.
5. Deploy an application revision that understands the new schema, with `LEARNING_CUTOVER_ENABLED=false`. Verify legacy learning, manual/automatic submission and permissions before scheduling cutover.

## Admin preparation

1. Open `/admin/learning-policy`. Review all actual published courses and save each approved program mapping. No proposal is applied automatically.
2. Use organization normalization to assign known codes and add missing canonical Ban. Resolve ambiguous duplicates manually; normalization deliberately rejects them. President becomes a Chapter position at cutover, preserving legacy links in history.
3. Review every mandatory rule in `/admin/courses/mandatory`, including legacy rules outside recognized target scopes. Each course has one configured day budget shared across targets.
4. Configure non-overlapping transfer seasons through the Admin policy API with `code`, `startsAt`, `endsAt`, and `rewardBoundaryAt`. The boundary must be exactly April 1 or October 1 midnight Vietnam time and fall inside the season. Pre-cutover configuration may describe the current season; after cutover only future unused seasons can be configured. Resolve legacy `CHAPTER_MANAGER` appointments explicitly to Lead or President. Review dates and Chapter roster previews before scheduling transfers. Applied seasons cannot be rewritten.
5. Confirm the 4 canonical programs, 18 canonical targets, all published classifications, curriculum content and Chapter → DNA conversion audit requirements. Then enable `LEARNING_CUTOVER_ENABLED=true` in the release environment and schedule an explicit future `cutoverAt` through the authenticated Admin policy POST endpoint. Do not use this step as a substitute for the earlier release gates.

The first month is `[cutover, next UTC+7 month boundary)`. No old ledger entries are re-attributed. The one existing dual-affiliation account must be reviewed and its cutover conversion audited. Do not manually reset its progress or allocate a new monthly reward budget. Missing season configuration stops Chapter rewards after cutover; review valid early/late transfer evidence for the current season before activation. DNA resets follow fixed April/October boundaries independently of the Chapter scheduling window.

## Scheduler

Run `npm run learning:scheduler` as a supervised worker with explicit `LEARNING_CRON_BASE_URL` and `CRON_SECRET` (see script for supported configuration). Use HTTPS except loopback development. Keep the secret in deployment configuration, never in source control. The worker calls the authenticated internal transfer/learning worker, automatic submission and deadline endpoints every minute and logs expected/actual run times and lag. It prevents overlapping iterations within one process; database locks/idempotency protect repeated deliveries.

Monitor worker lag, failed/overdue transfer batches, unprocessed outbox count, attempts/last_error/available_at, pending KPI snapshots and inactive accounts awaiting retirement. Investigate repeated failures instead of deleting outbox or transfer records. Retrying synchronization must never rerun the atomic core reset.

## Recovery and rollback

- Before cutover, an application rollback is allowed only after confirming schema compatibility and that no new-policy data has been written.
- After cutover/new data, keep a schema-aware application revision. Repair forward or restore a coordinated database/application backup; do not restart the old reward writer against new data.
- A late scheduler uses the actual locked database time. It records planned and actual transfer times and does not backdate a reset or rewards.
- Monthly closure freezes facts even when KPI is missing. Add KPI through the normal API; pending completion fills missing KPI only. Never reopen the month's reward budget to repair KPI.
- Preserve already-incurred restrictions when deadlines increase. Retired identities are tombstones; do not reactivate them as ordinary users.

## Isolated checks

`test:learning-cycles-integration` and `test:learning-security` require an explicit loopback database named `bbe_test_learning_cycles`. The HTTP test also needs its own local app, test JWT secret and cron secret. They never fall back to the application database.

`test:migration-rehearsal` requires `MIGRATION_REHEARSAL_URL` pointing to an empty loopback database named `bbe_test_learning_rehearsal` or that prefix plus a simple suffix. It reconstructs the baseline schema from the recorded Git commit, adds synthetic historical evidence, applies all three migrations and writes a reconciliation report.

`test:reward-pause-integration` uses the same explicitly guarded local cycles database. It verifies continued progress without any reward ledger, pending transfers remaining paused, consumed reward opportunities, and no backpay after opening or moving to DNA. Run it sequentially with the other cycle integration suite because both intentionally configure the test policy.

`db:audit-learning-mapping` is read-only but reads the configured application database metadata; use the intended environment deliberately. UI QA preparation only accepts the dedicated loopback `bbe_test_learning_ui` database and copies course metadata plus synthetic accounts.
