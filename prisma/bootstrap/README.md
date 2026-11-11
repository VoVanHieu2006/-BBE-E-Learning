# Empty-database bootstrap

The migration history in `../migrations` is already applied to the configured database, so those SQL files must remain immutable. A pristine database cannot replay that history: `20250831_init` creates `assessments.course_id`, while `20261013_course_final_assessment` expects the older lesson-assessment shape and adds `course_id` again.

`20261110_schema.sql` is a generated snapshot of the current `schema.prisma`; `20261110_manifest.json` lists the migration history represented by that snapshot. To initialize a **brand-new, empty database only**:

1. Provision a separate database and set `BASELINE_DATABASE_URL` to its PostgreSQL connection URL. The script never falls back to `DATABASE_URL` or `DIRECT_URL`.
2. Set `BASELINE_CONFIRM_DATABASE` to the exact database name in that URL. For a remote host, also set `BASELINE_ALLOW_REMOTE=I_CREATED_AND_VERIFIED_THIS_EMPTY_DATABASE` after verifying it is a newly created empty database.
3. Run `npm run db:baseline-empty`.

The script checks the target name, public table set, migration history, and whether represented tables contain rows before acting. It refuses populated or partially mismatched targets; if the exact baseline is already present, it exits without scanning table contents or changing anything. It installs the snapshot in a transaction, then uses Prisma `migrate resolve --applied` to baseline only the migrations in the manifest. If history marking is interrupted after the schema transaction, rerunning is safe only while the represented tables remain empty; the script resumes missing history entries. Once complete, use normal forward migrations and `prisma migrate deploy` for future changes.

Do not run this against an existing database to repair it. Existing databases retain their current migration history and require ordinary forward migrations. The snapshot and manifest are a paired baseline artifact; update them only when deliberately cutting a new baseline. The snapshot does not include future migrations added after this baseline.

## Re-cutting the baseline (after adding migrations)

The old migration history cannot be replayed on an empty database: `20261013_course_final_assessment` expects the pre-init assessment shape, several later migrations depend on tables that production received through `db push`, `20261013_profile_quiz_configuration` alters a table that `20261014_learning_governance` creates, and `20261025_lead_binding_guards` patches a function created by `20261025_organization_integrity`. Therefore a fresh database is always initialised from the snapshot plus `prisma migrate deploy`, and the snapshot must be re-cut whenever migrations are added. `scripts/db/cut-baseline.mjs` does it:

```bash
docker exec bbe-test-pg psql -U postgres -c "CREATE DATABASE bbe_test_cut_<date>;"
CUT_BASELINE_DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:<port>/bbe_test_cut_<date> \
PG_DOCKER_CONTAINER=bbe-test-pg node scripts/db/cut-baseline.mjs
```

It accepts only an empty loopback `bbe_test_*` database. `PG_DOCKER_CONTAINER` runs `psql`/`pg_dump` inside that container; omit it when PostgreSQL 16+ client tools are on `PATH`. The script:

1. Applies `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`.
2. Replays every `prisma/migrations/*/migration.sql` in the order the history was applied (`profile_quiz_configuration` after `learning_governance`, `lead_binding_guards` after `organization_integrity`; see `RUN_AFTER`). Top-level `BEGIN;`/`COMMIT;` are removed so each statement runs on its own and an expected "already exists" error cannot roll back the triggers, functions, checks and partial indexes in the same file. Tolerated errors are logged to `artifacts/baseline-cut/<name>-replay.log`. They should only be "already exists", data steps on temp tables or old enum labels, and `LOCK TABLE` outside a transaction.
3. Fails if `prisma migrate diff --from-url <db> --to-schema-datamodel prisma/schema.prisma` reports anything other than migration-only indexes, FK `ON UPDATE` variants or column defaults (saved to `artifacts/baseline-cut/<name>-diff.sql`).
4. Runs `pg_dump --schema-only --no-owner --no-privileges`, removes `SET`/`set_config`/backslash/comment lines, then writes `<name>_schema.sql` and `<name>_manifest.json` (migrations in replay order, all public tables except `_prisma_migrations`). It also updates `baselineName` in `scripts/db/baseline-empty-database.mjs`. `<name>` defaults to the date prefix of the newest migration; set `CUT_BASELINE_NAME` to override. Delete the previous pair in the same commit if the name changed.
5. Verify on a new empty database with `npm run test:fresh-deploy` (baseline, `prisma migrate deploy` reporting no pending migrations, seed, then truncate, deploy and seed again).

Known, accepted differences from a production database built from the full history: defaults that migrations declared inside `CREATE TABLE` (`gen_random_uuid()` ids on `chapter_reorganizations`, `chapter_reorganization_items` and `final_exam_versions`, `clock_timestamp()` on `chapter_lead_bindings.bound_at`) follow `schema.prisma` instead, which means no database default because Prisma supplies the values. The snapshot contains no rows; reference data such as positions, learning programs and targets comes from `prisma/seed.ts`.
