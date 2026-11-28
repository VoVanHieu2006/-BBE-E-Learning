import { beforeEach, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { NextRequest } from 'next/server'

// Resolve application aliases without loading .env or constructing a PrismaClient.
const Module = require('node:module')
const resolve = Module._resolveFilename
Module._resolveFilename = function (name: string, ...args: any[]) {
  return resolve.call(this, name.startsWith('@/') ? path.resolve(__dirname, '..', name.slice(2)) : name, ...args)
}
const stub = (name: string, exports: unknown) => {
  const filename = require.resolve(name)
  require.cache[filename] = { id: filename, filename, loaded: true, exports } as NodeModule
}
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const [userId, attemptId, assessmentId, lessonId, courseId, questionId] = [1, 2, 3, 4, 5, 6].map(id)
let now: Date, attempt: any, assessment: any, lesson: any, cycle: any, progress: any
let events: string[], role: string, onLock: () => void, atomicMiss: boolean, latest: any
let gateBlocked: boolean, globalReads: boolean, legacyStartedAt: Date, answers: any[]
let writes: number, authCalls: number, courseStatus: string
let olderAttempts: any[]
const failUnexpected = (name: string) => { throw new Error(`Unexpected database operation: ${name}`) }
const dbProxy = (name: string, methods: Record<string, any>) => new Proxy(methods, {
  get: (target, key: string) => key in target ? target[key] : () => failUnexpected(`${name}.${key}`),
})
const tx: any = {
  $queryRaw: async (sql: TemplateStringsArray) => {
    assert.match(sql.join(''), /SELECT id FROM attempts WHERE id = .*::uuid FOR UPDATE/)
    events.push('attempt-lock'); onLock(); return [{ id: attemptId }]
  },
  attempt: dbProxy('attempt', {
    findUnique: async () => { events.push('attempt-read'); return attempt && { ...attempt } },
    findFirst: async ({ where }: any) => {
      if (where.status?.in) { events.push('cooldown'); return latest }
      const active = [...olderAttempts, attempt].find(row => row?.status === 'IN_PROGRESS'
        && (!where.learning_cycle_id || where.learning_cycle_id === row.learning_cycle_id)
        && (!where.expires_at || row.expires_at > where.expires_at.gt))
      return active ? { ...active } : null
    },
    findMany: async () => [],
    count: async ({ where }: any) => {
      if (where.passed) return where.OR.some((branch: any) => branch.learning_cycle_id === null && (!branch.started_at || legacyStartedAt < branch.started_at.lt)) ? 1 : 0
      return 0
    },
    update: async ({ data }: any) => { writes++; Object.assign(attempt, data); return attempt },
    updateMany: async ({ where, data }: any) => {
      assert.equal(where.status, 'IN_PROGRESS'); assert.equal(where.user_id, userId)
      events.push('atomic-update')
      if (atomicMiss) { attempt.status = 'SUBMITTED'; attempt.score = 1; attempt.passed = true; return { count: 0 } }
      if (attempt?.status !== where.status || attempt.user_id !== where.user_id) return { count: 0 }
      writes++; Object.assign(attempt, data); return { count: 1 }
    },
    create: async ({ data }: any) => { writes++; return { id: 'new-attempt', ...data } },
  }),
  lesson: { findUnique: async (args: any) => {
    if (args.include?.session?.include?.course) events.push('course-status-selected')
    return lesson
  } },
  course: { findUnique: async () => ({ id: courseId, status: courseStatus, final_assessment: { id: assessmentId }, sessions: [{ lessons: [{ id: lessonId, video: null, assessment: { id: 'unpassed-quiz' } }] }] }) },
  learningCycle: { findFirst: async () => cycle },
  userLearningAssignment: { findMany: async () => [] },
  user: { findUnique: async () => ({ id: userId, status: 'ACTIVE' }) },
  assessment: {
    findUnique: async () => assessment,
    update: async ({ data }: any) => { events.push('assessment-update'); Object.assign(assessment, data); return assessment },
    delete: async () => { events.push('assessment-delete'); assessment = null },
    create: async ({ data }: any) => { events.push('assessment-create'); assessment = { ...data, created_at: now }; return assessment },
  },
  attemptQuestion: { findMany: async () => [], findUnique: async () => ({ question_id: questionId }), createMany: async () => ({ count: 1 }) },
  attemptAnswer: { findMany: async () => answers, upsert: async ({ create }: any) => { writes++; answers = [create]; return create } },
  questionOption: { findFirst: async () => ({ id: 'option' }), deleteMany: async () => { events.push('options-delete') }, createMany: async () => ({ count: 2 }) },
  question: { findMany: async () => [{ id: questionId, question_text: 'Question', points: 1, options: [{ id: 'option', option_text: 'Yes', is_correct: true }] }], deleteMany: async () => { events.push('questions-delete') }, createMany: async () => ({ count: 1 }) },
  questionPool: { findMany: async () => [], deleteMany: async () => { events.push('pools-delete') } },
  finalExamVersion: { findFirst: async () => ({ id: 'version', question_count: 1, duration_minutes: 30 }) },
  lessonProgress: { findUnique: async () => null, findMany: async () => [], upsert: async ({ create }: any) => { writes++; return create } },
  cycleLessonProgress: { findUnique: async () => progress, findMany: async () => [], upsert: async ({ create }: any) => create },
  monthlyVideoReplay: { findUnique: async () => null, upsert: async ({ create }: any) => create },
  quizRewardHighWaterMark: { upsert: async () => ({}) },
  starLedger: { aggregate: async () => ({ _sum: { amount: 0 } }) },
}
const prisma: any = new Proxy({
  $transaction: async (fn: any) => { events.push('transaction'); return fn(tx) },
}, { get: (target: any, name: string) => {
  if (name in target) return target[name]
  if (!globalReads) return dbProxy(`global.${name}`, {})
  // Preflight must not see a submit that happens while waiting for the user lock.
  if (name === 'attempt') return { ...tx.attempt, findFirst: async (args: any) => args.where.status?.in ? null : tx.attempt.findFirst(args) }
  return tx[name] || dbProxy(name, {})
} })
stub('../lib/prisma', { prisma })
stub('../lib/auth', { authenticate: async () => { authCalls++; return { ok: true, context: { userId, role } } } })
stub('../lib/learning-periods', {
  lockLearningUser: async (client: any, uid: string) => { assert.equal(client, tx); assert.equal(uid, userId); events.push('user-lock'); return now },
  learningContext: async () => ({ now, cycle, month: { id: 'month', key: '2026-11', starts_at: cycle.starts_at } }),
  currentCycleAttemptFilter: async (client: any) => { assert.equal(client, tx); events.push('cycle-filter'); return { learning_cycle_id: cycle.id } },
  rewardEligibility: async () => false, enqueueAssignmentSync: async () => {},
})
const stateModule = require('../lib/lesson-learning-state')
stub('../lib/lesson-learning-state', { ...stateModule, readCourseLearningStates: async (client: any) => {
  assert.equal(client, tx); events.push('lesson-states'); return { [lessonId]: { canView: true, canAssess: true } }
} })
const actualProgression = require('../lib/progression')
stub('../lib/progression', {
  checkCourseFinalProgression: async (...args: any[]) => {
    events.push(args[3] === tx ? 'final-gate-tx' : 'final-gate-global')
    return gateBlocked ? { ok: false, code: 'LessonAssessmentRequired', message: 'Quiz required' } : { ok: true, courseId, canEarnStars: false }
  },
  checkLessonProgression: async (...args: any[]) => {
    events.push(args[4] === tx ? 'lesson-gate-tx' : 'lesson-gate-global')
    return gateBlocked ? { ok: false, code: 'PreviousLessonIncomplete', message: 'Locked' } : { ok: true, courseId, canEarnStars: false }
  },
})
stub('../lib/final-exam-bank', { lockCourseExamBank: async (client: any) => { assert.equal(client, tx); events.push('bank-lock') }, assertFinalExamBankCapacity: async () => {}, finalExamBankError: () => null })
stub('../lib/manager-learning-access', { isLearningManager: async () => false })
stub('../lib/assessment-schedule', { applyDueAssessmentSchedules: async () => {}, applyDueCourseAssessmentSchedules: async () => [], hasCurrentMonthLockingAttempts: async () => false, scheduleColumns: () => ({}), existingScheduleOf: () => null })
stub('../lib/course-edit-guard', { guardCourseEditableByLesson: async () => null, invalidateCourseContentCaches: () => {} })
stub('../lib/server-cache', { getLessonDetailServerCache: () => null, setLessonDetailServerCache: () => {} })
stub('../lib/content-deletion', {})
stub('../lib/deleted-content-assets', {})
stub('../lib/learning-assignments', { syncCourseAssignmentCompletion: async () => {} })
stub('../lib/learning-unlocks', { persistLearningUnlocks: async () => {} })
stub('../lib/chapter-reward-gate', { chapterRewardState: async () => ({ paused: false }) })
stub('../lib/monthly-review', { loadMonthlyQuizBlock: async () => null, isFreeReviewLesson: () => true, cycleVideoAlreadyComplete: () => true, lessonStarsThisMonth: async () => ({ videoStars: 0, quizStars: 0 }) })

const cancel = require('../app/api/v1/attempts/[attemptId]/cancel/route')
const attemptRoute = require('../app/api/v1/attempts/[attemptId]/route')
const answerRoute = require('../app/api/v1/attempts/[attemptId]/answers/[questionId]/route')
const startRoute = require('../app/api/v1/assessments/[assessmentId]/attempts/route')
const lessonRoute = require('../app/api/v1/lessons/[lessonId]/route')
const quizRoute = require('../app/api/v1/lessons/[lessonId]/assessment/route')
const { recordVideoHeartbeat } = require('../lib/video-heartbeat')
const { submitQuiz } = require('../lib/quiz-submission')
const request = (method = 'POST', body: any = {}, cookie?: string) => new NextRequest('http://localhost/api/test', {
  method, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }), headers: cookie ? { cookie } : {},
})
const params = { params: { attemptId, questionId, assessmentId, lessonId } }
beforeEach(() => {
  now = new Date(); events = []; role = 'MEMBER'; writes = 0; authCalls = 0; onLock = () => {}; atomicMiss = false
  latest = null; gateBlocked = false; globalReads = true; courseStatus = 'PUBLISHED'; answers = []; olderAttempts = []
  cycle = { id: 'cycle', provenance: 'LEGACY', starts_at: new Date(now.getTime() - 86400000) }
  legacyStartedAt = new Date(cycle.starts_at.getTime() + 1000)
  assessment = { id: assessmentId, type: 'COURSE_FINAL', course_id: courseId, lesson_id: null, question_count: 1, duration_minutes: 30, created_at: new Date('2020-01-01'), _count: { attempts: 0 } }
  attempt = { id: attemptId, user_id: userId, assessment_id: assessmentId, learning_cycle_id: cycle.id, status: 'IN_PROGRESS', score: null, passed: null, expires_at: new Date(now.getTime() + 60000), started_at: now, submitted_at: null, attempt_number: 1 }
  lesson = { id: lessonId, session_id: 'session', session: { course_id: courseId, course: { id: courseId, status: courseStatus, visibility: 'PUBLIC' } }, video: { id: 'video', duration_seconds: 60 }, assessment: { id: assessmentId }, documents: [] }
  progress = { unlocked_at: now, completed_at: null, furthest_seconds: 60 }
})

for (const [label, handler] of [['POST cancel', cancel.POST], ['DELETE attempt', attemptRoute.DELETE]] as const) {
  for (const status of ['SUBMITTED', 'AUTO_SUBMITTED']) it(`A1 ${label}: submit wins before cancellation lock (${status})`, async () => {
    onLock = () => { Object.assign(attempt, { status, score: 1, passed: true }) }
    const response = await handler(request(), params)
    assert.ok([400, 409].includes(response.status)); assert.equal(attempt.status, status)
    assert.equal(attempt.score, 1); assert.equal(attempt.passed, true); assert.equal(writes, 0)
    assert.deepEqual(events.slice(0, 4), ['transaction', 'user-lock', 'attempt-lock', 'attempt-read'])
    const body = await response.json()
    assert.equal(body.error.code, label === 'POST cancel' ? 'AttemptAlreadySubmitted' : 'AttemptNotInProgress')
    if (label === 'POST cancel') { assert.equal(response.status, 409); assert.equal(body.status, status) }
  })
  it(`A1 ${label}: conditional cancellation cannot overwrite a competing submission`, async () => {
    atomicMiss = true
    const response = await handler(request(), params)
    assert.ok([400, 409].includes(response.status)); assert.equal(attempt.status, 'SUBMITTED'); assert.equal(writes, 0)
  })
  it(`A1 ${label}: cancels an owned in-progress attempt atomically`, async () => {
    assert.equal((await handler(request(), params)).status, 200)
    assert.equal(attempt.status, 'CANCELLED'); assert.equal(writes, 1); assert.ok(events.includes('atomic-update'))
  })
  it(`A1 ${label}: checks ownership after locking`, async () => {
    attempt.user_id = 'other'; assert.equal((await handler(request(), params)).status, 403); assert.equal(writes, 0)
    assert.deepEqual(events.slice(0, 4), ['transaction', 'user-lock', 'attempt-lock', 'attempt-read'])
  })
  it(`A1 ${label}: missing attempt returns 404 without writes`, async () => {
    attempt = null; assert.equal((await handler(request(), params)).status, 404); assert.equal(writes, 0)
  })
}
it('A1 POST cancel: already cancelled is idempotent with its original timestamp', async () => {
  attempt.status = 'CANCELLED'; attempt.submitted_at = new Date('2026-01-01')
  const response = await cancel.POST(request(), params)
  assert.equal(response.status, 200); assert.equal((await response.json()).cancelledAt, attempt.submitted_at.toISOString()); assert.equal(writes, 0)
})
it('A1 beacon guard suppresses submit/result/cancel and allows only live attempts', () => {
  const { shouldSendCancelBeacon } = require('../lib/quiz-cancel-guard')
  const live = { attemptId, hasResult: false, isSubmitting: false, isCancelled: false, nowMs: now.getTime() }
  assert.equal(shouldSendCancelBeacon(live), true)
  for (const patch of [{ attemptId: null }, { hasResult: true }, { isSubmitting: true }, { isCancelled: true }]) assert.equal(shouldSendCancelBeacon({ ...live, ...patch }), false)
})
it('A1 beacon uses the deadline even when the background countdown tick has not fired', () => {
  const { shouldSendCancelBeacon } = require('../lib/quiz-cancel-guard')
  const live = { attemptId, hasResult: false, isSubmitting: false, isCancelled: false, deadlineMs: 1000 }
  assert.equal(shouldSendCancelBeacon({ ...live, nowMs: 999 }), true)
  assert.equal(shouldSendCancelBeacon({ ...live, nowMs: 1000 }), false)
  assert.equal(shouldSendCancelBeacon({ ...live, nowMs: 1001 }), false)
})
for (const status of ['SUBMITTED', 'EXPIRED', 'EXACT_EXPIRY']) it(`A6 single answer: rejects ${status} after acquiring attempt lock`, async () => {
  onLock = () => status === 'SUBMITTED' ? attempt.status = status : attempt.expires_at = new Date(Date.now() - (status === 'EXPIRED' ? 1000 : 0))
  const response = await answerRoute.PUT(request('PUT', { selectedOptionId: 'option' }), params)
  assert.equal(response.status, 400); assert.equal(writes, 0); assert.ok(events.includes('attempt-lock'))
})
it('A6 single answer: owned live attempt saves under its row lock', async () => {
  assert.equal((await answerRoute.PUT(request('PUT', { selectedOptionId: 'option' }), params)).status, 200)
  assert.equal(answers[0].selected_option_id, 'option')
  assert.deepEqual(events.slice(0, 3), ['transaction', 'attempt-lock', 'attempt-read'])
})
it('A2 same-cycle final resumes despite an added unpassed lesson quiz', async () => {
  gateBlocked = true
  const response = await startRoute.POST(request(), params)
  assert.equal(response.status, 200); assert.equal((await response.json()).isResumed, true)
  assert.ok(!events.some(e => e.startsWith('final-gate'))); assert.equal(writes, 0)
  assert.ok(events.includes('user-lock') && events.includes('bank-lock'))
})
it('A2 an expired attempt cannot hide a live same-cycle attempt during locked resume', async () => {
  olderAttempts = [{ ...attempt, id: 'expired-attempt', expires_at: new Date(now.getTime() - 1) }]
  gateBlocked = true
  const response = await startRoute.POST(request(), params)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.isResumed, true); assert.equal(body.attemptId, attemptId); assert.equal(writes, 0)
})
it('A2 same-cycle final submission still grades after a new lesson quiz is added', async () => {
  gateBlocked = true
  attempt.assessment = assessment
  attempt.attempt_questions = [{ question_id: questionId, question: { id: questionId, points: 1, explanation: null, options: [{ id: 'option', option_text: 'Yes', is_correct: true }] } }]
  attempt.attempt_answers = []
  answers = [{ question_id: questionId, selected_option_id: 'option' }]
  const result = await submitQuiz({ attemptId, userId })
  assert.equal(result.grading.passed, true); assert.equal(attempt.status, 'SUBMITTED'); assert.equal(attempt.passed, true)
})
it('A2 stale-cycle final cannot resume or bypass the new-attempt gate', async () => {
  gateBlocked = true; attempt.learning_cycle_id = 'old-cycle'
  const response = await startRoute.POST(request(), params)
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'LessonAssessmentRequired'); assert.equal(writes, 0)
})
it('A2 null-cycle final cannot resume when there is an active learning cycle', async () => {
  gateBlocked = true; attempt.learning_cycle_id = null
  const response = await startRoute.POST(request(), params)
  assert.equal(response.status, 403); assert.equal(writes, 0)
})
it('A2 new final starts when progression passes and no cooldown is active', async () => {
  attempt = null
  const response = await startRoute.POST(request(), params)
  assert.equal(response.status, 201); assert.equal((await response.json()).isResumed, false)
  assert.equal(writes, 1); assert.ok(events.includes('final-gate-tx')); assert.ok(!events.includes('final-gate-global'))
})
it('A2 unpublished course cannot resume an in-progress final', async () => {
  courseStatus = 'DRAFT'
  const response = await startRoute.POST(request(), params)
  assert.equal(response.status, 403); assert.equal(writes, 0)
})
it('A2/A4 new final checks progression through tx after the exam-bank lock', async () => {
  attempt = null; gateBlocked = true
  const response = await startRoute.POST(request(), params)
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'LessonAssessmentRequired')
  assert.ok(events.indexOf('bank-lock') >= 0 && events.indexOf('final-gate-tx') > events.indexOf('bank-lock')); assert.equal(writes, 0)
})
it('A2 new final rechecks cooldown under the user lock after concurrent submission', async () => {
  attempt = null; latest = { submitted_at: now, created_at: now }
  const response = await startRoute.POST(request(), params)
  assert.equal(response.status, 429); assert.equal((await response.json()).error.code, 'CooldownActive'); assert.equal(writes, 0)
  assert.ok(events.indexOf('cooldown') > events.indexOf('user-lock'))
})
it('A3 unlocked DRAFT lesson rejects heartbeat without progress writes', async () => {
  lesson.session.course.status = 'DRAFT'
  const result = await recordVideoHeartbeat(userId, lessonId, 60, 60)
  assert.equal(result.error?.code, 'NotAssigned'); assert.equal(writes, 0); assert.ok(events.includes('course-status-selected'))
})
it('A4 heartbeat uses its transaction for the lesson gate', async () => {
  progress.unlocked_at = null; gateBlocked = true
  const result = await recordVideoHeartbeat(userId, lessonId, 0, 0)
  assert.equal(result.error?.code, 'PreviousLessonIncomplete'); assert.ok(events.includes('lesson-gate-tx'))
})
it('A4 lesson progression uses only supplied tx including learning-state reads', async () => {
  globalReads = false
  assert.equal((await actualProgression.checkLessonProgression(userId, lessonId, 'WATCH', false, tx)).ok, true)
  assert.ok(events.includes('lesson-states'))
})
it('A4 final progression uses only supplied tx including cycle filtering', async () => {
  globalReads = false
  const gate = await actualProgression.checkCourseFinalProgression(userId, courseId, false, tx)
  assert.equal(gate.ok, false); assert.equal(gate.code, 'LessonAssessmentsIncomplete'); assert.ok(events.includes('cycle-filter'))
})
for (const [offset, completed] of [[1000, false], [0, false], [-1000, true]] as const) it(`A5 LEGACY null-cycle attempt at start ${offset}ms: completed=${completed}`, async () => {
  legacyStartedAt = new Date(cycle.starts_at.getTime() + offset)
  const result = await recordVideoHeartbeat(userId, lessonId, 60, 60)
  assert.equal(result.cycleProgress.completed, completed)
})
for (const cookie of ['accessToken', 'refreshToken']) it(`C2 ${cookie} cookie enforces progression on PUBLIC course`, async () => {
  gateBlocked = true
  const response = await lessonRoute.GET(request('GET', undefined, `${cookie}=test-only`), params)
  assert.equal(authCalls, 1); assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'PreviousLessonIncomplete')
})
const quizBody = { title: 'Existing quiz', questionCount: 1, durationMinutes: 30, questions: [{ questionText: 'Updated question', options: [{ optionText: 'Yes', isCorrect: true }, { optionText: 'No', isCorrect: false }] }] }
it('quiz-skip: zero-attempt quiz updates in place and remains required for existing learners', async () => {
  role = 'ADMIN'; assessment.type = 'LESSON'; assessment.lesson_id = lessonId
  const created = assessment.created_at
  const response = await quizRoute.POST(request('POST', quizBody), params)
  assert.equal(response.status, 201); assert.equal((await response.json()).assessmentId, assessmentId)
  assert.equal(assessment.created_at, created); assert.equal(stateModule.isNewForLearner(assessment.created_at, now, false), false)
  assert.ok(events.includes('assessment-update')); assert.ok(!events.includes('assessment-create')); assert.ok(!events.includes('assessment-delete'))
  assert.ok(events.includes('options-delete') && events.includes('questions-delete') && events.includes('pools-delete'))
})
it('quiz-skip: genuinely new quiz is created and receives the new-quiz badge', async () => {
  role = 'ADMIN'; assessment = null
  const response = await quizRoute.POST(request('POST', quizBody), params)
  assert.equal(response.status, 201); assert.ok(events.includes('assessment-create'))
  assert.equal(stateModule.isNewForLearner(assessment.created_at, new Date(now.getTime() - 1000), false), true)
})
