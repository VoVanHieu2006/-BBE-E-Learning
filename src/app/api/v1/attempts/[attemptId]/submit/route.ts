import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/v1/attempts/{attemptId}/submit
 * Submit attempt — BR-04 (passed=true → full results; passed=false → chỉ đúng/sai, không lộ đáp án)
 */
export async function POST(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const userId = (auth as any).context!.userId

  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (attempt.status !== 'IN_PROGRESS') return NextResponse.json({ error: { code: 'AttemptNotInProgress' } }, { status: 400 })

  // Calculate score
  const answers = await prisma.attemptAnswer.findMany({
    where: { attempt_id: params.attemptId },
    include: { question: true },
  })

  const allQuestions = await prisma.attemptQuestion.findMany({
    where: { attempt_id: params.attemptId },
    include: { question: true },
  })

  let totalPoints = 0
  let score = 0
  for (const q of allQuestions) {
    totalPoints += Number(q.question.points || 1)
  }

  for (const ans of answers) {
    const option = await prisma.questionOption.findUnique({ where: { id: ans.selected_option_id || '' } })
    if (option && option.is_correct) {
      score += Number(ans.question.points || 1)
    }
  }

  const passed = totalPoints > 0 ? (score / totalPoints) >= 0.85 : false

  await prisma.attempt.update({
    where: { id: params.attemptId },
    data: { status: 'SUBMITTED', submitted_at: new Date(), score: score / totalPoints, passed },
  })

  // For response: always return isCorrect per question
  // If passed=false, we still return isCorrect but NO explanation (BR-04: không lộ đáp án đúng)
  const resultAnswers = await Promise.all(
    answers.map(async (a) => {
      const option = await prisma.questionOption.findUnique({ where: { id: a.selected_option_id || '' }, include: { question: { include: { options: true } } } })
      const isCorrect = option?.is_correct || false
      const correctOption = option?.question.options.find(o => o.is_correct) || null
      return {
        questionId: a.question_id,
        isCorrect,
        selectedOptionId: a.selected_option_id,
        ...(passed ? {
          correctOptionId: correctOption?.id || null,
          // Ưu tiên explanation do Admin nhập cho từng câu hỏi (BR-04: chỉ hiện khi passed)
          explanation: option?.question?.explanation || (correctOption ? `Đáp án đúng: ${correctOption.option_text}` : null),
        } : {}),
      }
    })
  )

  return NextResponse.json({
    attemptId: attempt.id,
    score: Math.round(score),
    totalPoints,
    passed,
    answers: resultAnswers,
  })
}
