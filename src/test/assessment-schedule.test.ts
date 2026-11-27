import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { Prisma } from '@prisma/client'
import { NextRequest } from 'next/server'
import { applyDueAssessmentSchedules, hasCurrentMonthLockingAttempts } from '../lib/assessment-schedule'
import { applyCourseDraft } from '../lib/apply-course-draft'
import { courseDraftSnapshot } from '../lib/course-draft-snapshot'
import { CourseDraftError } from '../lib/course-draft'
import { assertFinalExamBankCapacity, FinalExamBankTooSmall, finalExamBankError } from '../lib/final-exam-bank'

const vn = (local: string) => new Date(`${local}+07:00`)
const NOW = vn('2026-11-15T10:00:00')
const NEXT_MONTH = vn('2026-12-01T00:00:00')
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const COURSE = uid(1), SESSION = uid(2), LESSON = uid(3), QUIZ = uid(4), FINAL = uid(5), ACTOR = uid(6)
const qid = (i: number) => uid(100 + i)
const oid = (i: number, j: number) => uid(1000 + i * 10 + j)

type Attempt = { assessment_id: string; status: string; started_at: Date; expires_at?: Date }
const attempt = (status: string, started_at = vn('2026-11-10T09:00:00'), assessment_id = QUIZ): Attempt => ({ assessment_id, status, started_at })
const scheduleColumns = (s?: { count: number; duration: number }) => s
  ? { scheduled_question_count: s.count, scheduled_duration_minutes: s.duration, scheduled_effective_at: NEXT_MONTH, scheduled_effective_month_key: '2026-12' }
  : { scheduled_question_count: null, scheduled_duration_minutes: null, scheduled_effective_at: null, scheduled_effective_month_key: null }

/** In-memory course for applyCourseDraft: records writes and folds assessment updates back into the rows. */
function courseFixture(opts: { questions?: number; questionCount?: number; refs?: Record<number, [number, number]>; schedule?: { count: number; duration: number }; final?: { schedule?: { count: number; duration: number } } } = {}) {
  const questions = Array.from({ length: opts.questions ?? 30 }, (_, i) => ({
    id: qid(i), assessment_id: QUIZ, question_text: `Câu ${i + 1}`, question_type: 'SINGLE_CHOICE', points: 1, explanation: null, sort_order: i, pool_id: null,
    options: [{ id: oid(i, 0), option_text: 'Đúng', is_correct: true, sort_order: 0 }, { id: oid(i, 1), option_text: 'Sai', is_correct: false, sort_order: 1 }],
    _count: { attempt_questions: opts.refs?.[i]?.[0] ?? 0, attempt_answers: opts.refs?.[i]?.[1] ?? 0 },
  }))
  const quiz: any = { id: QUIZ, title: 'Quiz bài 1', description: null, question_count: opts.questionCount ?? 10, duration_minutes: 30, ...scheduleColumns(opts.schedule), _count: { attempts: 1 }, questions, question_pools: [] }
  const final: any = opts.final ? { id: FINAL, title: 'Thi cuối khóa', description: null, question_count: 10, duration_minutes: 60, ...scheduleColumns(opts.final.schedule), final_exam_versions: [{ id: uid(7) }], _count: { attempts: 1 } } : null
  const row: any = { id: COURSE, title: 'Khóa học', description: null, visibility: 'PRIVATE', cover_url: null, cover_public_id: null, final_assessment: final,
    sessions: [{ id: SESSION, title: 'Buổi 1', description: null, sort_order: 0, lessons: [{ id: LESSON, title: 'Bài 1', description: null, sort_order: 0, video: null, documents: [], assessment: quiz }] }] }
  const attempts: Attempt[] = []
  const writes: { table: string; op: string; args: any }[] = []
  let generated = 500
  const tx: any = {
    $queryRaw: async () => [],
    attempt: { count: async ({ where }: any) => attempts.filter(a => a.assessment_id === where.assessment_id && a.started_at >= where.started_at.gte && a.started_at < where.started_at.lt && where.status.in.includes(a.status)).length },
  }
  for (const table of ['course', 'session', 'lesson', 'video', 'document', 'assessment', 'question', 'questionOption', 'questionPool', 'finalExamVersion']) {
    tx[table] = {}
    for (const op of ['update', 'create', 'delete', 'deleteMany', 'upsert', 'createMany', 'updateMany']) tx[table][op] = async (args: any) => {
      writes.push({ table, op, args })
      if (table === 'assessment' && op === 'update') Object.assign([quiz, final].find(a => a?.id === args.where.id), args.data)
      return { id: args.where?.id || uid(generated++), ...args.data }
    }
  }
  tx.course.findUniqueOrThrow = async () => row
  tx.assessment.findUnique = async ({ where }: any) => where.course_id ? final : null
  tx.question.count = async () => questions.length
  const lessonDraft = (content: any) => content.sessions[0].lessons[0].assessment
  return {
    row, quiz, final, attempts, writes, tx, lessonDraft,
    content: () => courseDraftSnapshot(row),
    publish: (content: any) => applyCourseDraft(tx as Prisma.TransactionClient, COURSE, content, ACTOR, NOW),
    assessmentUpdate: (id: string) => writes.filter(w => w.table === 'assessment' && w.op === 'update' && w.args.where.id === id).at(-1)?.args.data,
  }
}

describe('soft-archive câu hỏi đã có lượt làm', () => {
  it('sửa câu đã có lượt làm: lưu trữ dòng cũ, tạo dòng mới; xóa câu đã có lượt làm: chỉ lưu trữ; câu chưa dùng mới bị xóa thật', async () => {
    const f = courseFixture({ refs: { 0: [1, 0], 1: [0, 1] } })
    const content = f.content()
    const quiz = f.lessonDraft(content)
    quiz.questions[1].questionText = 'Câu 2 đã sửa'
    quiz.questions = quiz.questions.filter((q: any) => q.id !== qid(0) && q.id !== qid(2))
    await f.publish(content)
    const archived = f.writes.filter(w => w.table === 'question' && w.op === 'update' && w.args.data.archived_at)
    assert.deepEqual(archived.map(w => w.args.where.id).sort(), [qid(0), qid(1)])
    for (const w of archived) { assert.equal(w.args.data.archived_at.getTime(), NOW.getTime()); assert.equal(w.args.data.pool_id, null) }
    const deleted = f.writes.filter(w => w.table === 'question' && w.op === 'deleteMany').flatMap(w => w.args.where.id.in)
    assert.deepEqual(deleted, [qid(2)])
    const created = f.writes.filter(w => w.table === 'question' && w.op === 'create')
    assert.deepEqual(created.map(w => w.args.data.question_text), ['Câu 2 đã sửa'])
    const touchedOptions = f.writes.filter(w => w.table === 'questionOption' && w.op !== 'create')
    assert.ok(!touchedOptions.some(w => [oid(0, 0), oid(0, 1), oid(1, 0), oid(1, 1)].includes(w.args.where.id)), 'đáp án cũ giữ nguyên cho lịch sử chấm')
    assert.ok(!f.writes.some(w => /attempt/i.test(w.table)), 'AttemptQuestion/AttemptAnswer không bị đụng tới')
  })
  it('đổi thứ tự câu đã có lượt làm (không đổi nội dung chấm) thì cập nhật tại chỗ, không lưu trữ', async () => {
    const f = courseFixture({ refs: { 0: [1, 0] } })
    const content = f.content()
    const quiz = f.lessonDraft(content)
    quiz.questions.push(quiz.questions.shift())
    await f.publish(content)
    assert.ok(!f.writes.some(w => w.table === 'question' && w.args.data?.archived_at))
    assert.equal(f.writes.find(w => w.table === 'question' && w.op === 'update' && w.args.where.id === qid(0))?.args.data.sort_order, 29)
  })
})

describe('lượt làm khóa cấu hình tháng hiện tại (giờ Việt Nam)', () => {
  const locks = async (...list: Attempt[]) => {
    const f = courseFixture()
    f.attempts.push(...list)
    return hasCurrentMonthLockingAttempts(f.tx, QUIZ, NOW)
  }
  it('IN_PROGRESS, SUBMITTED, AUTO_SUBMITTED trong tháng đều khóa', async () => {
    for (const status of ['IN_PROGRESS', 'SUBMITTED', 'AUTO_SUBMITTED']) assert.equal(await locks(attempt(status)), true, status)
  })
  it('lượt bắt đầu đúng 00:00:00 ngày 1 giờ VN thuộc tháng này', async () => {
    assert.equal(await locks(attempt('SUBMITTED', vn('2026-11-01T00:00:00'))), true)
  })
  it('CANCELLED, lượt tháng trước (23:59:59 ngày cuối tháng trước) và lượt của bài khác không khóa', async () => {
    assert.equal(await locks(), false)
    assert.equal(await locks(attempt('CANCELLED')), false)
    assert.equal(await locks(attempt('SUBMITTED', vn('2026-10-31T23:59:59'))), false)
    assert.equal(await locks(attempt('SUBMITTED', NOW, FINAL)), false)
  })
})

describe('hẹn cấu hình tháng sau cho quiz bài học', () => {
  it('chỉ đổi thời gian khi tháng này đã có lượt làm: giữ cấu hình hiện hành, hẹn 00:00 ngày 1 tháng sau', async () => {
    const f = courseFixture()
    f.attempts.push(attempt('SUBMITTED'))
    const content = f.content()
    f.lessonDraft(content).durationMinutes = 45
    const { scheduledUpdates } = await f.publish(content)
    const data = f.assessmentUpdate(QUIZ)
    assert.deepEqual([data.question_count, data.duration_minutes, data.scheduled_question_count, data.scheduled_duration_minutes, data.scheduled_effective_month_key], [10, 30, 10, 45, '2026-12'])
    assert.equal(data.scheduled_effective_at.getTime(), NEXT_MONTH.getTime())
    assert.equal(data.scheduled_by_user_id, ACTOR)
    assert.equal(data.scheduled_at.getTime(), NOW.getTime())
    assert.deepEqual(scheduledUpdates.map(u => [u.type, u.currentDurationMinutes, u.durationMinutes, u.effectiveMonthKey]), [['LESSON', 30, 45, '2026-12']])
  })
  it('sửa lịch nhiều lần 10 → 20 → 30 rồi hủy (cả hủy tường minh lẫn đặt về giá trị hiện hành)', async () => {
    const f = courseFixture()
    f.attempts.push(attempt('IN_PROGRESS'))
    let content = f.content()
    f.lessonDraft(content).questionCount = 20
    await f.publish(content)
    assert.deepEqual([f.quiz.question_count, f.quiz.scheduled_question_count], [10, 20])
    content = f.content()
    assert.equal(f.lessonDraft(content).scheduledQuestionCount, 20, 'bản nháp mang lịch hiện có')
    f.lessonDraft(content).scheduledQuestionCount = 30
    const third = await f.publish(content)
    assert.deepEqual([f.quiz.question_count, f.quiz.scheduled_question_count], [10, 30])
    assert.equal(third.scheduledUpdates[0].questionCount, 30)
    content = f.content()
    f.lessonDraft(content).cancelSchedule = true
    const cancelled = await f.publish(content)
    assert.deepEqual([f.quiz.question_count, f.quiz.scheduled_question_count, f.quiz.scheduled_effective_at], [10, null, null])
    assert.deepEqual(cancelled.scheduledUpdates, [])
    f.lessonDraft(content = f.content()).questionCount = 25
    await f.publish(content)
    assert.equal(f.quiz.scheduled_question_count, 25)
    content = f.content()
    f.lessonDraft(content).scheduledQuestionCount = 10
    await f.publish(content)
    assert.deepEqual([f.quiz.question_count, f.quiz.scheduled_question_count], [10, null], 'đặt lịch về giá trị hiện hành = hủy lịch')
  })
  it('không có lượt làm tháng này: áp dụng ngay và xóa lịch cũ', async () => {
    const f = courseFixture({ schedule: { count: 20, duration: 30 } })
    f.attempts.push(attempt('CANCELLED'), attempt('SUBMITTED', vn('2026-10-20T10:00:00')))
    const content = f.content()
    f.lessonDraft(content).cancelSchedule = false
    f.lessonDraft(content).scheduledQuestionCount = null
    f.lessonDraft(content).questionCount = 15
    const { scheduledUpdates } = await f.publish(content)
    assert.deepEqual([f.quiz.question_count, f.quiz.scheduled_question_count, f.quiz.scheduled_effective_at], [15, null, null])
    assert.deepEqual(scheduledUpdates, [])
  })
  it('chặn khi ngân hàng nhỏ hơn số câu hẹn tháng sau, kèm gợi ý thêm câu hoặc giảm/hủy lịch', async () => {
    const f = courseFixture({ schedule: { count: 20, duration: 30 } })
    f.attempts.push(attempt('SUBMITTED'))
    const content = f.content()
    f.lessonDraft(content).questions = f.lessonDraft(content).questions.slice(0, 15)
    await assert.rejects(f.publish(content), (e: unknown) => e instanceof CourseDraftError && e.status === 400 && e.code === 'ScheduledQuestionCountExceedsBank'
      && /20 câu/.test(e.message) && /tối đa 15/.test(e.message) && /giảm\/hủy/.test(e.message))
  })
  it('bị chặn cả khi bank nhỏ hơn số câu hiện hành đang khóa trong tháng', async () => {
    const f = courseFixture()
    f.attempts.push(attempt('SUBMITTED'))
    const content = f.content()
    const quiz = f.lessonDraft(content)
    quiz.questions = quiz.questions.slice(0, 8); quiz.questionCount = 8
    await assert.rejects(f.publish(content), (e: unknown) => e instanceof CourseDraftError && e.code === 'QuestionCountInvalid')
  })
  it('race giữa chừng: Admin mở trình sửa khi chưa có lượt, học viên bắt đầu làm trước lúc cập nhật → tự chuyển thành lịch tháng sau', async () => {
    const free = courseFixture()
    let content = free.content()
    free.lessonDraft(content).questionCount = 20
    assert.deepEqual((await free.publish(content)).scheduledUpdates, [])
    assert.deepEqual([free.quiz.question_count, free.quiz.scheduled_question_count], [20, null], 'không có lượt: áp dụng ngay')

    const raced = courseFixture()
    content = raced.content()
    raced.lessonDraft(content).questionCount = 20
    raced.attempts.push(attempt('IN_PROGRESS', NOW)) // learner started after the editor loaded
    const { scheduledUpdates } = await raced.publish(content)
    assert.deepEqual([raced.quiz.question_count, raced.quiz.scheduled_question_count], [10, 20])
    assert.deepEqual(scheduledUpdates.map(u => [u.assessmentId, u.currentQuestionCount, u.questionCount, u.effectiveAt]), [[QUIZ, 10, 20, NEXT_MONTH.toISOString()]])
  })
})

describe('hẹn cấu hình tháng sau cho bài thi cuối khóa', () => {
  it('đã có lượt làm: hẹn số câu mới, không tạo phiên bản đề và không đổi cấu hình hiện hành', async () => {
    const f = courseFixture({ final: {} })
    f.attempts.push(attempt('AUTO_SUBMITTED', vn('2026-11-02T08:00:00'), FINAL))
    const content = f.content()
    content.finalAssessment!.questionCount = 15
    const { scheduledUpdates } = await f.publish(content)
    assert.deepEqual([f.final.question_count, f.final.scheduled_question_count, f.final.scheduled_duration_minutes], [10, 15, 60])
    assert.ok(!f.writes.some(w => w.table === 'finalExamVersion' || (w.table === 'question' && w.op === 'createMany')), 'không tạo FinalExamVersion giữa tháng')
    assert.deepEqual(scheduledUpdates.map(u => [u.type, u.questionCount]), [['COURSE_FINAL', 15]])
  })
  it('chặn khi ngân hàng không đủ cho số câu hẹn tháng sau, thông báo rõ và gợi ý', async () => {
    const f = courseFixture({ final: {} })
    f.attempts.push(attempt('SUBMITTED', NOW, FINAL))
    const content = f.content()
    content.finalAssessment!.questionCount = 40
    await assert.rejects(f.publish(content), (e: any) => {
      assert.ok(e instanceof FinalExamBankTooSmall)
      assert.deepEqual([e.requested, e.available, e.scheduled], [40, 30, true])
      assert.match(e.message, /tháng sau/); assert.match(e.message, /không quá 30 câu/)
      assert.equal(finalExamBankError(e)?.error.scheduled, true)
      return true
    })
  })
  it('kiểm tra sức chứa xét cả số câu hiện hành và số câu hẹn', async () => {
    const tx = (available: number, final: any) => ({ question: { count: async () => available }, assessment: { findUnique: async () => final } }) as any
    await assertFinalExamBankCapacity(tx(30, { question_count: 10, scheduled_question_count: 30 }), COURSE)
    await assert.rejects(assertFinalExamBankCapacity(tx(9, { question_count: 10, scheduled_question_count: 5 }), COURSE), (e: any) => e.scheduled === false && e.requested === 10)
    await assert.rejects(assertFinalExamBankCapacity(tx(20, { question_count: 10, scheduled_question_count: 30 }), COURSE), (e: any) => e.scheduled === true && e.requested === 30 && e.available === 20)
  })
})

/** Minimal DB for the scheduler: transactions run one at a time, like rows locked FOR UPDATE. */
function scheduleDb() {
  const lessonQuestion = (i: number, archived = false) => ({ id: qid(i), assessment_id: QUIZ, question_text: `Câu ${i}`, question_type: 'SINGLE_CHOICE', points: 1, sort_order: i, explanation: null, archived_at: archived ? NOW : null })
  const state = {
    assessments: [
      { id: QUIZ, type: 'LESSON', course_id: null, lesson_course: COURSE, title: 'Quiz', description: null, question_count: 10, duration_minutes: 30, created_by: ACTOR, ...scheduleColumns({ count: 20, duration: 45 }), scheduled_by_user_id: ACTOR, scheduled_at: NOW },
      { id: FINAL, type: 'COURSE_FINAL', course_id: COURSE, lesson_course: null, title: 'Thi cuối khóa', description: null, question_count: 2, duration_minutes: 60, created_by: ACTOR, ...scheduleColumns({ count: 3, duration: 90 }), scheduled_by_user_id: ACTOR, scheduled_at: NOW },
    ] as any[],
    questions: [lessonQuestion(1), lessonQuestion(2), lessonQuestion(3), lessonQuestion(4), lessonQuestion(5, true)] as any[],
    options: [] as any[],
    versions: [{ id: uid(7), assessment_id: FINAL, version_number: 1, is_active: true, question_count: 2, duration_minutes: 60 }] as any[],
    attempts: [{ assessment_id: QUIZ, status: 'IN_PROGRESS', started_at: vn('2026-11-30T23:50:00'), expires_at: vn('2026-12-01T00:20:00') }] as Attempt[],
  }
  for (const q of state.questions) state.options.push({ id: `${q.id}-a`, question_id: q.id, option_text: 'Đúng', is_correct: true, sort_order: 0 }, { id: `${q.id}-b`, question_id: q.id, option_text: 'Sai', is_correct: false, sort_order: 1 })
  const owned = (a: any, courseId: string) => a.course_id === courseId || a.lesson_course === courseId
  const activeLessonQuestions = (where: any) => state.questions.filter(q => {
    const a = state.assessments.find(row => row.id === q.assessment_id)
    return (where.archived_at !== null || !q.archived_at) && a?.type === 'LESSON' && a.lesson_course === where.assessment.lesson.session.course_id
  })
  let queue: Promise<unknown> = Promise.resolve()
  const client: any = {
    $queryRaw: async () => [],
    assessment: {
      findMany: async ({ where }: any) => state.assessments.filter(a => a.scheduled_effective_at && a.scheduled_effective_at <= where.scheduled_effective_at.lte
        && (!where.id || (typeof where.id === 'string' ? a.id === where.id : where.id.in.includes(a.id)))
        && (!where.OR || where.OR.some((c: any) => owned(a, c.course_id ?? c.lesson.session.course_id))))
        .map(a => ({ ...a, lesson: a.lesson_course ? { session: { course_id: a.lesson_course } } : null })),
      update: async ({ where, data }: any) => Object.assign(state.assessments.find(a => a.id === where.id), data),
      upsert: async ({ where, update }: any) => Object.assign(state.assessments.find(a => a.course_id === where.course_id), update),
    },
    question: {
      count: async ({ where }: any) => activeLessonQuestions(where).length,
      findMany: async ({ where }: any) => activeLessonQuestions(where).map(q => ({ ...q, options: state.options.filter(o => o.question_id === q.id) })),
      createMany: async ({ data }: any) => { state.questions.push(...data) },
    },
    questionOption: { createMany: async ({ data }: any) => { state.options.push(...data) } },
    finalExamVersion: {
      findFirst: async ({ where }: any) => state.versions.filter(v => v.assessment_id === where.assessment_id).sort((a, b) => b.version_number - a.version_number)[0] ?? null,
      updateMany: async ({ where, data }: any) => { for (const v of state.versions.filter(v => v.assessment_id === where.assessment_id && v.is_active === where.is_active)) Object.assign(v, data) },
      create: async ({ data }: any) => { const v = { id: uid(800 + state.versions.length), ...data }; state.versions.push(v); return v },
    },
    $transaction: (fn: (tx: any) => Promise<unknown>) => { const run = queue.then(() => fn(client)); queue = run.catch(() => {}); return run },
  }
  return { state, client, quiz: () => state.assessments[0], final: () => state.assessments[1] }
}

describe('tự áp dụng lịch tháng sau: cron và lazy-apply', () => {
  it('23:59:59 ngày cuối tháng giờ VN chưa áp dụng gì', async () => {
    const db = scheduleDb()
    assert.deepEqual(await applyDueAssessmentSchedules(db.client, { now: vn('2026-11-30T23:59:59') }), { appliedCount: 0, appliedAssessmentIds: [] })
    assert.deepEqual([db.quiz().question_count, db.state.versions.length], [10, 1])
  })
  it('00:00:00 ngày 1: cron và lazy-apply chạy đồng thời chỉ áp dụng đúng một lần; bài cuối khóa có phiên bản đề mới', async () => {
    const db = scheduleDb()
    const at = vn('2026-12-01T00:00:00')
    const crossing = { ...db.state.attempts[0] }
    const results = await Promise.all([
      applyDueAssessmentSchedules(db.client, { now: at }),
      applyDueAssessmentSchedules(db.client, { assessmentId: QUIZ, now: at }),
      applyDueAssessmentSchedules(db.client, { courseId: COURSE, now: at }),
    ])
    assert.deepEqual(results.flatMap(r => r.appliedAssessmentIds).sort(), [QUIZ, FINAL].sort())
    assert.equal(results.reduce((sum, r) => sum + r.appliedCount, 0), 2)
    const quiz = db.quiz(), final = db.final()
    assert.deepEqual([quiz.question_count, quiz.duration_minutes, quiz.scheduled_question_count, quiz.scheduled_effective_at, quiz.scheduled_by_user_id], [20, 45, null, null, null])
    assert.deepEqual([final.question_count, final.duration_minutes, final.scheduled_question_count, final.scheduled_effective_at], [3, 90, null, null])
    const active = db.state.versions.filter(v => v.is_active)
    assert.deepEqual(active.map(v => [v.version_number, v.question_count, v.duration_minutes]), [[2, 3, 90]])
    assert.equal(db.state.questions.filter(q => q.final_exam_version_id === active[0].id).length, 4, 'phiên bản mới chỉ lấy câu đang hoạt động, bỏ câu đã lưu trữ')
    assert.deepEqual(db.state.attempts[0], crossing, 'lượt đang làm vắt qua nửa đêm không bị đổi')
    assert.deepEqual(await applyDueAssessmentSchedules(db.client, { now: vn('2026-12-01T00:05:00') }), { appliedCount: 0, appliedAssessmentIds: [] })
  })
  it('cron gọi applyDueAssessmentSchedules và trả assessmentSchedulesApplied', async () => {
    const restore = stubModules({
      '../lib/chapter-reorganizations': { applyDueChapterReorganizations: async () => 0 },
      '../lib/learning-outbox': { processLearningOutbox: async () => ({}) },
      '../lib/account-retirement': { retireInactiveAccounts: async () => 0 },
      '../lib/competition-snapshots': { closeCompetitionMonths: async () => 0, completePendingCompetitionKpis: async () => 0, closeCompetitionTerms: async () => 0 },
      '../lib/dna-cycle-resets': { applyDueDnaCycleResets: async () => 0 },
      '../lib/assessment-schedule': { applyDueAssessmentSchedules: async () => ({ appliedCount: 2, appliedAssessmentIds: [QUIZ, FINAL] }) },
    })
    process.env.CRON_SECRET = 'cron-secret'
    try {
      const cron = require('../app/api/internal/organization/reorganizations/apply/route')
      const response = await cron.GET(new NextRequest('http://localhost/api/internal', { headers: { authorization: 'Bearer cron-secret' } }))
      assert.equal(response.status, 200)
      assert.deepEqual((await response.json()).assessmentSchedulesApplied, { appliedCount: 2, appliedAssessmentIds: [QUIZ, FINAL] })
    } finally { restore() }
  })
})

/** Replaces modules for routes required inside the callback's test, then restores the cache entries. */
function stubModules(stubs: Record<string, unknown>) {
  const saved: [string, NodeModule | undefined][] = []
  for (const [path, exports] of Object.entries(stubs)) {
    const resolved = require.resolve(path)
    saved.push([resolved, require.cache[resolved]])
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports } as NodeModule
  }
  return () => { for (const [resolved, module] of saved) { if (module) require.cache[resolved] = module; else delete require.cache[resolved] } }
}

describe('GET /api/v1/courses/[courseId]/questions', () => {
  let role = 'MEMBER', calls = 0, select: any = null
  const prisma = {
    assessment: { findMany: async () => { calls++; return [] } },
    attempt: { findMany: async () => [{ assessment_id: QUIZ }] },
    course: { findUnique: async (args: any) => { calls++; select = args.select; return {
      id: COURSE, title: 'Khóa học', status: 'DRAFT', final_assessment: null,
      sessions: [{ id: SESSION, title: 'Buổi 1', sort_order: 0, lessons: [{ id: LESSON, title: 'Bài 1', sort_order: 0, assessment: {
        id: QUIZ, title: 'Quiz', question_count: 10, duration_minutes: 30, ...scheduleColumns({ count: 20, duration: 30 }),
        question_pools: [], questions: [{ id: qid(1), question_text: 'Câu 1', question_type: 'SINGLE_CHOICE', points: 1, sort_order: 0, pool_id: null, explanation: null, options: [] }],
      } }] }],
    } } },
  }
  const load = () => {
    const restore = stubModules({ '../lib/auth': { authenticate: async () => ({ ok: true, context: { userId: ACTOR, role } }) }, '../lib/prisma': { prisma } })
    try { return require('../app/api/v1/courses/[courseId]/questions/route') } finally { restore() }
  }
  const call = (route: any) => route.GET(new NextRequest(`http://localhost/api/v1/courses/${COURSE}/questions`), { params: { courseId: COURSE } })
  it('không phải ADMIN nhận 403 AccessDenied và không đọc ngân hàng câu hỏi', async () => {
    const route = load()
    for (const denied of ['MEMBER', 'LEAD', 'CHAPTER_MANAGER']) {
      role = denied
      const response = await call(route)
      assert.equal(response.status, 403)
      assert.equal((await response.json()).error.code, 'AccessDenied')
    }
    assert.equal(calls, 0)
  })
  it('ADMIN nhận toàn bộ câu đang hoạt động kèm trạng thái khóa tháng và lịch tháng sau', async () => {
    const route = load()
    role = 'ADMIN'
    const response = await call(route)
    assert.equal(response.status, 200)
    assert.deepEqual(select.sessions.select.lessons.select.assessment.select.questions.where, { archived_at: null })
    const quiz = (await response.json()).sessions[0].lessons[0].assessment
    assert.deepEqual([quiz.hasCurrentMonthAttempts, quiz.scheduledConfig.questionCount, quiz.scheduledConfig.effectiveMonthKey, quiz.questions.length], [true, 20, '2026-12', 1])
  })
})
