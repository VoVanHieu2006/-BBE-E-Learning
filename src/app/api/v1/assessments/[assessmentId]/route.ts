import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/v1/assessments/{assessmentId}
 * Get detail (Admin/Leader/Member with rules)
 */
export async function GET(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request).catch(() => ({ ok: false, error: { code: 'UNAUTHORIZED' } }))
  if (!auth.ok) {
    return NextResponse.json({ error: { code: 'Unauthorized' } }, { status: 401 })
  }

  const assessment = await prisma.assessment.findUnique({
    where: { id: params.assessmentId },
    include: {
      questions: {
        include: { options: { orderBy: { id: 'asc' } } },
        orderBy: { id: 'asc' },
      },
    },
  })
  if (!assessment) return NextResponse.json({ error: { code: 'AssessmentNotFound' } }, { status: 404 })

  // Only MEMBER hides correct answers; Admin and Chapter Leader can see full answer keys
  const hideCorrect = (auth as any).context!.role === 'MEMBER'

  return NextResponse.json({
    assessmentId: assessment.id,
    lessonId: assessment.lesson_id,
    title: assessment.title,
    description: assessment.description,
    questionCount: assessment.questions.length,
    questions: assessment.questions.map((q) => ({
      questionId: q.id,
      questionText: q.question_text,
      type: q.question_type,
      points: Number(q.points),
      options: q.options.map((o) => ({
        optionId: o.id,
        optionText: o.option_text,
        ...(hideCorrect ? {} : { isCorrect: o.is_correct }),
      })),
    })),
  })
}

/**
 * PATCH /api/v1/assessments/{assessmentId}
 * Update assessment (Admin only)
 */
export async function PATCH(request: NextRequest, { params }: { params: { assessmentId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  if ((auth as any).context!.role !== 'ADMIN') return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const existing = await prisma.assessment.findUnique({ where: { id: params.assessmentId } })
  if (!existing) return NextResponse.json({ error: { code: 'AssessmentNotFound' } }, { status: 404 })

  const body = await request.json()
  const { title, description, questions } = body || {}

  await prisma.$transaction(async (tx) => {
    if (title || description !== undefined) {
      await tx.assessment.update({
        where: { id: params.assessmentId },
        data: {
          ...(title ? { title: String(title).trim() } : {}),
          ...(description !== undefined ? { description: description?.trim() || null } : {}),
        },
      })
    }

    if (Array.isArray(questions)) {
      if (questions.length === 0 || questions.length > 50) throw new Error('Cần 1-50 câu hỏi')
      // Delete all old questions (cascade options)
      await tx.questionOption.deleteMany({ where: { question: { assessment_id: params.assessmentId } } })
      await tx.question.deleteMany({ where: { assessment_id: params.assessmentId } })

      for (const q of questions) {
        await tx.question.create({
          data: {
            assessment_id: params.assessmentId,
            question_text: String(q.questionText || q.text || '').trim(),
            question_type: (q.type || 'SINGLE_CHOICE').toUpperCase(),
            points: Math.max(1, Number(q.points || 1)),
            duration_seconds: Math.max(30, Number(q.durationSeconds || q.duration_seconds || 120)),
            sort_order: Number(q.sortOrder || q.sort_order || 0),
            options: {
              create: (q.options || []).map((opt: any) => ({
                option_text: String(opt.optionText || opt.text || '').trim(),
                is_correct: Boolean(opt.isCorrect || false),
                sort_order: Number(opt.sortOrder || opt.sort_order || 0),
              })),
            },
          },
        })
      }
    }
  })

  return NextResponse.json({
    assessmentId: params.assessmentId,
    questionCount: Array.isArray(questions) ? questions.length : 0,
  })
}
