import { it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { competitionCohortAt, historicalChapterMonthRows, individualPeriodRows } from '../lib/competition-snapshots'

const start = new Date('2026-10-01T00:00:00Z'), left = new Date('2026-10-15T00:00:00Z'), end = new Date('2026-11-01T00:00:00Z')
const month = { id: 'month', key: '2026-10', starts_at: start, ends_at: end }
function fixture() {
  const states = [{ user_id: 'stays', role: 'MEMBER', status: 'ACTIVE', starts_at: start, ends_at: null }, { user_id: 'left', role: 'MEMBER', status: 'ACTIVE', starts_at: start, ends_at: left }]
  const ledger = [{ user_id: 'stays', amount: 10, awarded_at: new Date('2026-10-03'), chapter_at_award_id: 'chapter' }, { user_id: 'left', amount: 90, awarded_at: new Date('2026-10-05'), chapter_at_award_id: 'chapter' }]
  const tx = {
    accountStateInterval: { findMany: async ({ where }: any) => states.filter(s => s.starts_at < where.starts_at.lt && (!s.ends_at || s.ends_at >= where.OR[1].ends_at.gte)) },
    chapterAffiliationInterval: { findMany: async () => states.map(s => ({ user_id: s.user_id, chapter_id: 'chapter' })) },
    chapter: { findMany: async () => [{ id: 'chapter', name: 'Chapter' }] },
    positionAssignment: { findMany: async () => [] }, organizationMembership: { findMany: async () => [] },
    course: { findMany: async () => [{ id: 'core' }] }, coursePublicationEvent: { findMany: async () => [{ course_id: 'core', status: 'PUBLISHED' }] },
    courseRequirementVersion: { findMany: async () => [{ course_id: 'core', lesson_ids: ['lesson'] }] },
    learningCycle: { findMany: async () => [{ id: 'cycle', user_id: 'stays' }] }, chapterReorganization: { findMany: async () => [] },
    starLedger: { findMany: async ({ where }: any) => ledger.filter(row => !where.user_id || where.user_id.in.includes(row.user_id)) },
    chapterMonthlyKpi: { findMany: async () => [{ chapter_id: 'chapter', status: 'GOLD', updated_at: start }] },
    cycleLessonProgress: { findMany: async () => [{ user_id: 'stays', lesson_id: 'lesson', completed_at: new Date('2026-10-02') }] },
  } as unknown as Prisma.TransactionClient
  return tx
}

it('historical cohort retains someone active at capture even after later deactivation', async () => {
  const rows = await competitionCohortAt(fixture(), new Date('2026-10-10'))
  assert.deepEqual(rows.map(row => row.userId), ['stays', 'left'])
})
it('live individual board excludes a departed user and their stars', async () => {
  const rows = await individualPeriodRows(fixture(), start, end, 'MEMBER')
  assert.deepEqual(rows.map(row => [row.userId, row.stars]), [['stays', 10]])
})
it('live Chapter numerator and denominator use the same active cohort', async () => {
  const rows = await historicalChapterMonthRows(fixture(), month, end)
  assert.equal(rows[0].stages[0].memberCount, 1)
  assert.equal(rows[0].stages[0].stars, 10)
  assert.equal(rows[0].lastStarAwardedAt?.toISOString(), new Date('2026-10-03').toISOString())
})
