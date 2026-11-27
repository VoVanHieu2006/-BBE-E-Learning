import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCourseFinalProgression } from '@/lib/progression'
import { QUIZ_COOLDOWN_MINUTES, QUIZ_COOLDOWN_MS } from '@/lib/config/quiz'
import { guardCourseEditable, invalidateCourseContentCaches } from '@/lib/course-edit-guard'
import { currentCycleAttemptFilter } from '@/lib/learning-periods'
import { availableFinalQuestions, FinalExamBankTooSmall, finalExamBankError, lessonQuestionWhere, lockCourseExamBank } from '@/lib/final-exam-bank'
import { createFinalExamVersion } from '@/lib/final-exam-version'
import { applyDueAssessmentSchedules, CLEARED_ASSESSMENT_SCHEDULE, existingScheduleOf, hasCurrentMonthLockingAttempts, scheduleColumns, scheduledConfigOf } from '@/lib/assessment-schedule'
import { resolveAssessmentConfigUpdate } from '@/lib/quiz-schedule-rules'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const jsonError = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status })

/** Admin receives the authoring bank; learners receive only availability/results, never answer keys. */
export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  if (!UUID_REGEX.test(params.courseId)) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = (auth as any).context!.userId as string
  const role = (auth as any).context!.role as string

  const now = new Date()
  await applyDueAssessmentSchedules(prisma, { courseId: params.courseId, now })
  const course = await prisma.course.findUnique({
    where: { id: params.courseId },
    select: {
      id: true,
      title: true,
      status: true,
      final_assessment: {
        select: {
          id: true,
          course_id: true,
          title: true,
          description: true,
          question_count: true,
          duration_minutes: true,
          scheduled_question_count: true,
          scheduled_duration_minutes: true,
          scheduled_effective_at: true,
          scheduled_effective_month_key: true,
          _count: { select: { attempts: true, questions: true } },
        },
      },
    },
  })
  if (!course) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  if (role === 'ADMIN') {
    const finalAssessment = course.final_assessment
    const [availableQuestions, activeVersion, hasCurrentMonthAttempts] = await Promise.all([
      prisma.question.count({ where: lessonQuestionWhere(course.id) }),
      finalAssessment ? prisma.finalExamVersion.findFirst({ where: { assessment_id: finalAssessment.id, is_active: true }, select: { version_number: true, _count: { select: { questions: true } } } }) : null,
      finalAssessment ? hasCurrentMonthLockingAttempts(prisma, finalAssessment.id, now) : false,
    ])
    return NextResponse.json({
      courseId: course.id,
      courseTitle: course.title,
      assessment: finalAssessment ? {
        assessmentId: finalAssessment.id,
        id: finalAssessment.id,
        assessmentType: 'COURSE_FINAL',
        courseId: finalAssessment.course_id,
        title: finalAssessment.title,
        description: finalAssessment.description,
        questionCount: finalAssessment.question_count,
        durationMinutes: finalAssessment.duration_minutes,
        totalQuestionCount: activeVersion?._count.questions || 0,
        versionNumber: activeVersion?.version_number || null,
        hasCurrentMonthAttempts,
        scheduledConfig: scheduledConfigOf(finalAssessment),
      } : null,
      availableQuestions,
      attemptCount: finalAssessment?._count.attempts || 0,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  if (course.status !== 'PUBLISHED') return jsonError('CourseNotAvailable', 'Khóa học chưa được xuất bản.', 403)
  if (!course.final_assessment) return jsonError('FinalAssessmentNotFound', 'Khóa học chưa có bài thi cuối khóa.', 404)
  const activeVersion = await prisma.finalExamVersion.findFirst({
    where: { assessment_id: course.final_assessment.id, is_active: true },
    select: { id: true, version_number: true, question_count: true, _count: { select: { questions: true } } },
  })
  const bankReady = Boolean(activeVersion && activeVersion._count.questions >= activeVersion.question_count)
  const gate = await checkCourseFinalProgression(userId, course.id)
  const cycleFilter = await currentCycleAttemptFilter(prisma, userId)
  const [attempts, passingAttempt] = await Promise.all([
    prisma.attempt.findMany({
      where: { user_id: userId, assessment_id: course.final_assessment.id, ...cycleFilter },
      select: { id: true, attempt_number: true, status: true, score: true, passed: true, submitted_at: true, created_at: true, expires_at: true, final_exam_version: { select: { version_number: true, question_count: true } } },
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
    prisma.attempt.findFirst({
      where: { user_id: userId, assessment_id: course.final_assessment.id, ...cycleFilter, passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      select: { id: true },
    }),
  ])
  const latestCooldownAttempt = attempts.find((attempt) => ['SUBMITTED', 'AUTO_SUBMITTED', 'CANCELLED'].includes(attempt.status))
  const lastAttemptAt = latestCooldownAttempt?.submitted_at || latestCooldownAttempt?.created_at || null
  const cooldownUntil = lastAttemptAt && QUIZ_COOLDOWN_MS > 0
    ? new Date(new Date(lastAttemptAt).getTime() + QUIZ_COOLDOWN_MS)
    : null
  const cooldownRemainingMs = cooldownUntil ? Math.max(0, cooldownUntil.getTime() - Date.now()) : 0
  const resumableAttempt = attempts.find((attempt) => attempt.status === 'IN_PROGRESS' && attempt.expires_at > new Date())
  const gateReady = gate.ok === true || resumableAttempt
  return NextResponse.json({
    courseId: course.id,
    courseTitle: course.title,
    assessment: {
      assessmentId: course.final_assessment.id,
      id: course.final_assessment.id,
      assessmentType: 'COURSE_FINAL',
      title: course.final_assessment.title,
      description: course.final_assessment.description,
      questionCount: resumableAttempt?.final_exam_version?.question_count || course.final_assessment.question_count,
      durationMinutes: course.final_assessment.duration_minutes,
      totalQuestionCount: activeVersion?._count.questions || 0,
      versionNumber: resumableAttempt?.final_exam_version?.version_number || activeVersion?.version_number || null,
    },
    canStart: Boolean(resumableAttempt || (gateReady && bankReady && cooldownRemainingMs === 0)),
    gateReady,
    alreadyPassed: false,
    completionPassed: Boolean(passingAttempt),
    cooldownMinutes: QUIZ_COOLDOWN_MINUTES,
    cooldownUntil: cooldownUntil?.toISOString() || null,
    cooldownRemainingMs,
    gateCode: resumableAttempt ? null : gate.ok === true ? (!bankReady ? 'FinalExamBankTooSmall' : cooldownRemainingMs > 0 ? 'CooldownActive' : null) : gate.code,
    gateMessage: resumableAttempt ? null : gate.ok === true
      ? (!bankReady ? 'Bài thi cuối khóa đang được quản trị viên bổ sung câu hỏi.' : cooldownRemainingMs > 0 ? `Bạn cần đợi ${QUIZ_COOLDOWN_MINUTES} phút giữa các lần làm bài.` : null)
      : gate.message,
    attempts: attempts.map((attempt) => ({
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      versionNumber: attempt.final_exam_version?.version_number || null,
      status: attempt.status,
      score: attempt.score === null ? null : Math.round(Number(attempt.score) * 100),
      passed: attempt.passed,
      submittedAt: attempt.submitted_at || attempt.created_at,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

/** Publish a new immutable question-bank version while retaining prior attempts. */
export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  if (!UUID_REGEX.test(params.courseId)) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return jsonError('AccessDenied', 'Chỉ Admin được cấu hình bài thi cuối khóa.', 403)
  const course = await prisma.course.findUnique({ where: { id: params.courseId }, select: { id: true } })
  if (!course) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const blocked = await guardCourseEditable(course.id)
  if (blocked) return blocked

  const body = await request.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const questionCount = Number(body?.questionCount ?? 10)
  const durationMinutes = Number(body?.durationMinutes ?? 30)
  if (title.length < 2 || title.length > 255) return jsonError('ValidationError', 'Tiêu đề phải dài từ 2 đến 255 ký tự.', 400)
  if (!Number.isInteger(questionCount) || questionCount < 1 || !Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240) {
    return jsonError('ValidationError', 'Số câu mỗi lượt phải là số nguyên dương; thời gian từ 1 đến 240 phút.', 400)
  }
  const optionalInteger = (value: unknown, max: number) => value === undefined || value === null ? null : Number.isInteger(value) && Number(value) >= 1 && Number(value) <= max ? Number(value) : NaN
  const scheduledQuestionCount = optionalInteger(body?.scheduledQuestionCount, 10000)
  const scheduledDurationMinutes = optionalInteger(body?.scheduledDurationMinutes, 240)
  if (Number.isNaN(scheduledQuestionCount) || Number.isNaN(scheduledDurationMinutes) || (body?.cancelSchedule !== undefined && typeof body.cancelSchedule !== 'boolean')) {
    return jsonError('ValidationError', 'Lịch tháng sau không hợp lệ: số câu hoặc thời gian (1–240 phút).', 400)
  }
  const actor = (auth as any).context!.userId as string
  await applyDueAssessmentSchedules(prisma, { courseId: course.id })
  try {
    const result = await prisma.$transaction(async (tx) => {
      await lockCourseExamBank(tx, course.id)
      const now = new Date()
      const existing = await tx.assessment.findUnique({ where: { course_id: course.id } })
      if (!existing || !await hasCurrentMonthLockingAttempts(tx, existing.id, now)) {
        const created = await createFinalExamVersion(tx, course.id, { title, description: description || null, questionCount, durationMinutes }, actor)
        if (existing?.scheduled_effective_at) await tx.assessment.update({ where: { id: existing.id }, data: { ...CLEARED_ASSESSMENT_SCHEDULE } })
        return { assessmentId: created.assessment.id, versionNumber: created.version.version_number, availableQuestions: created.availableQuestions, questionCount, durationMinutes, schedule: null, scheduled: false }
      }
      // This month already has attempts: the active count/duration stay; the requested change waits for 00:00 1st next month VN.
      const config = resolveAssessmentConfigUpdate({
        current: { questionCount: existing.question_count, durationMinutes: existing.duration_minutes }, existingSchedule: existingScheduleOf(existing),
        requested: { questionCount, durationMinutes, scheduledQuestionCount, scheduledDurationMinutes, cancelSchedule: body?.cancelSchedule === true },
        hasCurrentMonthLockingAttempts: true, now,
      })
      const availableQuestions = await availableFinalQuestions(tx, course.id)
      if (config.schedule && config.schedule.questionCount > availableQuestions) throw new FinalExamBankTooSmall(config.schedule.questionCount, availableQuestions, true)
      const republish = config.scheduleAction === 'KEEP' || title !== existing.title || (description || null) !== existing.description
      const created = republish
        ? await createFinalExamVersion(tx, course.id, { title, description: description || null, questionCount: config.questionCount, durationMinutes: config.durationMinutes }, actor)
        : null
      const columns = scheduleColumns(config, actor, now)
      if (Object.keys(columns).length) await tx.assessment.update({ where: { id: existing.id }, data: columns })
      const active = created?.version ?? await tx.finalExamVersion.findFirst({ where: { assessment_id: existing.id, is_active: true }, select: { version_number: true } })
      return { assessmentId: existing.id, versionNumber: active?.version_number ?? null, availableQuestions, questionCount: config.questionCount, durationMinutes: config.durationMinutes, schedule: config.schedule, scheduled: config.wasScheduled }
    }, { timeout: 30000, maxWait: 5000 })
    invalidateCourseContentCaches(course.id)
    const scheduledConfig = result.schedule && { questionCount: result.schedule.questionCount, durationMinutes: result.schedule.durationMinutes, effectiveAt: result.schedule.effectiveAt.toISOString(), effectiveMonthKey: result.schedule.effectiveMonthKey }
    return NextResponse.json({ assessmentId: result.assessmentId, id: result.assessmentId, assessmentType: 'COURSE_FINAL', courseId: course.id, title, description: description || null, questionCount: result.questionCount, durationMinutes: result.durationMinutes, availableQuestions: result.availableQuestions, versionNumber: result.versionNumber, scheduled: result.scheduled, scheduledConfig }, { status: 200 })
  } catch (error) {
    const bankError = finalExamBankError(error)
    if (bankError) return NextResponse.json(bankError, { status: 409 })
    if (error instanceof Error && error.message === 'InvalidFinalExamSourceQuestion') return jsonError('InvalidFinalExamSourceQuestion', 'Có câu hỏi nguồn thiếu đáp án hợp lệ.', 400)
    throw error
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { courseId: string } }) {
  if (!UUID_REGEX.test(params.courseId)) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return jsonError('AccessDenied', 'Chỉ Admin được xóa bài thi cuối khóa.', 403)
  const blockedDelete = await guardCourseEditable(params.courseId)
  if (blockedDelete) return blockedDelete
  const result = await prisma.$transaction(async (tx) => {
    await lockCourseExamBank(tx, params.courseId)
    const existing = await tx.assessment.findUnique({ where: { course_id: params.courseId }, select: { id: true, _count: { select: { attempts: true } } } })
    if (!existing) return { code: 'FinalAssessmentNotFound' as const }
    if (existing._count.attempts) return { code: 'AssessmentVersionRequired' as const }
    await tx.assessment.delete({ where: { id: existing.id } })
    return { id: existing.id }
  })
  if ('code' in result) return result.code === 'FinalAssessmentNotFound'
    ? jsonError(result.code, 'Khóa học chưa có bài thi cuối khóa.', 404)
    : jsonError(result.code!, 'Không thể xóa bài thi đã có attempt; lịch sử phải được bảo toàn.', 409)
  invalidateCourseContentCaches(params.courseId)
  return NextResponse.json({ success: true, assessmentId: result.id, assessmentType: 'COURSE_FINAL' })
}
