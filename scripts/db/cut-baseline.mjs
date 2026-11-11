// Re-cuts prisma/bootstrap/<name>_schema.sql + <name>_manifest.json on a disposable, empty, loopback bbe_test_* database.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { randomBytes } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationsDir = path.join(root, "prisma", "migrations");
const bootstrapDir = path.join(root, "prisma", "bootstrap");
const schemaPrisma = path.join(root, "prisma", "schema.prisma");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const baselineScript = path.join(root, "scripts", "db", "baseline-empty-database.mjs");

// Order in which the history was actually applied: each key runs right after its value.
export const RUN_AFTER = {
  "20261013_profile_quiz_configuration": "20261014_learning_governance",
  "20261025_lead_binding_guards": "20261025_organization_integrity",
};

export function orderMigrations(names) {
  const ordered = [...names].sort().filter((name) => !RUN_AFTER[name]);
  for (const [name, after] of Object.entries(RUN_AFTER)) {
    if (!names.includes(name)) continue;
    const index = ordered.indexOf(after);
    if (index < 0) throw new Error(`${name} must run after ${after}, which is missing.`);
    ordered.splice(index + 1, 0, name);
  }
  return ordered;
}

// Without this, one tolerated "already exists" error rolls back every other object in a BEGIN/COMMIT migration.
export function stripTopLevelTransaction(sql) {
  return sql.replace(/^[ \t]*(BEGIN|COMMIT)[ \t]*;[ \t]*$/gim, "");
}

export function validateCutTarget(databaseUrl) {
  if (!databaseUrl) throw new Error("Set CUT_BASELINE_DATABASE_URL to a disposable empty loopback bbe_test_* database.");
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("Invalid CUT_BASELINE_DATABASE_URL; credentials suppressed."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || [...parsed.searchParams].length || parsed.hash) {
    throw new Error("CUT_BASELINE_DATABASE_URL must be PostgreSQL without query parameters or fragments.");
  }
  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("CUT_BASELINE_DATABASE_URL must point to a loopback host.");
  }
  if (!/^bbe_test_[a-z0-9_]+$/.test(databaseName)) throw new Error("CUT_BASELINE_DATABASE_URL database name must match bbe_test_*.");
  let user, password;
  try {
    user = decodeURIComponent(parsed.username || "postgres");
    password = decodeURIComponent(parsed.password);
  } catch { throw new Error("Invalid CUT_BASELINE_DATABASE_URL credentials; credentials suppressed."); }
  const hostname = parsed.hostname.toLowerCase();
  const host = hostname === "localhost" ? "127.0.0.1" : hostname.replace(/^\[|\]$/g, "");
  const port = Number(parsed.port || 5432);
  if (!port || [user, password].some((value) => /[\0\r\n]/.test(value))) throw new Error("Invalid CUT_BASELINE_DATABASE_URL connection fields.");
  parsed.hostname = host.includes(":") ? `[${host}]` : host;
  parsed.port = String(port);
  parsed.username = encodeURIComponent(user);
  parsed.password = encodeURIComponent(password);
  return { databaseName, databaseUrl: parsed.href, connection: { host, port, database: databaseName, user, password, ssl: false } };
}

const KNOWN_DIFF = /^-- (DropIndex|RenameIndex|DropForeignKey|AddForeignKey)$/;

// Prisma reports objects created only by migrations; anything structural means schema.prisma and history disagree.
export function unexpectedDiffSections(diffScript) {
  const sections = diffScript.split(/\n(?=-- [A-Z])/).map((s) => s.trim()).filter((s) => s.startsWith("-- "));
  return sections.filter((section) => {
    const [header, ...body] = section.split("\n");
    if (KNOWN_DIFF.test(header)) return false;
    if (header === "-- AlterTable") {
      const clauses = body.join(" ").split(/,\s*(?=ALTER COLUMN)/);
      return !clauses.every((clause) => /ALTER COLUMN "[^"]+" (SET DEFAULT .+|DROP DEFAULT);?$/.test(clause.replace(/^ALTER TABLE "[^"]+" /, "").trim()));
    }
    return true;
  });
}

export function pgToolInvocation(tool, target, args, container = process.env.PG_DOCKER_CONTAINER, sourceEnv = process.env) {
  const { database, user, password } = target.connection;
  // Published host ports do not apply inside Docker. The nonce verifies this endpoint.
  const { host, port } = container ? { host: "127.0.0.1", port: 5432 } : target.connection;
  const env = Object.fromEntries(Object.entries(sourceEnv).filter(([key]) => !/^PG/i.test(key)));
  env.PGPASSWORD = password;
  env.PGSSLMODE = "disable";
  const toolArgs = [`--host=${host}`, `--port=${port}`, `--username=${user}`, `--dbname=${database}`, "--no-password", ...args];
  return {
    command: container ? "docker" : tool,
    args: container ? ["exec", "-i", "--env", "PGPASSWORD", "--env", "PGSSLMODE=disable", container, tool, ...toolArgs] : toolArgs,
    env,
  };
}

function pgTool(tool, target, args, input) {
  const invocation = pgToolInvocation(tool, target, args);
  const result = spawnSync(invocation.command, invocation.args, { env: invocation.env, input, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${tool} could not start (${result.error.message}); set PG_DOCKER_CONTAINER or install PostgreSQL client tools.`);
  return result;
}

export function assertCutIdentity(target, identity, nonce) {
  if (typeof nonce !== "string" || !nonce || identity?.nonce !== nonce
    || identity?.database !== target.connection.database || identity?.user !== target.connection.user) {
    throw new Error("PostgreSQL tool database/user/nonce does not match the checked target; refusing to write.");
  }
}

export async function verifyToolTarget(client, target, runTool = pgTool, action = async () => {}) {
  const nonce = `cutbaseline:${randomBytes(32).toString("hex")}`;
  // PostgreSQL quotes the original comment (including NULL) for exact restoration.
  // Check the URL connection's database/user before writing even the nonce.
  const checked = await client.query(`SELECT format('COMMENT ON DATABASE %I IS %L', datname,
    shobj_description(oid, 'pg_database')) AS restore_sql FROM pg_database
    WHERE datname = current_database() AND datname = $1 AND current_user::text = $2`,
  [target.connection.database, target.connection.user]);
  const restoreSql = checked.rows[0]?.restore_sql;
  if (!restoreSql) throw new Error("Cannot verify checked PostgreSQL database/user; refusing to write.");
  try {
    // Database names are restricted to bbe_test_[a-z0-9_]+; the nonce is random hex.
    await client.query(`COMMENT ON DATABASE "${target.databaseName}" IS '${nonce}'`);
    // Read only the connected database's comment: pg_database itself is cluster-wide.
    // Never pass the expected nonce to psql, where echoing it would falsely prove identity.
    const probe = runTool("psql", target, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1"], `SELECT json_build_object(
      'database', current_database(), 'user', current_user,
      'nonce', shobj_description(oid, 'pg_database')) FROM pg_database WHERE datname = current_database();`);
    if (probe.status !== 0) throw new Error("Cannot verify PostgreSQL tool target; refusing to write.");
    let identity;
    try { identity = JSON.parse(probe.stdout.trim()); } catch { throw new Error("Invalid PostgreSQL tool identity; refusing to write."); }
    assertCutIdentity(target, identity, nonce);
    return await action();
  } finally {
    // Keep cleanup on the URL connection, even if probing, writing or dumping fails.
    await client.query(restoreSql);
  }
}

// SQL files contain dollar-quoted PL/pgSQL bodies; splitting on ';' would skip guards.
// Remove comments only outside quoted tokens, including nested block comments.
export function splitSqlStatements(sql) {
  const statements = [];
  let statement = "";
  const flush = () => {
    const trimmed = statement.trim();
    if (trimmed && !/^(BEGIN|COMMIT)\s*;?$/i.test(trimmed)) statements.push(trimmed);
    statement = "";
  };
  for (let i = 0; i < sql.length;) {
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end;
      statement += " ";
    } else if (sql.startsWith("/*", i)) {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.startsWith("/*", i)) { depth++; i += 2; }
        else if (sql.startsWith("*/", i)) { depth--; i += 2; }
        else i++;
      }
      if (depth) throw new Error("Unterminated SQL comment.");
      statement += " ";
    } else if (sql[i] === "'" || sql[i] === '"') {
      const start = i, quote = sql[i++];
      const escaped = quote === "'" && /(?:^|[^\w$])[eE]$/.test(statement);
      let closed = false;
      while (i < sql.length) {
        if (escaped && sql[i] === "\\") { i += 2; continue; }
        if (sql[i++] === quote) {
          if (sql[i] === quote) { i++; continue; }
          closed = true;
          break;
        }
      }
      if (!closed) throw new Error("Unterminated SQL quote.");
      statement += sql.slice(start, i);
    } else {
      const dollar = sql.slice(i).match(/^\$(?:[a-zA-Z_]\w*)?\$/)?.[0];
      if (dollar) {
        const end = sql.indexOf(dollar, i + dollar.length);
        if (end < 0) throw new Error("Unterminated SQL dollar quote.");
        statement += sql.slice(i, end + dollar.length);
        i = end + dollar.length;
      } else {
        const char = sql[i++];
        statement += char;
        if (char === ";") flush();
      }
    }
  }
  flush();
  return statements;
}

export function isToleratedReplayError(migration, sql, error) {
  // The cut database is built from schema.prisma at head, where the enum rename of this migration already happened.
  if (migration === "20261110_standardize_roles_positions" && error.code === "22023"
    && /^ALTER\s+TYPE\s+\w+\s+RENAME\s+VALUE\b/i.test(sql) && /is not an existing enum label/.test(error.message)) return true;
  // Never forgive these, including duplicate-object failures: their bodies define guards.
  if (/^(CREATE\s+(OR\s+REPLACE\s+)?(FUNCTION|(?:CONSTRAINT\s+)?TRIGGER|POLICY)|ALTER\s+TYPE)\b/i.test(sql)) return false;
  if (error.code === "42P07" && /^CREATE\s+(?:(?:UNIQUE|TEMP(?:ORARY)?)\s+)?(TABLE|INDEX)\b/i.test(sql)) return true;
  if (error.code === "42710" && /^(CREATE\s+TYPE\b|ALTER\s+TABLE\b[\s\S]*\bADD\s+CONSTRAINT\b)/i.test(sql)) return true;
  if (error.code === "42701" && /^ALTER\s+TABLE\b[\s\S]*\bADD\s+COLUMN\b/i.test(sql)) return true;
  // Data-copy statements that name a column dropped by a later migration (empty tables, so a no-op).
  if (error.code === "42703" && /^(INSERT\s+INTO|UPDATE)\b/i.test(sql)
    && migration === "20261016_course_final_versions" && /column "duration_seconds"/.test(error.message)) return true;
  // Old data statements compare users.role with the enum value renamed later (CHAPTER_LEADER -> LEAD).
  // They only touch empty tables here, so the failed backfill is a no-op; function/trigger bodies never reach this.
  if (error.code === "22P02" && /^(INSERT\s+INTO|CREATE\s+TEMP(?:ORARY)?\s+TABLE|UPDATE|WITH)\b/i.test(sql)
    && /invalid input value for enum user_role: "CHAPTER_LEADER"/.test(error.message)) return true;
  const missingTempTables = {
    "20261016_course_final_versions": ["_final_question_map", "_final_option_map"],
    "20261025_organization_integrity": ["lead_binding_candidates"],
    "20261110_standardize_roles_positions": ["p03_target_names"],
  };
  if (error.code === "42P01" && (missingTempTables[migration] || []).some((name) => error.message === `relation "${name}" does not exist` && sql.includes(name))) return true;
  return error.code === "25P01" && /^LOCK\s+TABLE\b/i.test(sql) && [
    "20261025_organization_integrity", "20261025_lead_binding_guards", "20261110_standardize_roles_positions",
  ].includes(migration);
}

export async function replayMigration(client, migration, sql, logLines) {
  let tolerated = 0;
  for (const [index, statement] of splitSqlStatements(sql).entries()) {
    try { await client.query(statement); }
    catch (error) {
      const allowed = isToleratedReplayError(migration, statement, error);
      const line = `${allowed ? "tolerated" : "FATAL"} ${migration} statement ${index + 1} [${error.code || "no SQLSTATE"}]: ${error.message}`;
      logLines.push(line);
      if (!allowed) throw new Error(line);
      tolerated++;
    }
  }
  logLines.push(`## ${migration}: ${tolerated} tolerated error(s)`, "");
  return tolerated;
}

const REQUIRED_FUNCTIONS = [
  "assert_organization_integrity(uuid)", "enforce_single_learning_affiliation()", "immutable_chapter_lead_binding()",
  "serialize_organization_writer()", "record_learning_account_state()", "record_learning_chapter_affiliation()",
  "record_learning_course_publication()", "normalize_organization_email()", "enforce_organization_integrity()",
  "enforce_organization_definition_integrity()", "prevent_member_lead_promotion()",
];
const REQUIRED_TRIGGERS = [
  ["users", "learning_account_state", "record_learning_account_state"],
  ["chapter_members", "learning_chapter_affiliation", "record_learning_chapter_affiliation"],
  ["courses", "learning_course_publication", "record_learning_course_publication"],
  ["organization_memberships", "single_affiliation_membership", "enforce_single_learning_affiliation"],
  ["chapter_members", "single_affiliation_chapter", "enforce_single_learning_affiliation"],
  ["users", "organization_email", "normalize_organization_email"],
  ["chapter_lead_bindings", "immutable_lead_binding", "immutable_chapter_lead_binding"],
  ["organization_memberships", "serialize_organization_membership", "serialize_organization_writer"],
  ["chapter_members", "serialize_chapter_membership", "serialize_organization_writer"],
  ["position_assignments", "serialize_position_assignment", "serialize_organization_writer"],
  ["organization_memberships", "organization_membership_integrity", "enforce_organization_integrity"],
  ["chapter_members", "chapter_membership_integrity", "enforce_organization_integrity"],
  ["position_assignments", "position_assignment_integrity", "enforce_organization_integrity"],
  ["users", "organization_user_role_integrity", "enforce_organization_integrity"],
  ["organization_units", "organization_unit_definition_integrity", "enforce_organization_definition_integrity"],
  ["positions", "organization_position_definition_integrity", "enforce_organization_definition_integrity"],
  ["users", "no_member_lead_promotion", "prevent_member_lead_promotion"],
];

export function assertRequiredObjects({ functions, triggers }) {
  const missing = REQUIRED_FUNCTIONS.filter((signature) => !functions.includes(signature));
  for (const [table, name, fn] of REQUIRED_TRIGGERS) {
    if (!triggers.some((t) => t.table === table && t.name === name && t.function === fn && ["O", "A"].includes(t.enabled))) missing.push(`${table}.${name}`);
  }
  if (missing.length) throw new Error(`Missing or disabled baseline guards: ${missing.join(", ")}`);
}

async function verifyRequiredObjects(client) {
  const functions = await client.query("SELECT signature FROM unnest($1::text[]) AS signature WHERE to_regprocedure('public.' || signature) IS NOT NULL", [REQUIRED_FUNCTIONS]);
  const triggers = await client.query(`SELECT c.relname AS "table", t.tgname AS name, p.proname AS "function", t.tgenabled AS enabled
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
    WHERE n.nspname='public' AND pn.nspname='public' AND NOT t.tgisinternal`);
  assertRequiredObjects({ functions: functions.rows.map((row) => row.signature), triggers: triggers.rows });
}

function prisma(args, databaseUrl) {
  const result = spawnSync(process.execPath, [prismaCli, ...args], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl },
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`prisma ${args[0]} ${args[1]} failed: ${(result.stderr || result.stdout).replaceAll(databaseUrl, "[url]")}`);
  return result.stdout;
}

export function cleanDump(dump, headMigration) {
  const body = dump
    .split(/\r?\n/)
    .filter((line) => !/^(SET |SELECT pg_catalog\.set_config|\\|--)/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [
    `-- Baseline schema at migration head ${headMigration}, cut by scripts/db/cut-baseline.mjs.`,
    "-- schema.prisma first, then every migration replayed statement by statement; see prisma/bootstrap/README.md.",
    'CREATE SCHEMA IF NOT EXISTS "public";',
    "",
    body,
    "",
  ].join("\n");
}

async function main() {
  const target = validateCutTarget(process.env.CUT_BASELINE_DATABASE_URL);

  const client = new Client({ ...target.connection, password: () => target.connection.password, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await verifyToolTarget(client, target, pgTool, async () => {
      const tables = await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
      if (tables.rows[0].n !== 0) throw new Error(`${target.databaseName} is not empty; create a new disposable database.`);
      await cutBaseline(target, client);
    });
  } finally {
    await client.end();
  }
}

async function cutBaseline(target, client) {
  const databaseUrl = target.databaseUrl;
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrations = orderMigrations(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  const head = [...migrations].sort().at(-1);
  const name = process.env.CUT_BASELINE_NAME || head.slice(0, 8);

  const fromEmpty = prisma(["migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaPrisma, "--script"], databaseUrl);
  const created = pgTool("psql", target, ["-X", "-q", "-v", "ON_ERROR_STOP=1"], fromEmpty);
  if (created.status !== 0) throw new Error(`Applying schema.prisma failed:\n${created.stderr}`);

  const logLines = [];
  const logDir = path.join(root, "artifacts", "baseline-cut");
  await mkdir(logDir, { recursive: true });
  try {
    for (const migration of migrations) {
      const sql = await readFile(path.join(migrationsDir, migration, "migration.sql"), "utf8");
      const tolerated = await replayMigration(client, migration, sql, logLines);
      console.log(`Replayed ${migration} (${tolerated} tolerated error(s)).`);
    }
  } finally {
    // Keep the audit trail even when replay aborts; no snapshot is written on failure.
    await writeFile(path.join(logDir, `${name}-replay.log`), logLines.join("\n"));
  }
  await verifyRequiredObjects(client);

  const diff = prisma(["migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", schemaPrisma, "--script"], databaseUrl);
  await writeFile(path.join(logDir, `${name}-diff.sql`), diff);
  const unexpected = unexpectedDiffSections(diff);
  if (unexpected.length) throw new Error(`Unexpected schema.prisma drift after replay:\n${unexpected.join("\n\n")}`);

  const dump = pgTool("pg_dump", target, ["--schema-only", "--no-owner", "--no-privileges"]);
  if (dump.status !== 0) throw new Error(`pg_dump failed:\n${dump.stderr}`);

  const result = await client.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename");
  const tables = result.rows.map((row) => row.tablename);

  await writeFile(path.join(bootstrapDir, `${name}_schema.sql`), cleanDump(dump.stdout, head));
  await writeFile(path.join(bootstrapDir, `${name}_manifest.json`), `${JSON.stringify({
    description: `Migration history and public tables represented by ${name}_schema.sql. Update only when deliberately cutting a new baseline.`,
    migrations,
    tables,
  }, null, 2)}\n`);

  const script = await readFile(baselineScript, "utf8");
  await writeFile(baselineScript, script.replace(/const baselineName = "[^"]+";/, `const baselineName = "${name}";`));

  console.log(`Wrote prisma/bootstrap/${name}_schema.sql and ${name}_manifest.json (${migrations.length} migrations, ${tables.length} tables).`);
  console.log(`Known migration-only differences vs schema.prisma: artifacts/baseline-cut/${name}-diff.sql`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
