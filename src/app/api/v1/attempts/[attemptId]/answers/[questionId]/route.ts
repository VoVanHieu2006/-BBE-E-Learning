import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * PUT /api/v1/attempts/{attemptId}/answers/{questionId}
 * Save answer (upsert) — BR-04
 */
export async function PUT(request: NextRequest, { params }: { params: { attemptId: string; questionId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId

  // Get attempt
  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound', message: 'Attempt không tồn tại' } }, { status: 404 })
  if (attempt.user_id !== userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (attempt.status !== 'IN_PROGRESS') return NextResponse.json({ error: { code: 'AttemptNotInProgress', message: 'Attempt không còn trong tiến trình' } }, { status: 400 })
  if (new Date() > attempt.expires_at) return NextResponse.json({ error: { code: 'AttemptExpired', message: 'Đã hết giờ' } }, { status: 400 })

  // Check question belongs to this attempt
  const aq = await prisma.attemptQuestion.findUnique({ where: { attempt_id_question_id: { attempt_id: params.attemptId, question_id: params.questionId } } })
  if (!aq) return NextResponse.json({ error: { code: 'QuestionNotInAttempt', message: 'Câu hỏi không thuộc attempt này' } }, { status: 400 })

  const body = await request.json()
  const { selectedOptionId } = body || {}

  if (!selectedOptionId) return NextResponse.json({ error: { code: 'ValidationError', message: 'selectedOptionId bắt buộc' } }, { status: 400 })

  // Upsert answer (no is_correct calculation here — server time is final)
  await prisma.attemptAnswer.upsert({
    where: { attempt_id_question_id: { attempt_id: params.attemptId, question_id: params.questionId } },
    create: { attempt_id: params.attemptId, question_id: params.questionId, selected_option_id: selectedOptionId },
    update: { selected_option_id: selectedOptionId },
  })

  return NextResponse.json({ questionId: params.questionId, saved: true })
}
