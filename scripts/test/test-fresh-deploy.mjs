// Rehearses deployment on a disposable bbe_test_* database: (A) a completely empty database
// is baselined, migrated and seeded; (B) its data is truncated, then migrate deploy and seed run again.
import { readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prismaCliPath = path.join(root, "node_modules", "prisma", "build", "index.js");
const schemaPath = path.join(root, "prisma", "schema.prisma");

export function validateFreshDeployTarget(target) {
  if (!target) throw new Error("Explicit TEST_DATABASE_URL for a disposable local bbe_test_* database is required");
  let url;
  try { url = new URL(target); } catch { throw new Error("Invalid TEST_DATABASE_URL; credentials suppressed"); }
  const allowedParams = ["schema", "connection_limit", "pool_timeout", "connect_timeout"];
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !/^\/bbe_test_[a-z0-9_]+$/.test(url.pathname)
    || [...url.searchParams.keys()].some((key) => !allowedParams.includes(key))
    || (url.searchParams.has("schema") && url.searchParams.get("schema") !== "public")) {
    throw new Error("Only loopback disposable bbe_test_* PostgreSQL databases with public schema are allowed");
  }
  return { databaseName: url.pathname.slice(1) };
}

function redact(text, secret) {
  return String(text || "").replaceAll(secret, "[database URL redacted]").replace(/postgres(ql)?:\/\/[^\s"']+/g, "[database URL redacted]");
}

function run(label, args, env, databaseUrl) {
  const started = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: root, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true, shell: false,
  });
  const output = redact(`${result.stdout || ""}\n${result.stderr || ""}`, databaseUrl);
  if (result.error || result.status !== 0) {
    throw new Error(`${label} failed (exit ${result.status}):\n${output.trim().split("\n").slice(-40).join("\n")}`);
  }
  console.log(`  ok  ${label} (${Math.round((Date.now() - started) / 1000)}s)`);
  return output;
}

async function query(databaseUrl, sql) {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  await client.connect();
  try { return (await client.query(sql)).rows; } finally { await client.end(); }
}

async function publicTables(databaseUrl) {
  const rows = await query(databaseUrl, "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
  return rows.map((row) => row.tablename);
}

function quote(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function migrateDeploy(env, databaseUrl) {
  const output = run("prisma migrate deploy", [prismaCliPath, "migrate", "deploy", "--schema", schemaPath], env, databaseUrl);
  assert(/No pending migrations to apply|applied/i.test(output), "migrate deploy reported a result");
}

function seed(env, databaseUrl) {
  run("prisma db seed", [prismaCliPath, "db", "seed", "--schema", schemaPath], env, databaseUrl);
}

async function verifyDeployedState(databaseUrl, label) {
  const migrationNames = readdirSync(path.join(root, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  const history = await query(databaseUrl, `
    SELECT migration_name,
           BOOL_OR(finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
           BOOL_OR(finished_at IS NULL AND rolled_back_at IS NULL) AS failed
    FROM public."_prisma_migrations" GROUP BY migration_name`);
  const applied = new Set(history.filter((row) => row.applied).map((row) => row.migration_name));
  const missing = migrationNames.filter((name) => !applied.has(name));
  assert(missing.length === 0, `${label}: migrations not applied: ${missing.join(", ")}`);
  assert(!history.some((row) => row.failed), `${label}: migration history has failed attempts`);

  const [counts] = await query(databaseUrl, `
    SELECT
      (SELECT count(*) FROM users WHERE role = 'ADMIN')::int AS admins,
      (SELECT count(*) FROM users WHERE role <> 'ADMIN')::int AS non_admins,
      (SELECT count(*) FROM chapters)::int AS chapters,
      (SELECT count(*) FROM positions)::int AS positions,
      (SELECT count(*) FROM learning_programs)::int AS programs,
      (SELECT count(*) FROM learning_targets)::int AS targets,
      (SELECT count(*) FROM courses)::int AS courses,
      (SELECT count(*) FROM lessons)::int AS lessons,
      (SELECT count(*) FROM final_exam_versions WHERE is_active)::int AS active_final_versions,
      (SELECT count(*) FROM users u WHERE u.role <> 'ADMIN' AND (
         SELECT count(*) FROM position_assignments p WHERE p.user_id = u.id AND p.starts_at <= now() AND (p.ends_at IS NULL OR p.ends_at > now())
       ) <> 1)::int AS users_without_single_position,
      (SELECT count(*) FROM users u WHERE EXISTS (SELECT 1 FROM chapter_members c WHERE c.user_id = u.id)
         AND EXISTS (SELECT 1 FROM organization_memberships m JOIN organization_units o ON o.id = m.unit_id
                     WHERE m.user_id = u.id AND o.type IN ('DNA', 'DNA_GROUP') AND (m.ends_at IS NULL OR m.ends_at > now())))::int AS chapter_and_dna,
      (SELECT count(*) FROM users u WHERE u.role = 'LEAD' AND NOT EXISTS (
         SELECT 1 FROM position_assignments p JOIN positions s ON s.id = p.position_id
         WHERE p.user_id = u.id AND s.code IN ('CHAPTER_LEAD', 'DNA_LEAD') AND (p.ends_at IS NULL OR p.ends_at > now())))::int AS leads_without_lead_position`);
  assert(counts.admins >= 1, `${label}: an ADMIN account exists`);
  assert(counts.non_admins > 0 && counts.chapters > 0 && counts.courses > 0 && counts.lessons > 0, `${label}: demo data was seeded`);
  assert(counts.positions === 6, `${label}: six canonical positions`);
  assert(counts.programs > 0 && counts.targets > 0, `${label}: learning catalog was seeded`);
  assert(counts.users_without_single_position === 0, `${label}: every non-admin holds exactly one current position`);
  assert(counts.chapter_and_dna === 0, `${label}: nobody is in a Chapter and DNA at once`);
  assert(counts.leads_without_lead_position === 0, `${label}: every LEAD holds CHAPTER_LEAD or DNA_LEAD`);
  console.log(`  ok  ${label} state: ${JSON.stringify(counts)}`);
}

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  const { databaseName } = validateFreshDeployTarget(databaseUrl);
  if (!existsSync(prismaCliPath)) throw new Error("Local Prisma CLI is missing");
  const [{ current }] = await query(databaseUrl, "SELECT current_database() AS current");
  assert(current === databaseName, "connected database matches TEST_DATABASE_URL");

  const env = {
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
    BASELINE_DATABASE_URL: databaseUrl,
    BASELINE_CONFIRM_DATABASE: databaseName,
    BASELINE_ALLOW_REMOTE: "",
  };

  console.log(`Scenario A: completely empty database (${databaseName})`);
  await query(databaseUrl, "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  assert((await publicTables(databaseUrl)).length === 0, "database is empty before baseline");
  run("db:baseline-empty", [path.join(root, "scripts", "db", "baseline-empty-database.mjs")], env, databaseUrl);
  migrateDeploy(env, databaseUrl);
  seed(env, databaseUrl);
  await verifyDeployedState(databaseUrl, "A");

  console.log("Scenario B: truncate data, keep schema and _prisma_migrations, deploy and seed again");
  const [{ migrations_before }] = await query(databaseUrl, `SELECT count(*)::int AS migrations_before FROM public."_prisma_migrations"`);
  const dataTables = (await publicTables(databaseUrl)).filter((name) => name !== "_prisma_migrations");
  await query(databaseUrl, `TRUNCATE TABLE ${dataTables.map((name) => `public.${quote(name)}`).join(", ")} CASCADE`);
  const [{ rows_left }] = await query(databaseUrl, `SELECT (${dataTables.map((name) => `(SELECT count(*) FROM public.${quote(name)})`).join(" + ")})::int AS rows_left`);
  assert(rows_left === 0, "all data tables are empty after TRUNCATE");
  const [{ migrations_after }] = await query(databaseUrl, `SELECT count(*)::int AS migrations_after FROM public."_prisma_migrations"`);
  assert(migrations_after === migrations_before, "_prisma_migrations is preserved");
  migrateDeploy(env, databaseUrl);
  seed(env, databaseUrl);
  await verifyDeployedState(databaseUrl, "B");

  console.log("Fresh-deploy rehearsal passed (A: empty database, B: truncated database).");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(redact(error.message, process.env.TEST_DATABASE_URL || "\u0000"));
    process.exitCode = 1;
  });
}
