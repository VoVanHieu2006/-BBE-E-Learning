import nextEnv from '@next/env'
import { Client } from 'pg'
import { readFile, mkdir, writeFile } from 'node:fs/promises'

nextEnv.loadEnvConfig(process.cwd())
const db = new Client({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 15000 })
try {
  await db.connect()
  await db.query('BEGIN')
  await db.query("SET LOCAL TIME ZONE 'UTC'")
  await db.query("SET LOCAL lock_timeout='5s'")
  await db.query("SET LOCAL statement_timeout='30s'")
  const { rows: installed } = await db.query("SELECT 1 FROM pg_proc WHERE proname='assert_organization_integrity'")
  const { rows: dnaGuard } = await db.query("SELECT 1 FROM pg_proc WHERE proname='assert_organization_integrity' AND prosrc LIKE '%LeadChapterCannotJoinDna%'")
  const pending = [!installed.length && '20261025_organization_integrity', !dnaGuard.length && '20261025_lead_binding_guards'].filter(Boolean)
  for (const name of pending) await db.query((await readFile(`prisma/migrations/${name}/migration.sql`, 'utf8')).replace(/^BEGIN;\s*/, '').replace(/COMMIT;\s*$/, ''))
  const { rows: counts } = await db.query('SELECT count(*)::int AS permanent_bindings FROM chapter_lead_bindings')
  const { rows: ledger } = await db.query("SELECT to_regclass('_prisma_migrations') IS NOT NULL AS tracked")
  const migrations = ledger[0].tracked ? (await db.query('SELECT migration_name,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY started_at')).rows : []
  await db.query('ROLLBACK')
  const result = { outcome: 'PASS', mode: pending.length ? 'DDL_AND_DATA_DRY_RUN_ROLLED_BACK' : 'POST_DEPLOY_READ_VERIFICATION', pendingMigrations: pending, alreadyInstalled: pending.length === 0, ...counts[0], migrations }
  await mkdir('docs/security-audit', { recursive: true })
  await writeFile(`docs/security-audit/${pending.length ? 'migration-dry-run' : 'migration-after'}.json`, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} catch (error) {
  await db.query('ROLLBACK').catch(() => {})
  console.error(JSON.stringify({ outcome: 'NOT_APPLIED', code: error.code, reason: ['23514', 'P0001'].includes(error.code) ? error.message : 'Migration dry-run failed; no changes committed.' }))
  process.exitCode = 1
} finally { await db.end().catch(() => {}) }
