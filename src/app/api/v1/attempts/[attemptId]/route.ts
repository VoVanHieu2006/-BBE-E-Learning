import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { QUIZ_PASS_PERCENT } from '@/lib/config/quiz'
import { gradeQuizAttempt, GradingQuestion } from '@/lib/quiz-attempt-rules'

export async function GET(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== (auth as any).context!.userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  if (attempt.status !== 'SUBMITTED' && attempt.status !== 'AUTO_SUBMITTED') {
    return NextResponse.json({ error: { code: 'AttemptNotSubmitted', message: 'Attempt has not been submitted' } }, { status: 400 })
  }

  const [allAttemptQuestions, answers] = await Promise.all([
    prisma.attemptQuestion.findMany({
      where: { attempt_id: params.attemptId },
      include: { question: { include: { options: true } } },
      orderBy: { display_order: 'asc' },
    }),
    prisma.attemptAnswer.findMany({ where: { attempt_id: params.attemptId } }),
  ])

  const grading = attempt.grading_snapshot ? attempt.grading_snapshot as unknown as ReturnType<typeof gradeQuizAttempt> : gradeQuizAttempt(
    allAttemptQuestions.map((attemptQuestion) => attemptQuestion.question_snapshot ? attemptQuestion.question_snapshot as unknown as GradingQuestion : ({
      id: attemptQuestion.question_id,
      points: Number(attemptQuestion.question.points || 1),
      explanation: attemptQuestion.question.explanation,
      options: attemptQuestion.question.options.map((option) => ({
        id: option.id,
        text: option.option_text,
        correct: option.is_correct,
      })),
    })),
    answers.map((answer) => ({
      questionId: answer.question_id,
      selectedOptionId: answer.selected_option_id,
    })),
    QUIZ_PASS_PERCENT / 100,
  )
  const passed = attempt.passed === true
  const answerResults = grading.results.map((result) => ({
    questionId: result.questionId,
    isCorrect: result.isCorrect,
    selectedOptionId: result.selectedOptionId,
    ...(passed ? {
      correctOptionId: result.correctOptionId,
      explanation: result.explanation,
    } : {}),
  }))

  return NextResponse.json({
    attemptId: attempt.id,
    score: attempt.score === null ? 0 : Number(attempt.score) * 100,
    passed,
    answers: answerResults,
  })
}

/** Cancel an in-progress attempt. */
export async function DELETE(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== (auth as any).context!.userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (attempt.status !== 'IN_PROGRESS') return NextResponse.json({ error: { code: 'AttemptNotInProgress' } }, { status: 400 })

  const updated = await prisma.attempt.update({
    where: { id: params.attemptId },
    data: { status: 'CANCELLED', submitted_at: new Date() },
  })

  return NextResponse.json({
    attemptId: updated.id,
    status: 'CANCELLED',
    message: 'Attempt cancelled successfully. Retry is available after 24 hours.',
  }, { status: 200 })
}
