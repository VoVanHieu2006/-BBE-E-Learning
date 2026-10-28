import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifestPath = path.join(root, "prisma", "bootstrap", "20261012_manifest.json");
const schemaPath = path.join(root, "prisma", "bootstrap", "20261012_schema.sql");
const prismaCliPath = path.join(root, "node_modules", "prisma", "build", "index.js");

export function validateBaselineTarget(databaseUrl, confirmedDatabaseName, allowRemote) {
  if (!databaseUrl) throw new Error("Set BASELINE_DATABASE_URL to a separately provisioned empty database.");

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("BASELINE_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("BASELINE_DATABASE_URL must use the postgres:// or postgresql:// protocol.");
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!databaseName || confirmedDatabaseName !== databaseName) {
    throw new Error("Set BASELINE_CONFIRM_DATABASE to the exact database name from BASELINE_DATABASE_URL.");
  }

  const host = parsed.hostname.toLowerCase();
  const isLoopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host);
  if (!isLoopback && allowRemote !== "I_CREATED_AND_VERIFIED_THIS_EMPTY_DATABASE") {
    throw new Error("Remote targets require BASELINE_ALLOW_REMOTE=I_CREATED_AND_VERIFIED_THIS_EMPTY_DATABASE.");
  }

  return { databaseName, host, isLoopback };
}

export function decideBootstrapAction({ actualTables, expectedTables, migrationStates, migrationNames, rowCounts }) {
  const actual = [...actualTables].filter((name) => name !== "_prisma_migrations").sort();
  const expected = [...expectedTables].sort();
  const exactSchemaTables = actual.length === expected.length && actual.every((name, index) => name === expected[index]);
  const knownMigrationNames = new Set(migrationNames);

  for (const [name, state] of migrationStates) {
    if (!knownMigrationNames.has(name)) throw new Error(`Database has migration history outside this baseline: ${name}`);
    if (state.failed) throw new Error(`Migration ${name} has an unresolved failed attempt.`);
  }

  const allApplied = migrationNames.every((name) => migrationStates.get(name)?.applied === true);
  if (exactSchemaTables && allApplied) return "already-baselined";

  const hasRows = Object.values(rowCounts).some((count) => Number(count) > 0);
  if (!hasRows && exactSchemaTables) return "resume-history";

  const onlyMigrationTableExists = actual.length === 0;
  const hasNoHistory = migrationStates.size === 0;
  if (!hasRows && onlyMigrationTableExists && hasNoHistory) return "initialize";

  throw new Error("Refusing baseline: target is not empty and does not exactly match the recoverable baseline state.");
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function getMigrationStates(rows) {
  return new Map(rows.map((row) => [row.migration_name, {
    applied: row.applied,
    failed: row.failed,
  }]));
}

async function inspectTarget(client, expectedTables, migrationNames) {
  const tableResult = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const actualTables = tableResult.rows.map((row) => row.tablename);
  const hasMigrationTable = actualTables.includes("_prisma_migrations");

  let historyRows = [];
  if (hasMigrationTable) {
    const historyResult = await client.query(`
      SELECT migration_name,
             BOOL_OR(finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
             BOOL_OR(finished_at IS NULL AND rolled_back_at IS NULL) AS failed
      FROM public."_prisma_migrations"
      GROUP BY migration_name
    `);
    historyRows = historyResult.rows;
  }

  const migrationStates = getMigrationStates(historyRows);
  const schemaTables = actualTables.filter((name) => name !== "_prisma_migrations");
  const sortedExpectedTables = [...expectedTables].sort();
  const exactSchemaTables = schemaTables.length === expectedTables.length
    && [...schemaTables].sort().every((name, index) => name === sortedExpectedTables[index]);

  if (schemaTables.length > 0 && !exactSchemaTables) {
    throw new Error("Refusing baseline: public tables do not exactly match the represented schema.");
  }

  const preliminaryAction = decideBootstrapAction({
    actualTables,
    expectedTables,
    migrationStates,
    migrationNames,
    rowCounts: {},
  });
  if (preliminaryAction === "already-baselined" || schemaTables.length === 0) {
    return { action: preliminaryAction, migrationStates };
  }

  let rowCounts = {};
  if (schemaTables.length > 0) {
    for (const tableName of schemaTables) {
      const result = await client.query(`SELECT EXISTS (SELECT 1 FROM public.${quoteIdentifier(tableName)} LIMIT 1) AS has_rows`);
      rowCounts[tableName] = result.rows[0].has_rows ? 1 : 0;
    }
  }

  return {
    action: decideBootstrapAction({
      actualTables,
      expectedTables,
      migrationStates,
      migrationNames,
      rowCounts,
    }),
    migrationStates,
  };
}

function runResolve(migrationName, databaseUrl) {
  const engineDirectory = path.join(root, "node_modules", "@prisma", "engines");
  const schemaEngineName = process.platform === "win32"
    ? "schema-engine-windows.exe"
    : process.platform === "darwin"
      ? "schema-engine-darwin"
      : "schema-engine-debian-openssl-3.0.x";
  const schemaEnginePath = path.join(engineDirectory, schemaEngineName);
  const childEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: databaseUrl,
  };
  if (existsSync(schemaEnginePath)) childEnv.PRISMA_SCHEMA_ENGINE_BINARY = schemaEnginePath;

  const result = spawnSync(process.execPath, [
    prismaCliPath,
    "migrate",
    "resolve",
    "--applied",
    migrationName,
    "--schema",
    path.join(root, "prisma", "schema.prisma"),
  ], { cwd: root, env: childEnv, encoding: "utf8", windowsHide: true });

  if (result.error || result.status !== 0) {
    const detail = result.stderr || result.stdout || result.error?.message || "Prisma command failed";
    const safeDetail = detail.replaceAll(databaseUrl, "[database URL redacted]").trim();
    throw new Error(`Could not mark ${migrationName} as applied: ${safeDetail}`);
  }
}

async function main() {
  const databaseUrl = process.env.BASELINE_DATABASE_URL;
  const target = validateBaselineTarget(
    databaseUrl,
    process.env.BASELINE_CONFIRM_DATABASE,
    process.env.BASELINE_ALLOW_REMOTE,
  );

  if (!existsSync(prismaCliPath)) throw new Error("Local Prisma CLI is missing; run this only from the installed project workspace.");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const schemaSql = await readFile(schemaPath, "utf8");
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });

  try {
    await client.connect();
    const current = await client.query("SELECT current_database() AS database_name");
    if (current.rows[0]?.database_name !== target.databaseName) {
      throw new Error("Connected database does not match the explicitly confirmed target name.");
    }

    const inspected = await inspectTarget(client, manifest.tables, manifest.migrations);
    if (inspected.action === "already-baselined") {
      console.log(`No changes: ${target.databaseName} already has the baseline schema and migration history.`);
      return;
    }

    if (inspected.action === "initialize") {
      await client.query("BEGIN");
      try {
        await client.query(schemaSql);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      console.log(`Created baseline schema in empty database ${target.databaseName}.`);
    } else {
      console.log(`Resuming migration-history baseline in ${target.databaseName}; schema tables are already present and empty.`);
    }
  } finally {
    await client.end();
  }

  const refreshedClient = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  await refreshedClient.connect();
  try {
    const inspected = await inspectTarget(refreshedClient, manifest.tables, manifest.migrations);
    for (const migrationName of manifest.migrations) {
      if (inspected.migrationStates.get(migrationName)?.applied) continue;
      runResolve(migrationName, databaseUrl);
      console.log(`Recorded ${migrationName} as applied.`);
    }
  } finally {
    await refreshedClient.end();
  }

  console.log("Baseline complete. Future schema changes should use new forward migrations and prisma migrate deploy.");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
