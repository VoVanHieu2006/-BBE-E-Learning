// Re-cuts prisma/bootstrap/<name>_schema.sql + <name>_manifest.json on a disposable, empty, loopback bbe_test_* database.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

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
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("CUT_BASELINE_DATABASE_URL must point to a loopback host.");
  }
  if (!/^bbe_test_[a-z0-9_]+$/.test(databaseName)) throw new Error("CUT_BASELINE_DATABASE_URL database name must match bbe_test_*.");
  return { databaseName, user: decodeURIComponent(parsed.username || "postgres") };
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

function pgTool(tool, target, args, input) {
  const container = process.env.PG_DOCKER_CONTAINER;
  const command = container ? "docker" : tool;
  const fullArgs = container
    ? ["exec", "-i", container, tool, "-U", target.user, ...args, target.databaseName]
    : [...args, "--dbname", process.env.CUT_BASELINE_DATABASE_URL];
  const result = spawnSync(command, fullArgs, { input, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${tool} could not start (${result.error.message}); set PG_DOCKER_CONTAINER or install PostgreSQL client tools.`);
  return result;
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
  const databaseUrl = process.env.CUT_BASELINE_DATABASE_URL;
  const target = validateCutTarget(databaseUrl);

  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const tables = await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'");
    if (tables.rows[0].n !== 0) throw new Error(`${target.databaseName} is not empty; create a new disposable database.`);
  } finally {
    await client.end();
  }

  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrations = orderMigrations(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  const head = [...migrations].sort().at(-1);
  const name = process.env.CUT_BASELINE_NAME || head.slice(0, 8);

  const fromEmpty = prisma(["migrate", "diff", "--from-empty", "--to-schema-datamodel", schemaPrisma, "--script"], databaseUrl);
  const created = pgTool("psql", target, ["-X", "-q", "-v", "ON_ERROR_STOP=1"], fromEmpty);
  if (created.status !== 0) throw new Error(`Applying schema.prisma failed:\n${created.stderr}`);

  const logLines = [];
  for (const migration of migrations) {
    const sql = await readFile(path.join(migrationsDir, migration, "migration.sql"), "utf8");
    const replay = pgTool("psql", target, ["-X", "-q", "-v", "ON_ERROR_STOP=0"], stripTopLevelTransaction(sql));
    const errors = replay.stderr.split(/\r?\n/).filter((line) => line.includes("ERROR:"));
    logLines.push(`## ${migration}: ${errors.length} tolerated error(s)`, ...errors, "");
    console.log(`Replayed ${migration} (${errors.length} tolerated error(s)).`);
  }
  const logDir = path.join(root, "artifacts", "baseline-cut");
  await mkdir(logDir, { recursive: true });
  await writeFile(path.join(logDir, `${name}-replay.log`), logLines.join("\n"));

  const diff = prisma(["migrate", "diff", "--from-url", databaseUrl, "--to-schema-datamodel", schemaPrisma, "--script"], databaseUrl);
  await writeFile(path.join(logDir, `${name}-diff.sql`), diff);
  const unexpected = unexpectedDiffSections(diff);
  if (unexpected.length) throw new Error(`Unexpected schema.prisma drift after replay:\n${unexpected.join("\n\n")}`);

  const dump = pgTool("pg_dump", target, ["--schema-only", "--no-owner", "--no-privileges"]);
  if (dump.status !== 0) throw new Error(`pg_dump failed:\n${dump.stderr}`);

  const verify = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  await verify.connect();
  let tables;
  try {
    const result = await verify.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations' ORDER BY tablename");
    tables = result.rows.map((row) => row.tablename);
  } finally {
    await verify.end();
  }

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
