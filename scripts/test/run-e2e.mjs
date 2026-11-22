// Real end-to-end suite: disposable PostgreSQL -> baseline/migrate/seed -> production build -> Playwright.
// Usage: npm run test:e2e [-- <playwright args>]. See docs/testing.md.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const require = createRequire(import.meta.url);
const { DEFAULT_URL, validateE2eTarget, appEnv } = require("./e2e-target.cjs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prismaCli = path.join(root, "node_modules", "prisma", "build", "index.js");
const schema = path.join(root, "prisma", "schema.prisma");
const container = "bbe-e2e-pg";

function run(label, command, args, env = {}, options = {}) {
  const started = Date.now();
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true, ...options });
  if (result.error || result.status !== 0) {
    const output = `${result.stdout || ""}\n${result.stderr || ""}`.replace(/postgres(ql)?:\/\/[^\s"']+/g, "[database URL redacted]");
    throw new Error(`${label} failed (exit ${result.status}):\n${output.trim().split("\n").slice(-30).join("\n")}`);
  }
  console.log(`  ok  ${label} (${Math.round((Date.now() - started) / 1000)}s)`);
  return result;
}

async function canConnect(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 3000 });
  try { await client.connect(); await client.query("SELECT 1"); return true; } catch { return false; } finally { await client.end().catch(() => {}); }
}

async function ensureDatabase(databaseUrl, explicit) {
  if (await canConnect(databaseUrl)) return;
  if (explicit) throw new Error("Cannot connect to E2E_DATABASE_URL; start that disposable database first");
  // Default target: a throwaway container bound to loopback only.
  const { databaseName, port } = validateE2eTarget(databaseUrl);
  const exists = spawnSync("docker", ["inspect", container], { encoding: "utf8" });
  if (exists.error) throw new Error("No database reachable and Docker is unavailable; set E2E_DATABASE_URL to a disposable loopback bbe_test_* database");
  if (exists.status === 0) run("docker start", "docker", ["start", container]);
  else run("docker run postgres:16", "docker", ["run", "-d", "--name", container, "-e", "POSTGRES_PASSWORD=pg", "-e", `POSTGRES_DB=${databaseName}`, "-p", `127.0.0.1:${port}:5432`, "postgres:16"]);
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await canConnect(databaseUrl)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Disposable PostgreSQL container did not become ready");
}

async function resetDatabase(databaseUrl) {
  const { databaseName } = validateE2eTarget(databaseUrl);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query("SELECT current_database() AS current");
    if (rows[0].current !== databaseName) throw new Error("Connected database does not match E2E_DATABASE_URL");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  } finally { await client.end(); }
  const env = { DATABASE_URL: databaseUrl, DIRECT_URL: databaseUrl, BASELINE_DATABASE_URL: databaseUrl, BASELINE_CONFIRM_DATABASE: databaseName, BASELINE_ALLOW_REMOTE: "" };
  run("db:baseline-empty", process.execPath, [path.join(root, "scripts", "db", "baseline-empty-database.mjs")], env);
  run("prisma migrate deploy", process.execPath, [prismaCli, "migrate", "deploy", "--schema", schema], env);
  run("prisma db seed", process.execPath, [prismaCli, "db", "seed", "--schema", schema], env);
}

async function main() {
  const explicit = Boolean(process.env.E2E_DATABASE_URL);
  const databaseUrl = process.env.E2E_DATABASE_URL || DEFAULT_URL;
  validateE2eTarget(databaseUrl);
  const env = appEnv(databaseUrl);

  console.log("Preparing disposable E2E database");
  await ensureDatabase(databaseUrl, explicit);
  await resetDatabase(databaseUrl);

  if (process.env.E2E_SKIP_BUILD === "1") console.log("  skip next build (E2E_SKIP_BUILD=1)");
  else run("next build", process.execPath, [path.join(root, "node_modules", "next", "dist", "bin", "next"), "build"], env);

  const playwright = spawnSync(process.execPath, [path.join(root, "node_modules", "@playwright", "test", "cli.js"), "test", "-c", "playwright.e2e.config.ts", ...process.argv.slice(2)], {
    cwd: root, env: { ...process.env, ...env, E2E_DATABASE_URL: databaseUrl }, stdio: "inherit", windowsHide: true,
  });
  process.exitCode = playwright.status ?? 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
