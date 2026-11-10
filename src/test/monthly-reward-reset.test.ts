import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { competitionMonthBounds } from '../lib/learning-cycle-rules'
import { individualPeriodRows } from '../lib/competition-snapshots'

const root = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

const USER = '00000000-0000-4000-8000-000000000001'
const CHAPTER = '00000000-0000-4000-8000-0000000000c1'
const at = (iso: string) => new Date(iso)

// One MEMBER in one chapter whose competition term began before both months.
// October ledger: 10 stars, November ledger: 10 stars.
function stubTx() {
  const ledger = [
    { user_id: USER, amount: 10, awarded_at: at('2026-10-10T05:00:00Z') },
    { user_id: USER, amount: 10, awarded_at: at('2026-11-05T05:00:00Z') },
  ]
  const termCalls: unknown[] = []
  const tx: any = {
    accountStateInterval: { findMany: async () => [{ user_id: USER, role: 'MEMBER', status: 'ACTIVE' }] },
    chapterAffiliationInterval: { findMany: async () => [{ user_id: USER, chapter_id: CHAPTER }] },
    chapter: { findMany: async () => [{ id: CHAPTER, name: 'Chapter A' }] },
    positionAssignment: { findMany: async () => [] },
    organizationMembership: { findMany: async () => [] },
    chapterCompetitionTerm: {
      findMany: async (args: unknown) => { termCalls.push(args); return [{ chapter_id: CHAPTER, starts_at: at('2026-10-01T00:00:00Z'), ends_at: null }] },
    },
    starLedger: {
      findMany: async ({ where }: any) => ledger.filter((row) => row.awarded_at >= where.awarded_at.gte && row.awarded_at < where.awarded_at.lt),
    },
  }
  return { tx, termCalls }
}

describe('individual month board does not carry stars over', () => {
  const novStart = at('2026-10-31T17:00:00Z')
  const novEnd = at('2026-11-30T17:00:00Z')

  it('shows only the stars earned in the month, even when a chapter term started earlier', async () => {
    const { tx, termCalls } = stubTx()
    const [row] = await individualPeriodRows(tx, novStart, novEnd, 'MEMBER')
    assert.equal(row.stars, 10)
    assert.equal(termCalls.length, 0)
  })

  it('a TERM board still accumulates from the chapter term start', async () => {
    const { tx } = stubTx()
    const [row] = await individualPeriodRows(tx, novStart, novEnd, 'MEMBER', undefined, undefined, undefined, { chapterTerms: true })
    assert.equal(row.stars, 20)
  })
})

describe('monthly star reset', () => {
  it('derives the current month from the calendar even before its row exists', () => {
    const bounds = competitionMonthBounds(new Date('2026-10-31T17:00:00Z'))
    assert.equal(bounds.key, '2026-11')
    assert.equal(bounds.startsAt.toISOString(), '2026-10-31T17:00:00.000Z')
  })

  it('quiz start gate does not skip the replay check when the month row is missing', () => {
    const source = read('src/app/api/v1/assessments/[assessmentId]/attempts/route.ts')
    assert.match(source, /const monthBounds = competitionMonthBounds\(now\)/)
    assert.match(source, /submitted_at: \{ lt: monthBounds\.startsAt \}/)
    assert.match(source, /competitionMonth\.findUnique\(\{ where: \{ key: monthBounds\.key \}/)
    assert.doesNotMatch(source, /competitionMonth\.findFirst/)
    // Without a month row there is no replay, so the learner is asked to replay.
    assert.match(source, /const replay = currentMonth && await prisma\.monthlyVideoReplay\.findUnique/)
    assert.match(source, /if \(!replay \|\| !replay\.completed_at\)/)
  })

  it('an attempt started last month needs a replay this month before earning stars', () => {
    const source = read('src/lib/quiz-submission.ts')
    assert.match(source, /attempt\.started_at < context\.month\.starts_at/)
    assert.match(source, /competition_month_id: context\.month\.id, learning_cycle_id: context\.cycle\.id \} \},\s*select: \{ completed_at: true \}/)
    assert.match(source, /if \(monthlyReplayDone && \(eligible \|\| paused\)\)/)
  })

  it('reward budgets stay keyed by month and learning cycle', () => {
    assert.match(read('src/lib/video-heartbeat.ts'), /`video:\$\{userId\}:\$\{lesson\.video\.id\}:\$\{context\.month\.id\}:\$\{context\.cycle\.id\}`/)
    assert.match(read('src/lib/quiz-submission.ts'), /competition_month_id: context\.month\.id, learning_cycle_id: context\.cycle\.id \}\s*const mark = await tx\.quizRewardHighWaterMark\.upsert/)
  })
})
