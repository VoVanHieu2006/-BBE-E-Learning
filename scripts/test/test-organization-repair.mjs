import { PrismaClient } from '@prisma/client'
import { Client } from 'pg'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const url = process.env.ORGANIZATION_TEST_DATABASE_URL
if (!url || !['localhost', '127.0.0.1'].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith('/org_integrity_repair')) throw new Error('An isolated local org_integrity_repair* database is required.')
const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] })
const db = new Client({ connectionString: url })
const results = []
try {
  await db.connect()
  await db.query(await readFile('prisma/migrations/20261022_learning_guards/migration.sql', 'utf8'))
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@repair-test.invalid`, password_hash: 'test-only', role: 'CHAPTER_LEADER' } })
  const makeChapter = async name => {
    const unit = await prisma.organizationUnit.create({ data: { name: `${name}-${randomUUID()}`, type: 'CHAPTER' } })
    const chapter = await prisma.chapter.create({ data: { name: unit.name, organization_unit_id: unit.id } })
    return { unit, chapter }
  }
  const keep = await makeChapter('Chapter Demo'), wrong = await makeChapter('Seed Chapter')
  await prisma.chapterMember.create({ data: { user_id: user.id, chapter_id: wrong.chapter.id } })
  const position = await prisma.position.create({ data: { code: 'CHAPTER_MANAGER', name: 'Lead', scope: 'CHAPTER', is_manager: true } })
  const assignment = await prisma.positionAssignment.create({ data: { user_id: user.id, unit_id: keep.unit.id, position_id: position.id } })
  await prisma.starLedger.create({ data: { user_id: user.id, amount: 7, reason: 'VIDEO_COMPLETION', source_type: 'TEST', source_id: randomUUID(), reward_key: randomUUID() } })
  const migration = await readFile('prisma/migrations/20261025_organization_integrity/migration.sql', 'utf8')
  await assert.rejects(() => db.query(migration), /ChapterLeadDataReviewRequired/)
  await db.query('ROLLBACK')
  assert.equal(await prisma.chapterLeadBinding.count(), 0)
  results.push({ test: 'Migration refuses ambiguous data without choosing a Chapter', status: 'PASS' })
  const userRef = createHash('md5').update(user.id).digest('hex')
  const args = ['scripts/db/repair-chapter-lead-scope.mjs', '--user-ref', userRef, '--keep-chapter', keep.chapter.id, '--output-dir', 'scratch/organization-repair']
  const invoke = extra => spawnSync(process.execPath, [...args, ...extra], { env: { ...process.env, ORGANIZATION_TEST_DATABASE_URL: url }, encoding: 'utf8' })
  const dryRun = invoke([])
  assert.equal(dryRun.status, 0, dryRun.stdout + dryRun.stderr)
  const plan = JSON.parse(await readFile('scratch/organization-repair/lead-repair-plan.json', 'utf8'))
  assert.equal(plan.plan.correctCurrentAffiliationIndex, true)
  assert.equal(plan.plan.createKeptAssignment, false)
  assert.equal(plan.plan.endAssignmentIds.length, 0)
  assert.equal((await prisma.chapterMember.findUnique({ where: { user_id: user.id } })).chapter_id, wrong.chapter.id)
  results.push({ test: 'Dry run proposes exact correction, writes no organization data', status: 'PASS' })
  const repair = invoke(['--apply', '--approved-plan', 'scratch/organization-repair/lead-repair-plan.json'])
  assert.equal(repair.status, 0, repair.stdout + repair.stderr)
  assert.equal((await prisma.chapterMember.findUnique({ where: { user_id: user.id } })).chapter_id, keep.chapter.id)
  assert.equal((await prisma.positionAssignment.findUnique({ where: { id: assignment.id } })).ends_at, null)
  const history = await prisma.chapterAffiliationInterval.findMany({ where: { user_id: user.id } })
  assert.equal(history.length, 2)
  assert(history.find(row => row.chapter_id === wrong.chapter.id).ends_at)
  assert.equal((await prisma.starLedger.aggregate({ where: { user_id: user.id }, _sum: { amount: true } }))._sum.amount, 7)
  results.push({ test: 'Approved repair fixes current index and preserves assignment, historical interval and ledger', status: 'PASS' })
  await db.query(migration)
  assert.equal((await prisma.chapterLeadBinding.findUnique({ where: { user_id: user.id } })).chapter_id, keep.chapter.id)
  results.push({ test: 'Migration succeeds after reviewed repair and creates permanent binding', status: 'PASS' })
  const retry = invoke(['--apply', '--approved-plan', 'scratch/organization-repair/lead-repair-plan.json'])
  assert.notEqual(retry.status, 0)
  assert.equal(await prisma.positionAssignment.count({ where: { user_id: user.id } }), 1)
  results.push({ test: 'Stale repair plan/retry cannot change a new state or duplicate assignments', status: 'PASS' })
  await mkdir('scratch/organization-repair', { recursive: true })
  await writeFile('scratch/organization-repair/tests.json', JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
} finally { await db.end(); await prisma.$disconnect() }
