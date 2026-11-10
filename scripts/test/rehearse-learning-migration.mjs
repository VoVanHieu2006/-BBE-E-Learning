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
const release2 = process.argv.includes('--release-2')
// Read release SQL only; these files are authored separately, never generated here.
const release1Sql = await readFile(path.resolve('prisma/migrations/20261110_learning_affiliation_without_policy/migration.sql'), 'utf8')
const release2Sql = release2 ? await readFile(path.resolve('prisma/release-2/20261110_drop_learning_policy/migration.sql'), 'utf8') : null
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
  for (const migration of ['20261021_learning_cycles', '20261022_learning_guards', '20261022_reward_pause']) {
    await db.query(await readFile(path.resolve(`prisma/migrations/${migration}/migration.sql`), 'utf8'))
  }
  assert.deepEqual((await readBaseline()).rows[0], baseline)
  assert.equal((await db.query('SELECT provenance FROM star_ledger LIMIT 1')).rows[0].provenance, 'LEGACY')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM learning_programs')).rows[0].n, 4)
  assert.equal((await db.query("SELECT name FROM learning_programs WHERE code='CORE_MEMBER'")).rows[0].name, 'Chương trình học cho Thành viên')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM learning_targets')).rows[0].n, 18)
  assert.equal((await db.query("SELECT data_type FROM information_schema.columns WHERE table_name='lesson_progress' AND column_name='completed_at'")).rows[0].data_type, 'timestamp without time zone')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM courses WHERE program_id IS NOT NULL')).rows[0].n, 0)
  await assert.rejects(db.query("DELETE FROM users WHERE id='00000000-0000-4000-8000-000000000001'"), /foreign key/)
  // Explicit legacy evidence gives both releases nonempty cycle/path history to preserve.
  await db.query(`INSERT INTO learning_cycles(id,user_id,trigger_key,starts_at,provenance)
    VALUES ('00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000001','rehearsal:legacy','2026-01-01 00:00:00+00','LEGACY');
    INSERT INTO learning_paths(id,user_id,learning_cycle_id,starts_at,due_at,imported_due_at)
    VALUES ('00000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000008','2026-01-01 00:00:00+00','2026-11-30 17:00:00+00','2026-11-30 17:00:00+00');
    INSERT INTO cycle_lesson_progress(id,user_id,lesson_id,learning_cycle_id,furthest_seconds,completed_at,provenance)
    VALUES ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000008',100,'2026-01-02 03:04:05+00','LEGACY');`)
  const readEvidence = async () => {
    const evidence = {}
    for (const table of ['star_ledger', 'lesson_progress', 'user_learning_assignments', 'learning_cycles', 'cycle_lesson_progress', 'learning_paths', 'learning_path_changes']) {
      evidence[table] = (await db.query(`SELECT * FROM "${table}" ORDER BY id`)).rows
    }
    return evidence
  }
  const evidence = await readEvidence()
  const readGuard = async () => (await db.query(`SELECT p.oid::text AS oid, pg_get_functiondef(p.oid) AS definition, p.prosrc AS body
    FROM pg_proc p WHERE p.oid='enforce_single_learning_affiliation()'::regprocedure`)).rows[0]
  const readTriggers = async () => (await db.query(`SELECT tgname,tgenabled,tgfoid::text AS function_oid
    FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('single_affiliation_membership','single_affiliation_chapter') ORDER BY tgname`)).rows
  const originalGuard = await readGuard()
  const originalTriggers = await readTriggers()
  assert.equal(originalTriggers.length, 2, 'both deferred affiliation triggers must exist')
  assert.ok(originalTriggers.every(row => row.tgenabled === 'O'))
  const policyPresent = async () => (await db.query("SELECT to_regclass('public.learning_policy') IS NOT NULL AS present")).rows[0].present
  const assertRelease = async (label, expectedPolicyPresent) => {
    const guard = await readGuard()
    assert.equal(guard.oid, originalGuard.oid, `${label}: replacement keeps the function OID`)
    const executableBody = guard.body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '')
    assert.doesNotMatch(executableBody, /learning_policy/i, `${label}: affiliation function must not read the policy table`)
    assert.deepEqual(await readTriggers(), originalTriggers, `${label}: trigger bindings and enabled state are unchanged`)
    assert.equal(await policyPresent(), expectedPolicyPresent, `${label}: policy table lifecycle`)
    assert.deepEqual(await readEvidence(), evidence, `${label}: complete ledger, progress and deadline history is unchanged`)
    assert.deepEqual((await readBaseline()).rows[0], baseline)
  }
  const verifyTriggerWrites = async (label) => {
    // Roll back all probe writes. Never disable triggers or change replication role.
    await db.query('BEGIN')
    try {
      await db.query(`INSERT INTO organization_units(id,name,type,updated_at) VALUES
        ('00000000-0000-4000-8000-000000000011','Rehearsal Chapter','CHAPTER',now()),
        ('00000000-0000-4000-8000-000000000012','Rehearsal DNA','DNA',now());
        INSERT INTO chapters(id,name,organization_unit_id,updated_at) VALUES
        ('00000000-0000-4000-8000-000000000013','Rehearsal Chapter','00000000-0000-4000-8000-000000000011',now());
        INSERT INTO chapter_members(id,chapter_id,user_id) VALUES
        ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001');
        INSERT INTO organization_memberships(id,user_id,unit_id) VALUES
        ('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011');
        SET CONSTRAINTS ALL IMMEDIATE;`)
      assert.equal((await db.query("SELECT count(*)::int AS n FROM chapter_affiliation_intervals WHERE user_id='00000000-0000-4000-8000-000000000001' AND ends_at IS NULL")).rows[0].n, 1, `${label}: Chapter write records history`)
      await db.query(`SET CONSTRAINTS ALL DEFERRED;
        DELETE FROM chapter_members WHERE id='00000000-0000-4000-8000-000000000014';
        UPDATE organization_memberships SET status='ENDED',ends_at=timezone('UTC',clock_timestamp()) WHERE id='00000000-0000-4000-8000-000000000015';
        INSERT INTO organization_memberships(id,user_id,unit_id) VALUES
        ('00000000-0000-4000-8000-000000000016','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000012');
        SET CONSTRAINTS ALL IMMEDIATE;`)
      assert.equal((await db.query("SELECT count(*)::int AS n FROM chapter_affiliation_intervals WHERE user_id='00000000-0000-4000-8000-000000000001' AND ends_at IS NOT NULL")).rows[0].n, 1, `${label}: atomic Chapter-to-DNA transition closes history`)
      // With constraints immediate, the invalid Chapter insertion must fail here.
      await assert.rejects(db.query(`INSERT INTO chapter_members(id,chapter_id,user_id) VALUES
        ('00000000-0000-4000-8000-000000000017','00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001')`),
      error => error.code === '23514' && /SingleOrganizationAffiliationRequired/.test(error.message), `${label}: dual affiliation is rejected without policy activation`)
    } finally { await db.query('ROLLBACK') }
    await assertRelease(label, label === 'release-1')
  }

  await db.query(release1Sql)
  await assertRelease('release-1', true)
  await verifyTriggerWrites('release-1')
  let backupPath = null
  if (release2) {
    // Full SELECT * backup must succeed on disk before the opt-in drop is applied.
    const backup = await db.query('SELECT * FROM public.learning_policy ORDER BY id')
    backupPath = path.join(dir, `learning-policy-release-2-backup-${Date.now()}.json`)
    await writeFile(backupPath, JSON.stringify({ capturedAt: new Date().toISOString(), testDatabase: parsed.pathname.slice(1), columns: backup.fields.map(field => field.name), rows: backup.rows }, null, 2) + '\n', { flag: 'wx' })
    await db.query(release2Sql)
    await assertRelease('release-2', false)
    await verifyTriggerWrites('release-2')
  }
  const report = { baselineCommit: '58b8472', baseline, migrated: (await readBaseline()).rows[0], programs: 4, targets: 18, legacyTimestampsConverted: false, coursesAutoClassified: 0, testDatabase: parsed.pathname.slice(1), release1Applied: true, release2Applied: release2, policyTablePresent: await policyPresent(), backupPath, affiliationPolicyReads: false, triggerWritesVerified: release2 ? ['release-1', 'release-2'] : ['release-1'], fullLearningEvidencePreserved: true }
  await mkdir(path.resolve('artifacts/migrations'), { recursive: true })
  await writeFile(path.resolve('artifacts/migrations/migration-rehearsal.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`PASS: baseline and release 1${release2 ? ' + opt-in release 2 (backed up then dropped policy table)' : ' (policy table retained)'}; full ledger/progress/deadline history preserved; policy-free affiliation triggers accept writes, permit atomic transition and reject dual affiliation; no automatic course mapping; historical identity FK retained.`)
} finally { await db.end() }
