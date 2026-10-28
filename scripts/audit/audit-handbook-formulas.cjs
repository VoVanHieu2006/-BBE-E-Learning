// Independent expectations taken from docs/reference/handbook-formulas.md.
// All collaborators are in-memory fixtures; no live ranking/history is rewritten.
process.env.DATABASE_URL = 'postgresql://handbook_audit@127.0.0.1:1/handbook_audit'
process.env.DIRECT_URL = process.env.DATABASE_URL
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const { createHash } = require('node:crypto')
const path = require('node:path')
const Module = require('node:module')
require('ts-node').register({ project: 'tsconfig.test.json' })
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...args) { return resolve.call(this, request.startsWith('@/') ? path.resolve('src', request.slice(2)) : request, ...args) }
const { chapterCompetitionScore } = require('../../src/lib/competition-ranking-rules')
const { chapterSeasonRows, rankIndividuals } = require('../../src/lib/competition-snapshots')
const { calculateSharedDeadline, DAY_MS, highWaterIncrement } = require('../../src/lib/learning-cycle-rules')
const { gradeQuizAttempt } = require('../../src/lib/quiz-attempt-rules')
const { reconcileSharedPath } = require('../../src/lib/shared-learning-path')
const { executePublishCourseRequirements } = require('../../src/lib/course-requirements')
const { rewardEligibility } = require('../../src/lib/learning-periods')
const results = []
const at = day => new Date(Date.UTC(2026, 0, 1) + day * DAY_MS)
async function check(id, expected, run, validate) {
  let actual
  try { actual = await run(); validate(actual); results.push({ id, expected, actual, status: 'PASS' }) }
  catch (error) { results.push({ id, expected, actual: actual ?? error.message, status: 'FAIL' }) }
}
(async () => {
  await check('BOOK-1 normal month', 10, () => chapterCompetitionScore([{ startsAt: at(0), endsAt: at(30), memberCount: 30, qualifiedCount: 20, stars: 300 }], 'YELLOW', { coreLessonCount: 50 }).score, actual => assert.equal(actual, 10))
  const h = 3600000
  const stages = [{ startsAt: new Date(0), endsAt: new Date(350.5 * h), memberCount: 30, qualifiedCount: 20, stars: 100 }, { startsAt: new Date(350.5 * h), endsAt: new Date(720 * h), memberCount: 15, qualifiedCount: 3, stars: 40 }]
  await check('BOOK-2/3/4 transfer month and weighted conditions', { score: 6, average: (30 * 350.5 + 15 * 369.5) / 720, rate: (20 * 350.5 + 3 * 369.5) / (30 * 350.5 + 15 * 369.5) }, () => chapterCompetitionScore(stages, 'GREEN', { coreLessonCount: 50 }), actual => {
    assert(Math.abs(actual.score - 6) < 1e-12)
    assert(Math.abs(actual.averageMemberCount - (30 * 350.5 + 15 * 369.5) / 720) < 1e-12)
    assert(Math.abs(actual.at70Rate - (20 * 350.5 + 3 * 369.5) / (30 * 350.5 + 15 * 369.5)) < 1e-12)
    assert.equal(actual.eligible, true)
  })
  await check('BOOK-5 exact boundary N=20', false, () => chapterCompetitionScore([{ startsAt: at(0), endsAt: at(30), memberCount: 20, qualifiedCount: 10, stars: 200 }], 'GREEN', { coreLessonCount: 50 }).eligible, actual => assert.equal(actual, false))
  await check('BOOK-8 fastest individual', 'B', () => rankIndividuals([{ userId: 'A', stars: 100, elapsedMs: 20 * DAY_MS }, { userId: 'B', stars: 100, elapsedMs: 15 * DAY_MS }])[0].userId, actual => assert.equal(actual, 'B'))
  await check('BOOK-11 quiz high-water sequence', [0, 90, 0, 1, 9, 0], () => {
    let best = 0
    const questions = Array.from({ length: 100 }, (_, i) => ({ id: `q${i}`, points: 1, options: [{ id: `yes${i}`, correct: true, text: 'Correct' }, { id: `no${i}`, correct: false, text: 'Wrong' }] }))
    return [80, 90, 85, 91, 100, 100].map(correct => {
      const result = gradeQuizAttempt(questions, questions.map((q, i) => ({ questionId: q.id, selectedOptionId: i < correct ? `yes${i}` : `no${i}` })), .85)
      const delta = result.passed ? highWaterIncrement(best, correct) : 0
      if (result.passed) best = Math.max(best, correct)
      return delta
    })
  }, actual => assert.deepEqual(actual, [0, 90, 0, 1, 9, 0]))
  await check('BOOK-19 single-course Admin shortening', 23, () => (calculateSharedDeadline({ startsAt: at(0), changedAt: at(20), currentDueAt: at(30), previous: [{ courseId: 'A', days: 30, completed: false }], next: [{ courseId: 'A', days: 10, completed: false }], reason: 'ADMIN_BUDGET_SHORTENED' }).getTime() - at(0)) / DAY_MS, actual => assert.equal(actual, 23))

  await check('BOOK-6/13 early transfer keeps the entire September in the ending competition season', 10, async () => {
    const monthStart = new Date('2026-09-01T00:00:00+07:00'), transfer = new Date('2026-09-15T12:00:00+07:00'), monthEnd = new Date('2026-10-01T00:00:00+07:00')
    const tx = {
      chapter: { findMany: async () => [{ id: 'chapter', name: 'Chapter' }] },
      transferSeason: { findUnique: async () => ({ id: 'ending-season', reward_boundary_at: new Date('2026-04-01T00:00:00+07:00') }) },
      chapterCompetitionTerm: { findMany: async () => [{ id: 'old-training-term', chapter_id: 'chapter', season_id: 'ending-season', starts_at: monthStart, ends_at: transfer }] },
      competitionMonth: { findMany: async () => [{ id: 'september', key: '2026-09', starts_at: monthStart, ends_at: monthEnd, state: 'CLOSED' }] },
      learningSnapshot: { findUnique: async () => ({ payload: { state: 'FINALIZED', items: [{ chapterId: 'chapter', score: 10, eligible: true, stages: [{ startsAt: monthStart, endsAt: transfer, memberCount: 30, qualifiedCount: 25, stars: 120, stageScore: 4 }, { startsAt: transfer, endsAt: monthEnd, memberCount: 25, qualifiedCount: 20, stars: 150, stageScore: 6 }] }] } }) },
    }
    return (await chapterSeasonRows(tx, 'ending-season', monthEnd)).items[0].score
  }, actual => assert.equal(actual, 10))
  await check('BOOK-18 approved shared deadline: role change at day 5 ends at day 21', 21, async () => {
    let updated
    const tx = {
      userLearningAssignment: {
        findMany: async () => [{ course_id: 'A', completed_at: null, course: { mandatory_default_due_days: 10 } }, { course_id: 'C', completed_at: null, course: { mandatory_default_due_days: 11 } }],
        updateMany: async args => { updated = args.data.due_at; return { count: 2 } },
      },
      learningPath: { upsert: async () => ({ id: 'path', starts_at: at(0), due_at: at(20), budget_fingerprint: 'A:10|B:10', budget: [{ courseId: 'A', days: 10, completed: false }, { courseId: 'B', days: 10, completed: false }] }), update: async () => ({}) },
      learningPathChange: { count: async () => 1, create: async () => ({}) },
    }
    await reconcileSharedPath(tx, 'user', 'cycle', at(5))
    return (updated - at(0)) / DAY_MS
  }, actual => assert.equal(actual, 21))
  await check('BOOK-20 newly published lessons use publication instant, not an expired previous deadline', 26, async () => {
    let due
    const course = { id: 'course', title: 'Course', program_id: 'core', content_version: 1, mandatory_default_due_days: 20, final_assessment: null, sessions: [{ lessons: Array.from({ length: 7 }, (_, i) => ({ id: `lesson${i}`, assessment: null })) }] }
    const tx = {
      course: { findUniqueOrThrow: async () => course, update: async () => course },
      learningPolicy: { findUnique: async () => ({ cutover_at: at(-10), mapping_approved_at: at(-10) }) },
      courseRequirementVersion: { findFirst: async () => ({ id: 'v1', version: 1, fingerprint: 'previous', lesson_ids: ['lesson0', 'lesson1', 'lesson2', 'lesson3', 'lesson4'] }), create: async args => ({ id: 'v2', ...args.data }) },
      userLearningAssignment: { findMany: async () => [{ user_id: 'user', learning_cycle_id: 'cycle' }], updateMany: async () => ({ count: 1 }) },
      learningCycle: { findUnique: async () => ({ id: 'cycle', ends_at: null }) },
      learningPath: { findUnique: async () => ({ id: 'path', due_at: at(10) }), update: async args => { due = args.data.due_at; return {} } },
      learningNotice: { upsert: async () => ({}) }, coursePublicationEvent: { create: async () => ({}) },
    }
    await executePublishCourseRequirements(tx, 'course', at(20))
    return (due - at(0)) / DAY_MS
  }, actual => assert.equal(actual, 26))
  results.push({ id: 'BOOK-17/18 decision', expected: 'Shared deadline using section 18', actual: 'Confirmed by user on 2026-10-25; section 17 separate deadlines are superseded', status: 'PASS' })
  await check('BOOK-VI management accounts: CHAPTER_MANAGER alias cannot earn stars', false, async () => {
    const tx = {
      user: { findUnique: async () => ({ role: 'MEMBER', status: 'ACTIVE', anonymized_at: null }) },
      positionAssignment: { count: async ({ where }) => where.position.code.in.includes('CHAPTER_MANAGER') ? 1 : 0 },
      course: { findUnique: async () => ({ status: 'PUBLISHED' }) },
      learningPolicy: { findUnique: async () => null },
    }
    return rewardEligibility(tx, 'manager', 'course', at(20))
  }, actual => assert.equal(actual, false))
  await fs.mkdir('artifacts/audits', { recursive: true })
  const source = await fs.readFile('docs/reference/handbook-formulas.md')
  await fs.writeFile('artifacts/audits/handbook-formula-tests.json', JSON.stringify({ source: 'docs/reference/handbook-formulas.md', sourceSha256: createHash('sha256').update(source).digest('hex'), mode: 'PURE_PRODUCTION_FUNCTION_AUDIT_NO_DB_WRITES', results }, null, 2) + '\n')
  console.log(JSON.stringify(results.map(row => ({ id: row.id, status: row.status, actual: row.status === 'FAIL' ? row.actual : undefined }))))
  if (results.some(row => row.status === 'FAIL')) process.exitCode = 1
})().catch(error => { console.error(error.message); process.exitCode = 1 })
