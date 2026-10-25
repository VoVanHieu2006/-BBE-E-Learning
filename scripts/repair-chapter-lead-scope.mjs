import nextEnv from '@next/env'
import { Client } from 'pg'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'

nextEnv.loadEnvConfig(process.cwd())
const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
const userRef = args.includes('--user-ref') ? option('--user-ref') : ''
const keepChapterId = args.includes('--keep-chapter') ? option('--keep-chapter') : ''
const apply = args.includes('--apply')
const outputDir = args.includes('--output-dir') ? option('--output-dir') : 'docs/security-audit'
if (!/^[a-f0-9]{32}$/.test(userRef) || !/^[a-f0-9-]{36}$/.test(keepChapterId)) throw new Error('Explicit audited --user-ref and --keep-chapter are required.')
if (apply && !args.includes('--approved-plan')) throw new Error('--apply requires the exact --approved-plan from a reviewed dry run.')
const db = new Client({ connectionString: process.env.ORGANIZATION_TEST_DATABASE_URL || process.env.DIRECT_URL || process.env.DATABASE_URL, connectionTimeoutMillis: 15000 })
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
try {
  await db.connect()
  await db.query(apply ? 'BEGIN ISOLATION LEVEL SERIALIZABLE' : 'BEGIN READ ONLY')
  await db.query("SET LOCAL TIME ZONE 'UTC'")
  await db.query("SET LOCAL statement_timeout='30s'")
  const { rows: users } = await db.query(`SELECT id,role FROM users WHERE md5(id::text)=$1${apply ? ' FOR UPDATE' : ''}`, [userRef])
  assert.equal(users.length, 1, 'Audited identity must resolve to exactly one user.')
  const user = users[0]
  assert.notEqual(user.role, 'ADMIN', 'This repair must never narrow a global Admin.')
  const { rows: chapters } = await db.query('SELECT id,name,organization_unit_id FROM chapters WHERE id=$1', [keepChapterId])
  assert.equal(chapters.length, 1)
  const keep = chapters[0]
  const { rows: legacy } = await db.query('SELECT chapter_id FROM chapter_members WHERE user_id=$1', [user.id])
  assert.equal(legacy.length, 1, 'Review missing/ambiguous affiliation separately.')
  const { rows: assignments } = await db.query(`SELECT a.id,a.unit_id,a.position_id,p.code,c.id AS chapter_id
    FROM position_assignments a JOIN positions p ON p.id=a.position_id JOIN chapters c ON c.organization_unit_id=a.unit_id
    WHERE a.user_id=$1 AND p.code IN ('CHAPTER_LEAD','CHAPTER_MANAGER') AND (a.ends_at IS NULL OR a.ends_at>timezone('UTC',clock_timestamp())) ORDER BY a.id`, [user.id])
  const { rows: memberships } = await db.query(`WITH RECURSIVE units AS (
    SELECT organization_unit_id AS id,id AS chapter_id FROM chapters WHERE organization_unit_id IS NOT NULL
    UNION ALL SELECT u.id,t.chapter_id FROM organization_units u JOIN units t ON u.parent_id=t.id
  ) SELECT m.id,t.chapter_id FROM organization_memberships m JOIN units t ON t.id=m.unit_id
    WHERE m.user_id=$1 AND m.status='ACTIVE' AND (m.ends_at IS NULL OR m.ends_at>timezone('UTC',clock_timestamp())) ORDER BY m.id`, [user.id])
  const { rows: positions } = await db.query("SELECT id FROM positions WHERE code='CHAPTER_MANAGER' AND scope='CHAPTER'")
  assert.equal(positions.length, 1, 'Canonical Lead definition must already exist.')
  assert(legacy[0].chapter_id === keep.id || assignments.some(row => row.chapter_id === keep.id), 'Kept Chapter must already be proven by affiliation or an existing Lead tenure; this tool cannot transfer a Lead to a new Chapter.')
  const plan = {
    userRef, keptChapterId: keep.id, keptChapterName: keep.name,
    expectedLegacyChapterId: legacy[0].chapter_id,
    correctCurrentAffiliationIndex: legacy[0].chapter_id !== keep.id,
    expectedAssignments: assignments,
    endAssignmentIds: assignments.filter(row => row.chapter_id !== keep.id).map(row => row.id),
    endMembershipIds: memberships.filter(row => row.chapter_id !== keep.id).map(row => row.id),
    createKeptAssignment: !assignments.some(row => row.chapter_id === keep.id),
    preserved: ['all assignment rows', 'ended Chapter affiliation history', 'StarLedger', 'LessonProgress', 'learning cycles', 'closed snapshots'],
  }
  const planHash = hash(plan)
  if (!apply) {
    await db.query('COMMIT')
    await mkdir(outputDir, { recursive: true })
    await writeFile(`${outputDir}/lead-repair-plan.json`, JSON.stringify({ mode: 'DRY_RUN', planHash, plan }, null, 2) + '\n')
    console.log(JSON.stringify({ mode: 'DRY_RUN', planHash, ...plan }))
  } else {
    const approved = JSON.parse(await readFile(option('--approved-plan'), 'utf8'))
    assert.equal(approved.planHash, planHash, 'Data changed since the reviewed plan; rerun the dry-run, never guess.')
    assert.deepEqual(approved.plan, plan)
    const { rows: before } = await db.query(`SELECT
      (SELECT md5(coalesce(string_agg(row_to_json(p)::text,'' ORDER BY p.id),'')) FROM lesson_progress p WHERE p.user_id=$1) AS progress_hash,
      (SELECT md5(coalesce(string_agg(row_to_json(s)::text,'' ORDER BY s.id),'')) FROM star_ledger s WHERE s.user_id=$1) AS stars_hash`, [user.id])
    const { rows: clock } = await db.query('SELECT clock_timestamp() AS now')
    const at = clock[0].now.toISOString()
    await db.query("UPDATE position_assignments SET ends_at=greatest(starts_at,timezone('UTC',$2::timestamptz)) WHERE id=ANY($1::uuid[])", [plan.endAssignmentIds, at])
    await db.query("UPDATE organization_memberships SET status='ENDED',ends_at=greatest(starts_at,timezone('UTC',$2::timestamptz)) WHERE id=ANY($1::uuid[])", [plan.endMembershipIds, at])
    if (plan.correctCurrentAffiliationIndex) await db.query("UPDATE chapter_members SET chapter_id=$2,joined_at=timezone('UTC',$3::timestamptz) WHERE user_id=$1 AND chapter_id=$4", [user.id, keep.id, at, plan.expectedLegacyChapterId])
    if (plan.createKeptAssignment) await db.query(`INSERT INTO position_assignments(id,user_id,position_id,unit_id,is_primary,starts_at)
      VALUES(gen_random_uuid(),$1,$2,$3,false,timezone('UTC',$4::timestamptz))`, [user.id, positions[0].id, keep.organization_unit_id, at])
    await db.query(`INSERT INTO audit_logs(id,action,entity_type,entity_id,metadata) VALUES(gen_random_uuid(),'REPAIR_CHAPTER_LEAD_SCOPE','USER',$1,$2::jsonb)`, [user.id, JSON.stringify({ keptChapterId: keep.id, endedAssignmentIds: plan.endAssignmentIds, endedMembershipIds: plan.endMembershipIds, correctedFromChapterId: plan.correctCurrentAffiliationIndex ? plan.expectedLegacyChapterId : null, effectiveAt: at, planHash, authorization: 'Reviewed dry-run plan and explicit operator --apply approval' })])
    const { rows: after } = await db.query(`SELECT
      (SELECT md5(coalesce(string_agg(row_to_json(p)::text,'' ORDER BY p.id),'')) FROM lesson_progress p WHERE p.user_id=$1) AS progress_hash,
      (SELECT md5(coalesce(string_agg(row_to_json(s)::text,'' ORDER BY s.id),'')) FROM star_ledger s WHERE s.user_id=$1) AS stars_hash`, [user.id])
    assert.deepEqual(after, before, 'Progress and ledger must be byte-for-byte preserved.')
    await db.query('COMMIT')
    const result = { mode: 'APPLIED', userRef, keptChapterId: keep.id, effectiveAt: at, planHash, endedAssignments: plan.endAssignmentIds.length, endedMemberships: plan.endMembershipIds.length, correctedCurrentAffiliationIndex: plan.correctCurrentAffiliationIndex, createdKeptAssignment: plan.createKeptAssignment, progressAndStarsUnchanged: true }
    await mkdir(outputDir, { recursive: true })
    await writeFile(`${outputDir}/lead-repair-result.json`, JSON.stringify(result, null, 2) + '\n')
    console.log(JSON.stringify(result))
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => {})
  console.error(JSON.stringify({ outcome: 'NOT_APPLIED', code: error.code || error.name, reason: error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Review audit and transaction constraints.' }))
  process.exitCode = 1
} finally { await db.end().catch(() => {}) }
