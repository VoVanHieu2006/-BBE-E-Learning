import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { checkCourseFinalProgression } from '@/lib/progression'
import { QUIZ_COOLDOWN_HOURS, QUIZ_COOLDOWN_MS } from '@/lib/config/quiz'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const jsonError = (code: string, message: string, status: number) =>
  NextResponse.json({ error: { code, message } }, { status })

function formatAssessment(assessment: any) {
  return {
    assessmentId: assessment.id,
    id: assessment.id,
    assessmentType: 'COURSE_FINAL',
    courseId: assessment.course_id,
    title: assessment.title,
    description: assessment.description,
    questionCount: assessment.questions.length,
    pools: assessment.question_pools?.map((pool: any) => ({ poolId: pool.id, name: pool.name, sortOrder: pool.sort_order })) || [],
    questions: assessment.questions.map((question: any) => ({
      questionId: question.id,
      id: question.id,
      questionText: question.question_text,
      type: question.question_type,
      points: Number(question.points),
      durationSeconds: question.duration_seconds,
      sortOrder: question.sort_order,
      poolId: question.pool_id,
      explanation: question.explanation || '',
      options: question.options.map((option: any) => ({
        optionId: option.id,
        id: option.id,
        optionText: option.option_text,
        isCorrect: option.is_correct,
      })),
    })),
  }
}

/** Admin receives the authoring bank; learners receive only availability/results, never answer keys. */
export async function GET(request: NextRequest, { params }: { params: { courseId: string } }) {
  if (!UUID_REGEX.test(params.courseId)) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const userId = (auth as any).context!.userId as string
  const role = (auth as any).context!.role as string

  const course = await prisma.course.findUnique({
    where: { id: params.courseId },
    select: {
      id: true,
      title: true,
      status: true,
      final_assessment: {
        include: {
          question_pools: { orderBy: { sort_order: 'asc' } },
          questions: { include: { options: { orderBy: { sort_order: 'asc' } } }, orderBy: { sort_order: 'asc' } },
          _count: { select: { attempts: true, questions: true } },
        },
      },
    },
  })
  if (!course) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  if (role === 'ADMIN') {
    return NextResponse.json({
      courseId: course.id,
      courseTitle: course.title,
      assessment: course.final_assessment ? formatAssessment(course.final_assessment) : null,
      attemptCount: course.final_assessment?._count.attempts || 0,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  if (course.status !== 'PUBLISHED') return jsonError('CourseNotAvailable', 'Khóa học chưa được công khai.', 403)
  if (!course.final_assessment) return jsonError('FinalAssessmentNotFound', 'Khóa học chưa có bài thi cuối khóa.', 404)
  const gate = await checkCourseFinalProgression(userId, course.id)
  const [attempts, passingAttempt] = await Promise.all([
    prisma.attempt.findMany({
      where: { user_id: userId, assessment_id: course.final_assessment.id },
      select: { id: true, attempt_number: true, status: true, score: true, passed: true, submitted_at: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 20,
    }),
    prisma.attempt.findFirst({
      where: { user_id: userId, assessment_id: course.final_assessment.id, passed: true, status: { in: ['SUBMITTED', 'AUTO_SUBMITTED'] } },
      select: { id: true },
    }),
  ])
  const latestCooldownAttempt = attempts.find((attempt) => ['SUBMITTED', 'AUTO_SUBMITTED', 'CANCELLED'].includes(attempt.status))
  const lastAttemptAt = latestCooldownAttempt?.submitted_at || latestCooldownAttempt?.created_at || null
  const cooldownUntil = lastAttemptAt && QUIZ_COOLDOWN_MS > 0
    ? new Date(new Date(lastAttemptAt).getTime() + QUIZ_COOLDOWN_MS)
    : null
  const cooldownRemainingMs = cooldownUntil ? Math.max(0, cooldownUntil.getTime() - Date.now()) : 0
  const gateReady = gate.ok === true
  return NextResponse.json({
    courseId: course.id,
    courseTitle: course.title,
    assessment: {
      assessmentId: course.final_assessment.id,
      id: course.final_assessment.id,
      assessmentType: 'COURSE_FINAL',
      title: course.final_assessment.title,
      description: course.final_assessment.description,
      questionCount: course.final_assessment._count.questions,
    },
    canStart: gateReady && !passingAttempt && cooldownRemainingMs === 0,
    gateReady,
    alreadyPassed: Boolean(passingAttempt),
    cooldownHours: QUIZ_COOLDOWN_HOURS,
    cooldownUntil: cooldownUntil?.toISOString() || null,
    cooldownRemainingMs,
    gateCode: passingAttempt ? 'AssessmentAlreadyPassed' : gate.ok === true
      ? (cooldownRemainingMs > 0 ? 'CooldownActive' : null)
      : gate.code,
    gateMessage: passingAttempt
      ? 'Bạn đã đạt bài thi cuối khóa; chứng nhận và Star chỉ được ghi nhận một lần.'
      : gate.ok === true
        ? (cooldownRemainingMs > 0 ? `Bạn cần đợi ${QUIZ_COOLDOWN_HOURS} giờ giữa các lần làm bài.` : null)
        : gate.message,
    attempts: attempts.map((attempt) => ({
      attemptId: attempt.id,
      attemptNumber: attempt.attempt_number,
      status: attempt.status,
      score: attempt.score === null ? null : Math.round(Number(attempt.score) * 100),
      passed: attempt.passed,
      submittedAt: attempt.submitted_at || attempt.created_at,
    })),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}

/** Create or replace a course-final exam. Existing attempts make the exam immutable. */
export async function POST(request: NextRequest, { params }: { params: { courseId: string } }) {
  if (!UUID_REGEX.test(params.courseId)) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return jsonError('AccessDenied', 'Chỉ Admin được cấu hình bài thi cuối khóa.', 403)
  const course = await prisma.course.findUnique({ where: { id: params.courseId }, select: { id: true } })
  if (!course) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)

  const body = await request.json().catch(() => null)
  const title = typeof body?.title === 'string' ? body.title.trim() : ''
  const description = typeof body?.description === 'string' ? body.description.trim() : ''
  const questions = body?.questions
  const pools = body?.pools
  if (title.length < 2 || title.length > 255) return jsonError('ValidationError', 'Tiêu đề phải dài từ 2 đến 255 ký tự.', 400)
  if (!Array.isArray(questions) || questions.length < 15 || questions.length > 100) {
    return jsonError('ValidationError', 'Bài thi cuối khóa cần 15–100 câu hỏi để đủ 5 pool, mỗi pool tối thiểu 3 câu.', 400)
  }
  if (!Array.isArray(pools) || pools.length !== 5 || pools.some((name: unknown) => typeof name !== 'string' || !name.trim())) {
    return jsonError('ValidationError', 'Bài thi cần đúng 5 pool có tên.', 400)
  }
  const poolCounts = [0, 0, 0, 0, 0]
  for (let index = 0; index < questions.length; index++) {
    const question = questions[index]
    const poolIndex = Number(question?.poolIndex)
    if (!Number.isInteger(poolIndex) || poolIndex < 0 || poolIndex > 4) return jsonError('ValidationError', `Câu ${index + 1} chưa thuộc một trong 5 pool.`, 400)
    poolCounts[poolIndex]++
    const questionText = typeof question?.questionText === 'string' ? question.questionText.trim() : ''
    const options = question?.options
    if (!questionText || !Array.isArray(options) || options.length < 2 || options.length > 8) {
      return jsonError('ValidationError', `Câu ${index + 1} cần nội dung và từ 2 đến 8 lựa chọn.`, 400)
    }
    const correctCount = options.filter((option: any) => Boolean(option?.isCorrect)).length
    const type = question?.questionType || question?.type || 'SINGLE_CHOICE'
    if (!['SINGLE_CHOICE', 'MULTIPLE_CHOICE'].includes(type) || correctCount < 1 || (type === 'SINGLE_CHOICE' && correctCount !== 1)) {
      return jsonError('ValidationError', `Câu ${index + 1} có loại câu hỏi hoặc đáp án đúng không hợp lệ.`, 400)
    }
    if (options.some((option: any) => typeof option?.optionText !== 'string' || !option.optionText.trim())) {
      return jsonError('ValidationError', `Câu ${index + 1} có lựa chọn trống.`, 400)
    }
  }
  if (poolCounts.some((count) => count < 3)) return jsonError('QuestionPoolIncomplete', 'Mỗi pool cần tối thiểu 3 câu hỏi.', 400)

  const existing = await prisma.assessment.findUnique({ where: { course_id: course.id }, select: { id: true, _count: { select: { attempts: true } } } })
  if (existing?._count.attempts) return jsonError('AssessmentVersionRequired', 'Bài thi đã có attempt; hãy giữ nguyên đề thi để bảo toàn lịch sử.', 409)

  const assessmentId = crypto.randomUUID()
  const preparedPools = pools.map((name: string, sort_order: number) => ({ id: crypto.randomUUID(), assessment_id: assessmentId, name: name.trim(), sort_order }))
  const preparedQuestions = questions.map((question: any, sort_order: number) => {
    const questionId = crypto.randomUUID()
    return {
      row: {
        id: questionId,
        assessment_id: assessmentId,
        question_text: question.questionText.trim(),
        question_type: (question.questionType || question.type || 'SINGLE_CHOICE') as any,
        points: Math.max(1, Math.min(1000, Number.parseInt(String(question.points), 10) || 10)),
        duration_seconds: Math.max(10, Math.min(3600, Number.parseInt(String(question.durationSeconds), 10) || 120)),
        sort_order,
        explanation: typeof question.explanation === 'string' && question.explanation.trim() ? question.explanation.trim() : null,
        pool_id: preparedPools[Number(question.poolIndex)].id,
      },
      options: question.options.map((option: any, optionOrder: number) => ({
        id: crypto.randomUUID(), question_id: questionId, option_text: option.optionText.trim(),
        is_correct: Boolean(option.isCorrect), sort_order: optionOrder,
      })),
    }
  })

  await prisma.$transaction(async (tx) => {
    if (existing) await tx.assessment.delete({ where: { id: existing.id } })
    await tx.assessment.create({
      data: {
        id: assessmentId,
        type: 'COURSE_FINAL',
        course_id: course.id,
        lesson_id: null,
        title,
        description: description || null,
        created_by: (auth as any).context!.userId,
      },
    })
    await tx.questionPool.createMany({ data: preparedPools })
    await tx.question.createMany({ data: preparedQuestions.map(({ row }) => row) })
    await tx.questionOption.createMany({ data: preparedQuestions.flatMap(({ options }) => options) })
    await tx.userLearningAssignment.updateMany({
      where: { course_id: course.id, ended_at: null, status: 'COMPLETED' },
      data: { status: 'IN_PROGRESS', completed_at: null },
    })
  }, { timeout: 15000, maxWait: 5000 })

  return NextResponse.json({
    assessmentId, id: assessmentId, assessmentType: 'COURSE_FINAL', courseId: course.id,
    title, description: description || null, questionCount: questions.length,
  }, { status: 201 })
}

export async function DELETE(request: NextRequest, { params }: { params: { courseId: string } }) {
  if (!UUID_REGEX.test(params.courseId)) return jsonError('CourseNotFound', 'Khóa học không tồn tại.', 404)
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return jsonError('AccessDenied', 'Chỉ Admin được xóa bài thi cuối khóa.', 403)
  const existing = await prisma.assessment.findUnique({ where: { course_id: params.courseId }, select: { id: true, _count: { select: { attempts: true } } } })
  if (!existing) return jsonError('FinalAssessmentNotFound', 'Khóa học chưa có bài thi cuối khóa.', 404)
  if (existing._count.attempts) return jsonError('AssessmentVersionRequired', 'Không thể xóa bài thi đã có attempt; lịch sử phải được bảo toàn.', 409)
  await prisma.assessment.delete({ where: { id: existing.id } })
  return NextResponse.json({ success: true, assessmentId: existing.id, assessmentType: 'COURSE_FINAL' })
}
