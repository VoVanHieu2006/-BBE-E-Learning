import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DAY_MS, budgetFingerprint, calculateSharedDeadline, isWithinRestoreWindow, competitionMonthBounds, firstReachedFinalBalance, heartbeatElapsed, highWaterIncrement } from '../lib/learning-cycle-rules'
import { chapterCompetitionScore, competitionGroup } from '../lib/competition-ranking-rules'
import { chapterRewardBoundary, isChapterRewardPaused } from '../lib/chapter-reward-gate'
import { learningContext, currentCycleAttemptFilter, lockCompetitionScope } from '../lib/learning-periods'
import { readLearningReadiness } from '../lib/learning-readiness'
import { reconcileLearningAssignmentsForUser } from '../lib/learning-assignments'

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
  it('uses the natural start of the month even for the first activity mid-month', () => {
    assert.deepEqual(competitionMonthBounds(new Date('2026-09-15T05:00:00Z')), { key: '2026-09', startsAt: new Date('2026-08-31T17:00:00Z'), endsAt: new Date('2026-09-30T17:00:00Z') })
  })
  it('changes months exactly at midnight UTC+7, including December', () => {
    assert.equal(competitionMonthBounds(new Date('2026-09-30T16:59:59.999Z')).key, '2026-09')
    assert.equal(competitionMonthBounds(new Date('2026-09-30T17:00:00Z')).key, '2026-10')
    assert.equal(competitionMonthBounds(new Date('2026-12-31T17:00:00Z')).key, '2027-01')
  })
  it('keeps natural boundaries through leap February', () => {
    assert.deepEqual(competitionMonthBounds(new Date('2028-02-29T16:59:59.999Z')), { key: '2028-02', startsAt: new Date('2028-01-31T17:00:00Z'), endsAt: new Date('2028-02-29T17:00:00Z') })
  })
})

describe('Learning cycle initialization and historical reads', () => {
  const now = new Date('2026-11-10T05:00:00Z')
  const month = { id: 'month', starts_at: new Date('2026-10-31T17:00:00Z'), ends_at: new Date('2026-11-30T17:00:00Z'), state: 'OPEN' }

  it('initializes LEGACY from old video progress and deadline evidence without a date gate', async () => {
    const assignedAt = new Date('2025-02-01T05:00:00Z')
    const completedAt = new Date('2025-02-10T05:00:00Z')
    const importedDue = new Date('2026-12-01T05:00:00Z')
    let cycleData: any, progressData: any, pathData: any, createdMonth: any
    const tx: any = {
      competitionMonth: {
        findUnique: async () => null,
        upsert: async (args: any) => { createdMonth = args; return month },
      },
      learningCycle: {
        findFirst: async () => null,
        create: async ({ data }: any) => { cycleData = data; return { id: 'cycle', ...data } },
      },
      chapterMember: { findUnique: async () => ({ chapter_id: 'chapter' }) },
      attempt: { findFirst: async () => null },
      lessonProgress: { findMany: async () => [{ lesson_id: 'lesson', furthest_watched_position_seconds: 77, completed_at: completedAt }] },
      cycleLessonProgress: { createMany: async (args: any) => { progressData = args } },
      userLearningAssignment: { findMany: async () => [{ assigned_at: assignedAt, due_at: new Date('2025-03-01') }, { assigned_at: now, due_at: importedDue }] },
      learningPath: { create: async ({ data }: any) => { pathData = data } },
    }
    const context = await learningContext(tx, 'user', now)
    assert.equal(context.cycle.provenance, 'LEGACY')
    assert.equal(cycleData.starts_at, now)
    assert.equal(cycleData.chapter_id, 'chapter')
    assert.equal(cycleData.trigger_key, `initial:user:${now.toISOString()}`)
    assert.deepEqual(progressData, { data: [{ user_id: 'user', lesson_id: 'lesson', learning_cycle_id: 'cycle', furthest_seconds: 77, completed_at: completedAt, provenance: 'LEGACY' }], skipDuplicates: true })
    assert.equal(pathData.starts_at, assignedAt)
    assert.deepEqual(pathData.imported_due_at, importedDue)
    assert.deepEqual(pathData.due_at, importedDue)
    assert.deepEqual(createdMonth.update, {})
    assert.deepEqual(createdMonth.create.starts_at, month.starts_at)
  })

  for (const evidence of ['none', 'attempt', 'progress', 'assignment'] as const) {
    it(`chooses initial provenance from unscoped evidence: ${evidence}`, async () => {
      const tx: any = {
        competitionMonth: { findUnique: async () => month },
        learningCycle: { findFirst: async () => null, create: async ({ data }: any) => ({ id: 'cycle', ...data }) },
        chapterMember: { findUnique: async () => null },
        attempt: { findFirst: async ({ where }: any) => {
          assert.deepEqual(where, { user_id: 'user', learning_cycle_id: null })
          return evidence === 'attempt' ? { id: 'old-attempt' } : null
        } },
        lessonProgress: { findMany: async () => evidence === 'progress' ? [{ lesson_id: 'lesson' }] : [] },
        cycleLessonProgress: { createMany: async () => ({ count: 1 }) },
        userLearningAssignment: { findMany: async ({ where }: any) => {
          assert.deepEqual(where, { user_id: 'user', learning_cycle_id: null })
          return evidence === 'assignment' ? [{ assigned_at: now, due_at: null }] : []
        } },
        learningPath: { create: async () => ({}) },
      }
      const { cycle } = await learningContext(tx, 'user', now)
      assert.equal(cycle.provenance, evidence === 'none' ? 'NATIVE' : 'LEGACY')
      assert.equal(cycle.starts_at, now)
    })
  }

  for (const hasAssignment of [false, true]) {
    it(`preserves a completed legacy course on first reconciliation (${hasAssignment ? 'existing' : 'new'} assignment)`, async () => {
      const completedAt = new Date('2025-02-10T05:00:00Z')
      const assignments: any[] = hasAssignment ? [{ id: 'old-assignment', user_id: 'user', course_id: 'course', learning_cycle_id: null, assigned_at: completedAt, status: 'COMPLETED', completed_at: completedAt, ended_at: null }] : []
      let cycle: any = null, path: any = null
      const progress: any[] = []
      const rule = { id: 'rule', course_id: 'course', mandatory: true, can_view: true, can_assess: true, can_earn_stars: true }
      const matches = (row: any, where: any) => Object.entries(where).every(([key, value]: [string, any]) => {
        if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key])
        return row[key] === value
      })
      const tx: any = {
        $queryRaw: async (sql: TemplateStringsArray) => sql.join('').includes('FOR UPDATE') ? [{ id: 'user' }] : [{ now }],
        competitionMonth: { findUnique: async () => month },
        learningCycle: { findFirst: async () => cycle, create: async ({ data }: any) => (cycle = { id: 'cycle', ...data }) },
        chapterMember: { findUnique: async () => null },
        lessonProgress: { findMany: async () => [{ lesson_id: 'lesson', completed_at: completedAt, furthest_watched_position_seconds: 77 }] },
        cycleLessonProgress: {
          createMany: async ({ data }: any) => { progress.push(...data) },
          findMany: async () => progress.filter(row => row.completed_at),
        },
        attempt: {
          findFirst: async () => ({ id: 'old-attempt' }),
          findMany: async ({ where }: any) => {
            // Both the lesson quiz and final exam were passed before cycles existed.
            const attempts = ['quiz', 'final'].map(assessment_id => ({ assessment_id, learning_cycle_id: null, started_at: completedAt }))
            return attempts.filter(row => where.OR?.some((part: any) => row.learning_cycle_id === part.learning_cycle_id && (!part.started_at || row.started_at < part.started_at.lt)))
          },
        },
        organizationMembership: { findFirst: async () => null, findMany: async () => [] },
        positionAssignment: { findMany: async () => [] },
        learningRule: { findMany: async () => [rule] },
        userLearningAssignment: {
          findMany: async ({ where, include }: any) => assignments.filter(row => matches(row, where)).map(row => include ? { ...row, course: { mandatory_default_due_days: 10 } } : { ...row }),
          create: async ({ data }: any) => { assignments.push({ id: 'new-assignment', completed_at: null, status: 'ASSIGNED', ...data }) },
          update: async ({ where, data }: any) => Object.assign(assignments.find(row => row.id === where.id), data),
          updateMany: async ({ where, data }: any) => { assignments.filter(row => matches(row, where)).forEach(row => Object.assign(row, data)) },
        },
        learningPath: {
          create: async ({ data }: any) => (path = { id: 'path', budget: [], ...data }),
          upsert: async () => path,
          update: async ({ data }: any) => Object.assign(path, data),
        },
        learningPathChange: { findFirst: async () => null, count: async () => 0, create: async () => ({}) },
        supplementalLearningRequirement: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
        lesson: { findMany: async () => [{ id: 'lesson', assessment: { id: 'quiz' } }] },
        course: { findUnique: async () => ({ final_assessment: { id: 'final' } }) },
      }
      await reconcileLearningAssignmentsForUser('user', tx)
      const active = assignments.filter(row => row.learning_cycle_id === cycle.id && !row.ended_at)
      assert.equal(active.length, 1)
      assert.equal(active[0].status, 'COMPLETED')
      assert.ok(active[0].completed_at)
      assert.equal(assignments.length, 1, 'imports the old assignment instead of duplicating it')
      assert.equal(path.due_at, null, 'completed courses impose no new deadline')
      assert.equal(cycle.provenance, 'LEGACY')
    })
  }

  it('keeps an existing LEGACY cycle and persisted month unchanged without importing again', async () => {
    const cycle = { id: 'legacy', starts_at: new Date('2025-02-01'), provenance: 'LEGACY' }
    const historicalMonth = { ...month, starts_at: new Date('2026-11-02T00:00:00Z') }
    const tx: any = { competitionMonth: { findUnique: async () => historicalMonth }, learningCycle: { findFirst: async () => cycle } }
    const context = await learningContext(tx, 'user', now)
    assert.equal(context.cycle, cycle)
    assert.equal(context.month, historicalMonth)
  })

  it('keeps null attempts available only for an existing LEGACY cycle', async () => {
    const startsAt = new Date('2025-02-01')
    const tx = (cycle: any) => ({ learningCycle: { findFirst: async () => cycle } }) as any
    assert.deepEqual(await currentCycleAttemptFilter(tx({ id: 'legacy', provenance: 'LEGACY', starts_at: startsAt }), 'user'), { OR: [{ learning_cycle_id: 'legacy' }, { learning_cycle_id: null, started_at: { lt: startsAt } }] })
    assert.deepEqual(await currentCycleAttemptFilter(tx({ id: 'native', provenance: 'NATIVE' }), 'user'), { learning_cycle_id: 'native' })
    assert.deepEqual(await currentCycleAttemptFilter(tx(null), 'user'), {})
  })

  it('locks the month without rewriting an existing historical start', async () => {
    const historicalMonth = { ...month, starts_at: new Date('2026-11-02T00:00:00Z') }
    let upsert: any
    const tx: any = {
      $queryRaw: async () => [{ now }],
      competitionMonth: {
        upsert: async (args: any) => { upsert = args; return historicalMonth },
        findUniqueOrThrow: async () => historicalMonth,
      },
    }
    assert.equal((await lockCompetitionScope(tx, now)).month, historicalMonth)
    assert.deepEqual(upsert.update, {})
    assert.deepEqual(upsert.create.starts_at, month.starts_at)
  })

  it('readiness needs no database access', async () => {
    assert.deepEqual(await readLearningReadiness(now), { ready: true, reasonCode: 'READY', message: 'Cấu hình sẵn sàng.', asOf: now })
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
  it('does not award new study time for a valid completed course (removing B still gives the C+3 floor)', () => {
    assert.equal(calculateSharedDeadline({ startsAt: start, changedAt: atDay(25), previous: [a, b], next: [a, c(5, true)] })?.getTime(), atDay(28).getTime())
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
  describe('KHBB 5.2 - 5.7 (production reasons ROLE_CHANGED / ADMIN_BUDGET_SHORTENED)', () => {
    const base = { startsAt: start }
    const done = (budget: { courseId: string; days: number; completed: boolean }) => ({ ...budget, completed: true })
    const A10 = { courseId: 'A', days: 10, completed: false }
    const B5 = { courseId: 'B', days: 5, completed: false }
    const C10 = { courseId: 'C', days: 10, completed: false }
    it('5.3 main example: day 12, A done, A+B -> A+C gives day 22', () => {
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(12), previous: [A10, B5], next: [done(A10), C10], reason: 'ROLE_CHANGED' })?.getTime(), atDay(22).getTime())
    })
    it('5.3 side example: day 2, nothing done, gives day 20', () => {
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(2), previous: [A10, B5], next: [A10, C10], reason: 'ROLE_CHANGED' })?.getTime(), atDay(20).getTime())
    })
    it('5.3 everything done, then C10 at day 5 -> day 15 (finished A100 adds nothing)', () => {
      const A100 = { courseId: 'A', days: 100, completed: true }
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(5), previous: [A100], next: [A100, C10], reason: 'ROLE_CHANGED' })?.getTime(), atDay(15).getTime())
    })
    it('5.3 changing Chapter: A10+B40 (day 50) -> C11 at day 20 gives day 31, shorter than the old deadline', () => {
      const B40 = { courseId: 'B', days: 40, completed: false }
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(20), previous: [A10, B40], next: [{ courseId: 'C', days: 11, completed: false }], reason: 'ROLE_CHANGED', currentDueAt: atDay(50) })?.getTime(), atDay(31).getTime())
    })
    it('5.4 removing a course while another is unfinished: max(0 + 10, 20 + 3) = day 23', () => {
      const B40 = { courseId: 'B', days: 40, completed: false }
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(20), previous: [A10, B40], next: [A10], reason: 'ROLE_CHANGED' })?.getTime(), atDay(23).getTime())
    })
    it('5.4 removing the last unfinished course -> no deadline', () => {
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(20), previous: [A10, B5], next: [done(A10)], reason: 'ROLE_CHANGED' }), null)
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(20), previous: [A10], next: [], reason: 'ROLE_CHANGED' }), null)
    })
    it('5.2 shortening counts only unfinished courses: 30 -> 10 at day 20 gives day 23', () => {
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(20), previous: [{ ...A10, days: 30 }], next: [A10], reason: 'ADMIN_BUDGET_SHORTENED' })?.getTime(), atDay(23).getTime())
      // A shortened course that is already done contributes nothing: only the unfinished B counts: max(0 + 5, 1 + 3) = day 5.
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(1), previous: [{ ...A10, days: 30 }, B5], next: [done(A10), B5], reason: 'ADMIN_BUDGET_SHORTENED' })?.getTime(), atDay(5).getTime())
    })
    it('5.5 a manual extension (day 30) wins over a recalculated day 25', () => {
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(3), previous: [A10, B5], next: [A10, { courseId: 'C', days: 15, completed: false }], reason: 'ROLE_CHANGED', manualExtensionDueAt: atDay(30) })?.getTime(), atDay(30).getTime())
    })
    it('5.5 a manual extension already in the past is ignored', () => {
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(40), previous: [A10], next: [A10, C10], reason: 'ROLE_CHANGED', manualExtensionDueAt: atDay(30) })?.getTime(), atDay(50).getTime())
    })
    it('5.7 a course re-added inside the window is not new: deadline falls back to the old day 20', () => {
      const X10 = { courseId: 'X', days: 10, completed: false }
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(18), previous: [A10], next: [A10, { ...X10, restored: true }], reason: 'ROLE_CHANGED', restoredPriorDueAt: atDay(20) })?.getTime(), atDay(20).getTime())
      // The same call without the restored flag is the exploit: 18 + 10 = 28.
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(18), previous: [A10], next: [A10, X10], reason: 'ROLE_CHANGED' })?.getTime(), atDay(28).getTime())
    })
    it('increasing a budget never shortens the current deadline', () => {
      assert.equal(calculateSharedDeadline({ ...base, changedAt: atDay(5), previous: [done({ ...A10, days: 30 }), B5], next: [done({ ...A10, days: 30 }), { ...B5, days: 7 }], reason: 'ROLE_CHANGED', currentDueAt: atDay(35) })?.getTime(), atDay(35).getTime())
    })
  })
  it('isWithinRestoreWindow includes exactly three days and excludes later or negative gaps', () => {
    assert.equal(isWithinRestoreWindow(atDay(18), atDay(21)), true)
    assert.equal(isWithinRestoreWindow(atDay(18), new Date(atDay(21).getTime() + 1)), false)
    assert.equal(isWithinRestoreWindow(atDay(18), atDay(17)), false)
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
