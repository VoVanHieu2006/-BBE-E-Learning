import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { submitQuiz } from '@/lib/quiz-submission'

export async function POST(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })
  const body = await request.json().catch(() => ({}))
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      ('answers' in body && (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)))) {
    return NextResponse.json({ error: { code: 'ValidationError' } }, { status: 400 })
  }
  const result = await submitQuiz({ attemptId: params.attemptId, userId: auth.context!.userId, answers: body.answers })
  if ('error' in result) return NextResponse.json({ error: { code: result.error } }, {
    status: result.error === 'AttemptNotFound' ? 404 : result.error === 'AccessDenied' ? 403 : 409,
  })
  const { grading, amount, rewardKey, balance } = result
  ;(globalThis as any).__bbeLearningMeCache?.delete(auth.context!.userId)
  return NextResponse.json({
    attemptId: params.attemptId, score: Math.round(grading.score), totalPoints: grading.totalPoints,
    scorePercent: Math.round(grading.scoreRatio * 100), passed: grading.passed,
    starReward: { awarded: amount > 0, amount, rewardKey: rewardKey || null, balance: balance || 0 },
    answers: grading.results.map((row) => ({
      questionId: row.questionId, isCorrect: row.isCorrect, selectedOptionId: row.selectedOptionId,
      ...(grading.passed ? { correctOptionId: row.correctOptionId, explanation: row.explanation } : {}),
    })),
  })
}
