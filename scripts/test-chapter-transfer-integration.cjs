const assert = require('node:assert/strict'), path = require('node:path')
const { randomUUID } = require('node:crypto')
const target = process.env.TEST_DATABASE_URL
if (target !== 'postgresql://chapter_fix_test@127.0.0.1:55439/bbe_test_learning_cycles') throw new Error('Explicit isolated Chapter test database required')
process.env.DATABASE_URL = target; process.env.DIRECT_URL = target
require('ts-node').register({ project: 'tsconfig.test.json' })
const Module = require('node:module'), resolve = Module._resolveFilename
Module._resolveFilename = function (name, ...args) { return resolve.call(this, name.startsWith('@/') ? path.resolve('src', name.slice(2)) : name, ...args) }
const { prisma: db } = require('../src/lib/prisma')
const { applyDueChapterReorganizations } = require('../src/lib/chapter-reorganizations')
const { chapterActualTermRows } = require('../src/lib/chapter-actual-terms')
const { chapterRewardState, chapterRewardBoundary } = require('../src/lib/chapter-reward-gate')
async function main() {
  const key = randomUUID(), now = new Date(), boundary = chapterRewardBoundary(now)
  const admin = await db.user.create({ data: { email: `transfer-admin-${key}@example.invalid`, role: 'ADMIN', password_hash: '-' } })
  const member = await db.user.create({ data: { email: `transfer-member-${key}@example.invalid`, role: 'MEMBER', password_hash: '-' } })
  const unit = await db.organizationUnit.create({ data: { type: 'CHAPTER', name: key } })
  const chapter = await db.chapter.create({ data: { name: key, organization_unit_id: unit.id, created_at: new Date('2025-06-01') } })
  await db.chapterMember.create({ data: { chapter_id: chapter.id, user_id: member.id } })
  await db.organizationMembership.create({ data: { user_id: member.id, unit_id: unit.id } })
  const term = await db.chapterCompetitionTerm.create({ data: { chapter_id: chapter.id, starts_at: chapter.created_at } })
  const cycle = await db.learningCycle.create({ data: { user_id: member.id, chapter_id: chapter.id, starts_at: now, trigger_key: key } })
  await db.learningPolicy.update({ where: { id: 'default' }, data: { cutover_at: new Date('2026-01-01'), mapping_approved_at: now } })
  const season = await db.transferSeason.upsert({ where: { reward_boundary_at: boundary }, update: { starts_at: new Date('2026-09-01T00:00:00+07:00'), ends_at: new Date('2026-11-01T00:00:00+07:00') }, create: { code: key, starts_at: new Date('2026-09-01T00:00:00+07:00'), ends_at: new Date('2026-11-01T00:00:00+07:00'), reward_boundary_at: boundary } })
  const month = await db.competitionMonth.findFirstOrThrow({ where: { starts_at: { lte: now }, ends_at: { gt: now } } })
  for (const [amount, monthId] of [[7,month.id],[3,null]]) await db.starLedger.create({ data: { user_id: member.id, chapter_at_award_id: chapter.id, amount, reason: 'VIDEO_COMPLETION', source_type: 'TEST', source_id: member.id, reward_key: `transfer-test:${key}:${amount}`, competition_month_id: monthId, learning_cycle_id: cycle.id, awarded_at: now, provenance: monthId ? 'NATIVE' : 'LEGACY' } })
  const before = (await chapterActualTermRows(db, new Date(), chapter.id))[0]
  assert.equal(before.totalStars, 7); assert.equal(before.unallocatedLegacyStars, 3); assert.equal(before.rank, null)
  const batch = await db.chapterReorganization.create({ data: { chapter_id: chapter.id, transfer_season_id: season.id, created_by_user_id: admin.id, status: 'SCHEDULED', effective_at: new Date(Date.now()+86400000), term_number: 2 } })
  assert.equal(await applyDueChapterReorganizations(new Date(), batch.id), 0, 'future scheduling does not reset')
  assert.equal(await db.learningCycle.count({ where: { user_id: member.id } }), 1)
  assert.equal((await chapterRewardState(db, member.id, new Date())).paused, false, 'initial scheduling still earns')
  const applied = await Promise.all([applyDueChapterReorganizations(new Date(), batch.id, true), applyDueChapterReorganizations(new Date(), batch.id, true)])
  assert.equal(applied.reduce((a,b)=>a+b,0), 1, 'parallel scheduler and manual application reset once')
  assert.equal(await db.learningCycle.count({ where: { user_id: member.id } }), 2)
  assert.equal(await db.chapterCompetitionTerm.count({ where: { chapter_id: chapter.id } }), 2)
  assert.equal(await applyDueChapterReorganizations(new Date(), batch.id, true), 0)
  const frozen = await db.learningSnapshot.findUniqueOrThrow({ where: { key: `statistics:CHAPTER:${term.id}` } })
  assert.equal(frozen.payload.totalStars, 7)
  const old = (await chapterActualTermRows(db, new Date(), chapter.id, term.id))[0]
  assert.equal(old.totalStars,7); assert.equal(old.state,'FINALIZED'); assert.equal(old.rank,null)
  const current = (await chapterActualTermRows(db, new Date(), chapter.id))[0]
  assert.equal(current.totalStars,0)
  assert.equal((await chapterRewardState(db,member.id,new Date())).paused,false)
  console.log('PASS: scheduled-only no reset, initial rewards, actual-term ledger once, legacy month-null separate, concurrent manual/scheduler reset once, retry idempotent, closed statistics snapshot immutable.')
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.$disconnect())
