import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DAY_MS, budgetFingerprint, calculateSharedDeadline, competitionMonthBounds, firstReachedFinalBalance, heartbeatElapsed, highWaterIncrement } from '../lib/learning-cycle-rules'
import { chapterCompetitionScore, competitionGroup } from '../lib/competition-ranking-rules'
import { chapterRewardBoundary, isChapterRewardPaused } from '../lib/chapter-reward-gate'

describe('Chapter overdue transfer reward pause', () => {
  const boundary = new Date('2026-09-30T17:00:00Z')
  it('changes the season exactly at October midnight in Vietnam', () => {
    assert.equal(chapterRewardBoundary(new Date(boundary.getTime() - 1)).toISOString(), '2026-03-31T17:00:00.000Z')
    assert.deepEqual(chapterRewardBoundary(boundary), boundary)
  })
  it('handles April and the previous October in January', () => {
    assert.equal(chapterRewardBoundary(new Date('2027-03-31T17:00:00Z')).toISOString(), '2027-03-31T17:00:00.000Z')
    assert.equal(chapterRewardBoundary(new Date('2027-01-01T00:00:00Z')).toISOString(), boundary.toISOString())
  })
  it('does not pause an early successfully applied transfer', () => assert.equal(isChapterRewardPaused(boundary, boundary, new Date('2026-09-15T07:30:00Z')), false))
  it('pauses an overdue Chapter at the exact boundary', () => assert.equal(isChapterRewardPaused(boundary, boundary, null), true))
  it('opens at the actual successful application timestamp', () => {
    const applied = new Date('2026-10-10T07:30:00.123Z')
    assert.equal(isChapterRewardPaused(new Date(applied.getTime() - 1), boundary, applied), true)
    assert.equal(isChapterRewardPaused(applied, boundary, applied), false)
  })
  it('does not pause before the boundary even without a transfer', () => assert.equal(isChapterRewardPaused(new Date(boundary.getTime() - 1), boundary, null), false))
})

describe('Vietnam competition months', () => {
  const cutover = new Date('2026-09-15T05:00:00Z')
  it('uses the actual cutover for the first shortened official month', () => {
    assert.deepEqual(competitionMonthBounds(cutover, cutover), { key: '2026-09', startsAt: cutover, endsAt: new Date('2026-09-30T17:00:00Z') })
  })
  it('changes months exactly at midnight UTC+7, including December', () => {
    assert.equal(competitionMonthBounds(new Date('2026-09-30T16:59:59.999Z'), cutover).key, '2026-09')
    assert.equal(competitionMonthBounds(new Date('2026-09-30T17:00:00Z'), cutover).key, '2026-10')
    assert.equal(competitionMonthBounds(new Date('2026-12-31T17:00:00Z'), cutover).key, '2027-01')
  })
})

describe('Shared deadlines', () => {
  const start = new Date('2026-01-01T00:00:00Z')
  const atDay = (day: number) => new Date(start.getTime() + day * DAY_MS)
  const a = { courseId: 'A', days: 10, completed: false }
  const b = { courseId: 'B', days: 20, completed: false }
  const c = (days: number, completed = false) => ({ courseId: 'C', days, completed })
  it('day 25: A10+B20 -> A10+C5 stays at day 30', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(25), previous: [a, b], next: [a, c(5)] })?.getTime(), atDay(30).getTime())
  })
  it('day 20: A10+B10 -> A10+C11 extends to day 31', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(20), previous: [a, { ...b, days: 10 }], next: [a, c(11)] })?.getTime(), atDay(31).getTime())
  })
  it('day 3: A10+B10 -> A10+C11 ends at day 21', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(3), previous: [a, { ...b, days: 10 }], next: [a, c(11)] })?.getTime(), atDay(21).getTime())
  })
  it('subtracts even a completed removed course, with three days of grace', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(25), previous: [a, { ...b, completed: true }], next: [a] })?.getTime(), atDay(28).getTime())
  })
  it('does not award new study time for a valid completed course', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(25), previous: [a, b], next: [a, c(5, true)] })?.getTime(), atDay(25).getTime())
  })
  it('keeps the original start across completely different sets and returns', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(3), previous: [c(5)], next: [a, b] })?.getTime(), atDay(33).getTime())
  })
  it('does not enforce an empty or entirely completed set', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(20), previous: [a], next: [] }), null)
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(20), previous: [], next: [{ ...a, completed: true }] }), null)
  })
  it('gives unfinished work three days when Admin reduces a budget', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(25), previous: [b], next: [{ ...b, days: 5 }], budgetReduction: true })?.getTime(), atDay(28).getTime())
  })
  it('fingerprints ignore rule order and completion, but detect actual budget changes', () => {
    assert.equal(budgetFingerprint([a, b]), budgetFingerprint([{ ...b, completed: true }, a]))
    assert.notEqual(budgetFingerprint([a, b]), budgetFingerprint([a, { ...b, days: 19 }]))
  })
})

describe('Reward integrity', () => {
  it('pays only improvements to the high water mark', () => {
    assert.equal(highWaterIncrement(10, 8), 0)
    assert.equal(highWaterIncrement(10, 10), 0)
    assert.equal(highWaterIncrement(10, 13), 3)
  })
  it('a disconnected player can recover a short gap, but a long absence earns no watch time', () => {
    const now = new Date()
    assert.equal(heartbeatElapsed(new Date(now.getTime() - 120_000), now), 120)
    assert.equal(heartbeatElapsed(new Date(now.getTime() - 301_000), now), 0)
    assert.equal(heartbeatElapsed(new Date(now.getTime() - 10_000), now), 10)
    assert.equal(heartbeatElapsed(null, now), 0)
  })
  it('finds the first time reaching the final balance after negative adjustments', () => {
    const starts = new Date('2026-09-01T00:00:00Z')
    const times = [1, 2, 3].map((day) => new Date(starts.getTime() + day * DAY_MS))
    const result = firstReachedFinalBalance([{ amount: 10, awarded_at: times[0] }, { amount: 5, awarded_at: times[1] }, { amount: -5, awarded_at: times[2] }], starts)
    assert.equal(result.total, 10)
    assert.equal(result.elapsedMs, DAY_MS)
  })
  it('groups same-timestamp adjustments and gives zero totals zero elapsed', () => {
    const starts = new Date(0), at = new Date(1000)
    assert.equal(firstReachedFinalBalance([{ amount: 10, awarded_at: at }, { amount: -10, awarded_at: at }], starts).elapsedMs, 0)
  })
})

describe('Competition Chapter stages and role groups', () => {
  it('uses S_m = A_1 / N_1 + A_2 / N_2 for transfer month, while keeping time-weighted roster for size eligibility', () => {
    const result = chapterCompetitionScore([
      { startsAt: new Date(0), endsAt: new Date(15 * DAY_MS), memberCount: 30, qualifiedCount: 15, stars: 100 },
      { startsAt: new Date(15 * DAY_MS), endsAt: new Date(30 * DAY_MS), memberCount: 15, qualifiedCount: 8, stars: 40 },
    ], 'YELLOW')
    assert.equal(result.totalStars, 140)
    assert.equal(result.averageMemberCount, 22.5)
    // S_m = 100/30 + 40/15 = 10/3 + 8/3 = 18/3 = 6
    assert.equal(result.score, 6)
    assert.ok(result.eligible)
  })
  it('requires strictly more than 20 members and waits for KPI', () => {
    const stage = { startsAt: new Date(0), endsAt: new Date(DAY_MS), memberCount: 20, qualifiedCount: 20, stars: 100 }
    assert.equal(chapterCompetitionScore([stage], 'GREEN').eligible, false)
    assert.ok(chapterCompetitionScore([{ ...stage, memberCount: 21 }], null).exclusionReasons.includes('WAITING_KPI'))
  })
  it('places Presidents in LT, excludes TT and management accounts', () => {
    assert.equal(competitionGroup('MEMBER', ['CHAPTER_PRESIDENT'], false), 'LT')
    assert.equal(competitionGroup('MEMBER', ['DEPARTMENT_LEADER'], false), 'LT')
    assert.equal(competitionGroup('MEMBER', ['TT'], true), null)
    assert.equal(competitionGroup('MEMBER', ['DNA_MANAGER'], true), null)
    assert.equal(competitionGroup('ADMIN', [], false), null)
  })
})
