import { Client } from 'pg'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import assert from 'node:assert/strict'

// Never load .env or fall back to DATABASE_URL.
const target = process.env.MIGRATION_REHEARSAL_URL
if (!target) throw new Error('MIGRATION_REHEARSAL_URL is required.')
const parsed = new URL(target)
if (parsed.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost'].includes(parsed.hostname) || !/^\/bbe_test_learning_rehearsal(?:_[a-z0-9]+)?$/.test(parsed.pathname)) throw new Error('Only loopback bbe_test_learning_rehearsal is allowed.')
const dir = path.resolve('scratch/learning-qa/rehearsal')
await mkdir(dir, { recursive: true })
const run = (command, args, env = process.env) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env, windowsHide: true })
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed: ${result.stderr || result.error || result.stdout}`)
  return result.stdout
}
const before = run('git', ['show', '58b8472:prisma/schema.prisma'])
await writeFile(path.join(dir, 'before.prisma'), before)
const engineEnv = {
  ...process.env, DATABASE_URL: target, DIRECT_URL: target,
  PRISMA_SCHEMA_ENGINE_BINARY: path.resolve('node_modules/@prisma/engines/schema-engine-windows.exe'),
  PRISMA_QUERY_ENGINE_LIBRARY: path.resolve('node_modules/@prisma/engines/query_engine-windows.dll.node'),
}
const sql = run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(dir, 'before.prisma'), '--script'], engineEnv)
const db = new Client({ connectionString: target })
await db.connect()
try {
  const existing = await db.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'")
  if (existing.rows[0].n !== 0) {
    const expected = Array.from(sql.matchAll(/CREATE TABLE "([^"]+)"/g), (match) => match[1]).sort()
    const actual = (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map((row) => row.tablename)
    assert.deepEqual(actual, expected, 'A retry is allowed only for the exact empty baseline schema.')
    for (const table of expected) assert.equal(Number((await db.query(`SELECT count(*) AS n FROM "${table}"`)).rows[0].n), 0, 'Baseline must have no data.')
  } else await db.query(sql)
  await db.query(`INSERT INTO users(id,email,password_hash,role,updated_at) VALUES ('00000000-0000-4000-8000-000000000001','rehearsal@example.invalid','test','MEMBER',now());
    INSERT INTO courses(id,title,created_by,updated_at) VALUES ('00000000-0000-4000-8000-000000000002','Legacy course','00000000-0000-4000-8000-000000000001',now());
    INSERT INTO sessions(id,course_id,title,sort_order,updated_at) VALUES ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','Legacy session',0,now());
    INSERT INTO lessons(id,session_id,title,sort_order,updated_at) VALUES ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000003','Legacy lesson',0,now());
    INSERT INTO lesson_progress(id,user_id,lesson_id,completed,completed_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004',true,'2026-01-02 03:04:05','2026-01-02 03:04:05');
    INSERT INTO star_ledger(id,user_id,amount,reason,reward_key,source_type,source_id) VALUES ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000001',7,'VIDEO_COMPLETION','legacy','VIDEO','00000000-0000-4000-8000-000000000004');
    INSERT INTO user_learning_assignments(id,user_id,course_id,due_at) VALUES ('00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','2026-11-30 17:00:00');`)
  const readBaseline = () => db.query(`SELECT (SELECT count(*) FROM users)::int AS users,
    (SELECT count(*) FROM lesson_progress)::int AS progress,
    (SELECT sum(amount) FROM star_ledger)::int AS stars,
    (SELECT due_at::text FROM user_learning_assignments LIMIT 1) AS due,
    (SELECT completed_at::text FROM lesson_progress LIMIT 1) AS completed`)
  const baseline = (await readBaseline()).rows[0]
  for (const migration of ['20261021_learning_cycles', '20261022_learning_guards', '20261022_reward_pause']) await db.query(await readFile(`prisma/migrations/${migration}/migration.sql`, 'utf8'))
  assert.deepEqual((await readBaseline()).rows[0], baseline)
  assert.equal((await db.query('SELECT provenance FROM star_ledger LIMIT 1')).rows[0].provenance, 'LEGACY')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM learning_programs')).rows[0].n, 4)
  assert.equal((await db.query("SELECT name FROM learning_programs WHERE code='CORE_MEMBER'")).rows[0].name, 'Chương trình học cho Thành viên')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM learning_targets')).rows[0].n, 18)
  assert.equal((await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='lesson_progress' AND column_name='completed_at'")).rows[0].data_type, 'timestamp without time zone')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM courses WHERE program_id IS NOT NULL')).rows[0].n, 0)
  await assert.rejects(db.query("DELETE FROM users WHERE id='00000000-0000-4000-8000-000000000001'"), /foreign key/)
  const report = { baselineCommit: '58b8472', baseline, migrated: (await readBaseline()).rows[0], programs: 4, targets: 18, legacyTimestampsConverted: false, coursesAutoClassified: 0, testDatabase: parsed.pathname.slice(1) }
  await mkdir('artifacts/migrations', { recursive: true })
  await writeFile('artifacts/migrations/migration-rehearsal.json', JSON.stringify(report, null, 2) + '\n')
  console.log('PASS: baseline -> all learning migrations; counts, stars, deadlines and timestamp values preserved; no automatic course mapping; historical identity FK prevents cascading deletion.')
} finally { await db.end() }
