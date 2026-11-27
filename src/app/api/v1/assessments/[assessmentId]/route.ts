import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authenticate } from '@/lib/auth'
import { guardCourseEditableByAssessment, invalidateCourseContentCaches } from '@/lib/course-edit-guard'
import { prisma } from '@/lib/prisma'
import { assertFinalExamBankCapacity, finalExamBankError, lockCourseExamBank } from '@/lib/final-exam-bank'
import { applyDueAssessmentSchedules, hasCurrentMonthLockingAttempts, scheduledConfigOf } from '@/lib/assessment-schedule'
import { MAX_LESSON_QUIZ_QUESTIONS, validateLessonBankForCounts } from '@/lib/quiz-schedule-rules'
import { CourseDraftError } from '@/lib/course-draft'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/v1/assessments/{assessmentId}
 * Get question-bank detail for Admin authoring only. Learners receive the
 * sampled question set through an individual attempt, never the whole bank.
 */
export async function GET(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const { assessmentId } = params
  if (!UUID_REGEX.test(assessmentId)) {
    return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Bài kiểm tra không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED' } }))
  if (!auth.ok) {
    return NextResponse.json({ error: { code: 'Unauthorized' } }, { status: 401 })
  }
  const userRole = (auth as any).context!.role
  if (userRole !== 'ADMIN') {
    return NextResponse.json(
      { error: { code: 'AccessDenied', message: 'Bạn không có quyền xem ngân hàng câu hỏi.' } },
      { status: 403 },
    )
  }

  const now = new Date()
  await applyDueAssessmentSchedules(prisma, { assessmentId, now })
  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: {
      question_pools: { orderBy: { sort_order: 'asc' } },
      questions: {
        where: { archived_at: null },
        include: { options: { orderBy: { sort_order: 'asc' } } },
        orderBy: { sort_order: 'asc' },
      },
    },
  })
  if (!assessment) return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Bài kiểm tra không tồn tại' } }, { status: 404 })
  if (assessment.type === 'COURSE_FINAL' && userRole !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Ngân hàng đề cuối khóa chỉ dành cho Admin.' } }, { status: 403 })
  }

  return NextResponse.json({
    assessmentId: assessment.id,
    id: assessment.id,
    lessonId: assessment.lesson_id,
    title: assessment.title,
    description: assessment.description,
    durationMinutes: assessment.duration_minutes,
    questionCount: assessment.questions.length,
    activeQuestionCount: assessment.question_count,
    hasCurrentMonthAttempts: await hasCurrentMonthLockingAttempts(prisma, assessment.id, now),
    scheduledConfig: scheduledConfigOf(assessment),
    pools: assessment.question_pools.map((pool) => ({ poolId: pool.id, name: pool.name, sortOrder: pool.sort_order })),
    questions: assessment.questions.map((q) => ({
      questionId: q.id,
      id: q.id,
      questionText: q.question_text,
      type: q.question_type,
      points: Number(q.points),
      sortOrder: q.sort_order,
      poolId: q.pool_id,
      explanation: q.explanation || '',
      options: q.options.map((o) => ({
        optionId: o.id,
        id: o.id,
        optionText: o.option_text,
        isCorrect: o.is_correct,
      })),
    })),
  })
}

/**
 * PATCH /api/v1/assessments/{assessmentId}
 * Update assessment (Admin only)
 * OPTIMIZED: Batch inserts using createMany for questions & options (Audit #1)
 */
export async function PATCH(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const { assessmentId } = params
  if (!UUID_REGEX.test(assessmentId)) {
    return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Bài kiểm tra không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền cập nhật' } }, { status: 403 })

  const existing = await prisma.assessment.findUnique({ where: { id: assessmentId } })
  if (!existing) return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Bài kiểm tra không tồn tại' } }, { status: 404 })
  if (existing.type === 'COURSE_FINAL') return NextResponse.json({ error: { code: 'UseFinalExamEditor', message: 'Hãy cập nhật bài thi cuối khóa tại trang cấu hình để tạo phiên bản mới.' } }, { status: 409 })
  const blocked = await guardCourseEditableByAssessment(assessmentId)
  if (blocked) return blocked
  const lesson = await prisma.lesson.findUnique({ where: { id: existing.lesson_id! }, select: { session: { select: { course_id: true } } } })
  if (!lesson) return NextResponse.json({ error: { code: 'LessonNotFound' } }, { status: 404 })
  const courseId = lesson.session.course_id

  const body = await request.json()
  const { title, description, questions } = body || {}
  await applyDueAssessmentSchedules(prisma, { assessmentId })

  try {
    await prisma.$transaction(async (tx) => {
      await lockCourseExamBank(tx, courseId)
    if (title || description !== undefined) {
      await tx.assessment.update({
        where: { id: assessmentId },
        data: {
          ...(title ? { title: String(title).trim() } : {}),
          ...(description !== undefined ? { description: description?.trim() || null } : {}),
        },
      })
    }

    if (Array.isArray(questions)) {
      if (questions.length === 0 || questions.length > MAX_LESSON_QUIZ_QUESTIONS) throw new Error(`Cần 1-${MAX_LESSON_QUIZ_QUESTIONS} câu hỏi`)

      // Loại câu hỏi Đúng/Sai đã ngừng sử dụng
      if (questions.some((q: any) => (q.questionType || q.type) === 'TRUE_FALSE')) {
        throw new Error('Loại câu hỏi "Đúng / Sai" đã ngừng sử dụng. Vui lòng dùng trắc nghiệm 1 hoặc nhiều đáp án.')
      }

      // Pre-generate UUIDs for batch createMany
      const poolIds = Array.from(new Set(questions.map((q: any) => q.poolId || q.pool_id).filter(Boolean))) as string[]
      if (poolIds.length) {
        const poolCount = await tx.questionPool.count({ where: { id: { in: poolIds }, assessment_id: assessmentId } })
        if (poolCount !== poolIds.length) throw new Error('Question pool does not belong to this assessment')
      }
      const preparedQuestions = questions.map((q: any, idx: number) => {
        const qId = crypto.randomUUID()
        const rawOptions = Array.isArray(q.options) ? q.options : []
        const options = rawOptions.map((opt: any, oIdx: number) => ({
          id: crypto.randomUUID(),
          question_id: qId,
          option_text: String(opt.optionText || opt.text || '').trim(),
          is_correct: Boolean(opt.isCorrect ?? opt.is_correct ?? false),
          sort_order: Number(opt.sortOrder ?? opt.sort_order ?? oIdx),
        }))
        if (options.length < 2 || !options.some((option: any) => option.is_correct)) throw new Error('InvalidQuestionOptions')

        return {
          question: {
            id: qId,
            assessment_id: assessmentId,
            question_text: String(q.questionText || q.text || `Câu hỏi ${idx + 1}`).trim(),
            question_type: (q.type || q.questionType || 'SINGLE_CHOICE') as any,
            points: Math.max(1, Number(q.points || 10)),
            sort_order: Number(q.sortOrder ?? q.sort_order ?? idx),
            explanation: typeof q.explanation === 'string' && q.explanation.trim() ? q.explanation.trim() : null,
            pool_id: q.poolId || q.pool_id || null,
          },
          options,
        }
      })

      const allQuestionRows = preparedQuestions.map((p) => p.question)
      const allOptionRows = preparedQuestions.flatMap((p) => p.options)

      // Dual budget: the new bank must serve this month's active count and any scheduled next-month count.
      const current = await tx.assessment.findUniqueOrThrow({ where: { id: assessmentId }, select: { question_count: true, scheduled_question_count: true, scheduled_effective_at: true, question_pools: { select: { id: true } } } })
      const bank = validateLessonBankForCounts({
        questionCount: current.question_count, scheduledQuestionCount: current.scheduled_effective_at ? current.scheduled_question_count : null,
        poolCounts: current.question_pools.map((pool) => allQuestionRows.filter((q) => q.pool_id === pool.id).length), totalQuestions: allQuestionRows.length,
      })
      if (bank.ok === false) throw new CourseDraftError(bank.code, bank.message, 400)

      // 1. Archive questions referenced by attempts (history keeps them); delete the unused ones with their options
      const now = new Date()
      const active = await tx.question.findMany({ where: { assessment_id: assessmentId, archived_at: null }, select: { id: true, _count: { select: { attempt_questions: true, attempt_answers: true } } } })
      const referenced = active.filter((q) => q._count.attempt_questions + q._count.attempt_answers > 0).map((q) => q.id)
      const unused = active.filter((q) => !referenced.includes(q.id)).map((q) => q.id)
      if (referenced.length) await tx.question.updateMany({ where: { id: { in: referenced } }, data: { archived_at: now, pool_id: null } })
      await tx.questionOption.deleteMany({ where: { question_id: { in: unused } } })
      await tx.question.deleteMany({ where: { id: { in: unused } } })

      // 2. Batch insert questions & options (2 batch queries instead of ~25 individual roundtrips)
      await tx.question.createMany({ data: allQuestionRows })
      if (allOptionRows.length > 0) {
        await tx.questionOption.createMany({ data: allOptionRows })
      }
      await assertFinalExamBankCapacity(tx, courseId)
    }
    }, { timeout: 15000, maxWait: 5000 })
  } catch (error) {
    const bankError = finalExamBankError(error)
    if (bankError) return NextResponse.json(bankError, { status: 409 })
    if (error instanceof Error && error.message === 'AssessmentVersionRequired') return NextResponse.json({ error: { code: 'AssessmentVersionRequired', message: 'Quiz đã có lượt làm; không thể thay đổi lịch sử.' } }, { status: 409 })
    if (error instanceof Error && error.message === 'InvalidQuestionOptions') return NextResponse.json({ error: { code: 'ValidationError', message: 'Mỗi câu hỏi cần ít nhất hai đáp án và một đáp án đúng.' } }, { status: 400 })
    if (error instanceof CourseDraftError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status })
    throw error
  }

  invalidateCourseContentCaches(courseId, existing.lesson_id || undefined)
  return NextResponse.json({
    assessmentId,
    questionCount: Array.isArray(questions) ? questions.length : 0,
  })
}

/**
 * DELETE /api/v1/assessments/{assessmentId}
 * Delete assessment and associated records (Admin only)
 */
export async function DELETE(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const { assessmentId } = params
  if (!UUID_REGEX.test(assessmentId)) {
    return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Bài kiểm tra không tồn tại' } }, { status: 404 })
  }

  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') {
    return NextResponse.json({ error: { code: 'AccessDenied', message: 'Chỉ Admin mới có quyền xóa bài kiểm tra' } }, { status: 403 })
  }

  const existing = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    select: { id: true, type: true, lesson_id: true, course_id: true, _count: { select: { attempts: true } } },
  })
  if (!existing) {
    return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Bài kiểm tra không tồn tại' } }, { status: 404 })
  }
  if (existing._count.attempts > 0) {
    return NextResponse.json({ error: { code: 'AssessmentVersionRequired', message: 'Không thể xóa bài thi đã có attempt; lịch sử và kết quả cần được bảo toàn.' } }, { status: 409 })
  }
  const blockedDelete = await guardCourseEditableByAssessment(assessmentId)
  if (blockedDelete) return blockedDelete

  // Child question/option rows cascade; no learner attempts are deleted.
  if (existing.type === 'LESSON' && existing.lesson_id) {
    const lesson = await prisma.lesson.findUnique({ where: { id: existing.lesson_id }, select: { session: { select: { course_id: true } } } })
    if (!lesson) return NextResponse.json({ error: { code: 'LessonNotFound' } }, { status: 404 })
    try {
      await prisma.$transaction(async (tx) => {
        await lockCourseExamBank(tx, lesson.session.course_id)
        if (await tx.attempt.count({ where: { assessment_id: assessmentId } })) throw new Error('AssessmentVersionRequired')
        await tx.assessment.delete({ where: { id: assessmentId } })
        await assertFinalExamBankCapacity(tx, lesson.session.course_id)
      })
    } catch (error) {
      const bankError = finalExamBankError(error)
      if (bankError) return NextResponse.json(bankError, { status: 409 })
      if (error instanceof Error && error.message === 'AssessmentVersionRequired') return NextResponse.json({ error: { code: 'AssessmentVersionRequired', message: 'Quiz đã có lượt làm; không thể xóa lịch sử.' } }, { status: 409 })
      throw error
    }
  } else await prisma.assessment.delete({ where: { id: assessmentId } })
  invalidateCourseContentCaches(existing.course_id || undefined, existing.lesson_id || undefined)

  return NextResponse.json({
    success: true,
    message: 'Đã xóa bài kiểm tra thành công',
    assessmentId,
    lessonId: existing.lesson_id,
    courseId: existing.course_id,
    assessmentType: existing.type,
  })
}
