import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/v1/assessments/{assessmentId}
 * Get detail (Admin/Leader/Member with rules)
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

  const assessment = await prisma.assessment.findUnique({
    where: { id: assessmentId },
    include: {
      questions: {
        include: { options: { orderBy: { sort_order: 'asc' } } },
        orderBy: { sort_order: 'asc' },
      },
    },
  })
  if (!assessment) return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Bài kiểm tra không tồn tại' } }, { status: 404 })

  // Only MEMBER hides correct answers and explanations; Admin and Chapter Leader can see full answer keys
  const hideCorrect = (auth as any).context!.role === 'MEMBER'

  return NextResponse.json({
    assessmentId: assessment.id,
    id: assessment.id,
    lessonId: assessment.lesson_id,
    title: assessment.title,
    description: assessment.description,
    questionCount: assessment.questions.length,
    questions: assessment.questions.map((q) => ({
      questionId: q.id,
      id: q.id,
      questionText: q.question_text,
      type: q.question_type,
      points: Number(q.points),
      durationSeconds: q.duration_seconds,
      sortOrder: q.sort_order,
      ...(!hideCorrect ? { explanation: q.explanation || '' } : {}),
      options: q.options.map((o) => ({
        optionId: o.id,
        id: o.id,
        optionText: o.option_text,
        ...(!hideCorrect ? { isCorrect: o.is_correct } : {}),
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

  const body = await request.json()
  const { title, description, questions } = body || {}

  await prisma.$transaction(async (tx) => {
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
      if (questions.length === 0 || questions.length > 100) throw new Error('Cần 1-100 câu hỏi')

      // Pre-generate UUIDs for batch createMany
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

        return {
          question: {
            id: qId,
            assessment_id: assessmentId,
            question_text: String(q.questionText || q.text || `Câu hỏi ${idx + 1}`).trim(),
            question_type: (q.type || q.questionType || 'SINGLE_CHOICE') as any,
            points: Math.max(1, Number(q.points || 10)),
            duration_seconds: Math.max(10, Number(q.durationSeconds || q.duration_seconds || 120)),
            sort_order: Number(q.sortOrder ?? q.sort_order ?? idx),
            explanation: typeof q.explanation === 'string' && q.explanation.trim() ? q.explanation.trim() : null,
          },
          options,
        }
      })

      const allQuestionRows = preparedQuestions.map((p) => p.question)
      const allOptionRows = preparedQuestions.flatMap((p) => p.options)

      // 1. Delete all old questions & options
      await tx.questionOption.deleteMany({ where: { question: { assessment_id: assessmentId } } })
      await tx.question.deleteMany({ where: { assessment_id: assessmentId } })

      // 2. Batch insert questions & options (2 batch queries instead of ~25 individual roundtrips)
      await tx.question.createMany({ data: allQuestionRows })
      if (allOptionRows.length > 0) {
        await tx.questionOption.createMany({ data: allOptionRows })
      }
    }
  }, {
    timeout: 15000,
    maxWait: 5000,
  })

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
    select: { id: true, lesson_id: true },
  })
  if (!existing) {
    return NextResponse.json({ error: { code: 'AssessmentNotFound', message: 'Bài kiểm tra không tồn tại' } }, { status: 404 })
  }

  // Clean cascading deletion
  await prisma.$transaction(async (tx) => {
    // Delete attempt details first
    const attempts = await tx.attempt.findMany({
      where: { assessment_id: assessmentId },
      select: { id: true },
    })
    const attemptIds = attempts.map((a) => a.id)
    if (attemptIds.length > 0) {
      await tx.attemptAnswer.deleteMany({ where: { attempt_id: { in: attemptIds } } })
      await tx.attemptQuestion.deleteMany({ where: { attempt_id: { in: attemptIds } } })
      await tx.attempt.deleteMany({ where: { id: { in: attemptIds } } })
    }

    // Delete question options & questions
    await tx.questionOption.deleteMany({ where: { question: { assessment_id: assessmentId } } })
    await tx.question.deleteMany({ where: { assessment_id: assessmentId } })

    // Delete assessment
    await tx.assessment.delete({ where: { id: assessmentId } })
  }, {
    timeout: 15000,
    maxWait: 5000,
  })

  return NextResponse.json({
    success: true,
    message: 'Đã xóa bài kiểm tra thành công',
    assessmentId,
    lessonId: existing.lesson_id,
  })
}
