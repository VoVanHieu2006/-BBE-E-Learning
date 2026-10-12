import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { validateAttemptAnswerSelections } from '@/lib/quiz-attempt-rules'

/** Save a single answer or a batch, validating every question/option pair. */
export async function POST(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId
  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (attempt.status !== 'IN_PROGRESS') return NextResponse.json({ error: { code: 'AttemptNotInProgress' } }, { status: 400 })
  if (new Date() >= attempt.expires_at) return NextResponse.json({ error: { code: 'AttemptExpired' } }, { status: 400 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'Request body must be an object' } }, { status: 400 })
  }

  const answerBody = body as Record<string, unknown>
  const isBatch = Object.prototype.hasOwnProperty.call(answerBody, 'answers')
  if (isBatch && (!answerBody.answers || typeof answerBody.answers !== 'object' || Array.isArray(answerBody.answers))) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'answers must be an object keyed by questionId' } }, { status: 400 })
  }
  if (!isBatch && (typeof answerBody.questionId !== 'string' || !answerBody.questionId || typeof answerBody.selectedOptionId !== 'string' || !answerBody.selectedOptionId)) {
    return NextResponse.json({ error: { code: 'ValidationError', message: 'questionId and selectedOptionId are required' } }, { status: 400 })
  }

  const entries: Array<[string, unknown]> = isBatch
    ? Object.entries(answerBody.answers as Record<string, unknown>)
    : [[answerBody.questionId as string, answerBody.selectedOptionId]]
  const optionIds = Array.from(new Set(entries
    .map(([, optionId]) => optionId)
    .filter((optionId): optionId is string => typeof optionId === 'string' && optionId.length > 0)))

  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM attempts WHERE id = ${params.attemptId}::uuid FOR UPDATE`
    const currentAttempt = await tx.attempt.findUnique({
      where: { id: params.attemptId },
      select: { user_id: true, status: true, expires_at: true },
    })
    if (!currentAttempt || currentAttempt.user_id !== userId || currentAttempt.status !== 'IN_PROGRESS' || currentAttempt.expires_at <= new Date()) {
      return { error: 'AttemptNotWritable' as const }
    }

    const attemptQuestions = await tx.attemptQuestion.findMany({
      where: { attempt_id: params.attemptId },
      select: { question_id: true },
    })
    const options = optionIds.length > 0
      ? await tx.questionOption.findMany({
          where: { id: { in: optionIds } },
          select: { id: true, question_id: true, is_correct: true },
        })
      : []
    const optionById = new Map(options.map((option) => [option.id, option]))
    const validation = validateAttemptAnswerSelections(
      attemptQuestions.map(({ question_id }) => question_id),
      new Map(options.map(({ id, question_id }) => [id, question_id])),
      entries,
    )
    if (validation.ok === false) return { error: validation.code }

    const answeredAt = new Date()
    await Promise.all(validation.answers.map(({ questionId, selectedOptionId }) => {
      const option = optionById.get(selectedOptionId)!
      return tx.attemptAnswer.upsert({
        where: { attempt_id_question_id: { attempt_id: params.attemptId, question_id: questionId } },
        create: {
          attempt_id: params.attemptId,
          question_id: questionId,
          selected_option_id: selectedOptionId,
          is_correct: option.is_correct,
          answered_at: answeredAt,
        },
        update: {
          selected_option_id: selectedOptionId,
          is_correct: option.is_correct,
          answered_at: answeredAt,
        },
      })
    }))

    return { savedCount: validation.answers.length }
  })

  if ('error' in result) {
    return NextResponse.json({
      error: {
        code: result.error,
        message: result.error === 'AttemptNotWritable'
          ? 'Attempt is no longer writable'
          : 'An answer refers to a question or option outside this attempt',
      },
    }, { status: 400 })
  }

  return NextResponse.json(isBatch
    ? { saved: true, count: result.savedCount }
    : { questionId: entries[0][0], saved: true })
}
