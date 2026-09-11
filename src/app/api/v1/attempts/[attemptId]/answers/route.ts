import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/v1/attempts/{attemptId}/answers
 * Save answers (single or batch) — BR-04
 */
export async function POST(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId

  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound', message: 'Attempt không tồn tại' } }, { status: 404 })
  if (attempt.user_id !== userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (attempt.status !== 'IN_PROGRESS') return NextResponse.json({ error: { code: 'AttemptNotInProgress', message: 'Attempt không còn trong tiến trình' } }, { status: 400 })
  if (new Date() > attempt.expires_at) return NextResponse.json({ error: { code: 'AttemptExpired', message: 'Đã hết giờ' } }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  const { questionId, selectedOptionId, answers } = body || {}

  // Case 1: Batch answers { answers: { [qId]: optionId } }
  if (answers && typeof answers === 'object') {
    const validEntries = Object.entries(answers).filter(
      ([_, optId]) => typeof optId === 'string' && optId
    ) as [string, string][]

    if (validEntries.length > 0) {
      const optIds = Array.from(new Set(validEntries.map(([_, optId]) => optId)))
      const options = await prisma.questionOption.findMany({
        where: { id: { in: optIds } },
        select: { id: true, is_correct: true },
      })
      const optMap = new Map(options.map((o) => [o.id, o.is_correct]))

      await Promise.all(
        validEntries.map(([qId, optId]) => {
          const isCorrect = optMap.get(optId) || false
          return prisma.attemptAnswer.upsert({
            where: { attempt_id_question_id: { attempt_id: params.attemptId, question_id: qId } },
            create: {
              attempt_id: params.attemptId,
              question_id: qId,
              selected_option_id: optId,
              is_correct: isCorrect,
              answered_at: new Date(),
            },
            update: {
              selected_option_id: optId,
              is_correct: isCorrect,
              answered_at: new Date(),
            },
          })
        })
      )
    }
    return NextResponse.json({ saved: true, count: validEntries.length })
  }

  // Case 2: Single answer { questionId, selectedOptionId }
  if (!questionId || !selectedOptionId) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'questionId và selectedOptionId bắt buộc' } }, { status: 400 })
  }

  const option = await prisma.questionOption.findUnique({ where: { id: selectedOptionId } })

  await prisma.attemptAnswer.upsert({
    where: { attempt_id_question_id: { attempt_id: params.attemptId, question_id: questionId } },
    create: {
      attempt_id: params.attemptId,
      question_id: questionId,
      selected_option_id: selectedOptionId,
      is_correct: option?.is_correct || false,
      answered_at: new Date(),
    },
    update: {
      selected_option_id: selectedOptionId,
      is_correct: option?.is_correct || false,
      answered_at: new Date(),
    },
  })

  return NextResponse.json({ questionId, saved: true })
}
