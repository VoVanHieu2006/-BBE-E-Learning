# Empty-database bootstrap

The migration history in `../migrations` is already applied to the configured database, so those SQL files must remain immutable. A pristine database cannot replay that history: `20250831_init` creates `assessments.course_id`, while `20261013_course_final_assessment` expects the older lesson-assessment shape and adds `course_id` again.

`20261012_schema.sql` is a generated snapshot of the current `schema.prisma`; `20261012_manifest.json` lists the migration history represented by that snapshot. To initialize a **brand-new, empty database only**:

1. Provision a separate database and set `BASELINE_DATABASE_URL` to its PostgreSQL connection URL. The script never falls back to `DATABASE_URL` or `DIRECT_URL`.
2. Set `BASELINE_CONFIRM_DATABASE` to the exact database name in that URL. For a remote host, also set `BASELINE_ALLOW_REMOTE=I_CREATED_AND_VERIFIED_THIS_EMPTY_DATABASE` after verifying it is a newly created empty database.
3. Run `npm run db:baseline-empty`.

The script checks the target name, public table set, migration history, and whether represented tables contain rows before acting. It refuses populated or partially mismatched targets; if the exact baseline is already present, it exits without scanning table contents or changing anything. It installs the snapshot in a transaction, then uses Prisma `migrate resolve --applied` to baseline only the migrations in the manifest. If history marking is interrupted after the schema transaction, rerunning is safe only while the represented tables remain empty; the script resumes missing history entries. Once complete, use normal forward migrations and `prisma migrate deploy` for future changes.

Do not run this against an existing database to repair it. Existing databases retain their current migration history and require ordinary forward migrations. The snapshot and manifest are a paired baseline artifact; update them only when deliberately cutting a new baseline. The snapshot does not include future migrations added after this baseline.
