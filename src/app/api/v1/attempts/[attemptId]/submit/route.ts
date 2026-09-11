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

  const body = await request.json().catch(() => ({}))
  const clientAnswers = body?.answers || {}

  // Upsert any answers submitted in body with batch lookup to eliminate N+1
  if (clientAnswers && typeof clientAnswers === 'object') {
    const validEntries = Object.entries(clientAnswers).filter(
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
  }

  // Calculate score concurrently
  const [answers, allQuestions] = await Promise.all([
    prisma.attemptAnswer.findMany({
      where: { attempt_id: params.attemptId },
      include: { question: true, selected_option: true },
    }),
    prisma.attemptQuestion.findMany({
      where: { attempt_id: params.attemptId },
      include: { question: { include: { options: true } } },
      orderBy: { display_order: 'asc' },
    }),
  ])

  let totalPoints = 0
  let score = 0
  for (const q of allQuestions) {
    totalPoints += Number(q.question.points || 1)
  }

  for (const ans of answers) {
    const isCorrect = ans.selected_option?.is_correct || false
    if (isCorrect) {
      score += Number(ans.question.points || 1)
    }
  }

  const scoreRatio = totalPoints > 0 ? score / totalPoints : 0
  const passed = scoreRatio >= 0.85

  // Atomic conditional update — chỉ update nếu attempt vẫn còn IN_PROGRESS
  // Ngăn chặn race condition (TOCTOU) khi nhiều requests nộp bài cùng lúc
  const updateResult = await prisma.attempt.updateMany({
    where: {
      id: params.attemptId,
      status: 'IN_PROGRESS', // Atomic guard
    },
    data: { status: 'SUBMITTED', submitted_at: new Date(), score: scoreRatio, passed },
  })

  if (updateResult.count === 0) {
    return NextResponse.json(
      { error: { code: 'AttemptNotInProgress', message: 'Bài thi đã được nộp từ trước hoặc không còn hiệu lực' } },
      { status: 400 }
    )
  }

  // If passed, auto-complete the lesson associated with this assessment
  if (passed) {
    const assess = await prisma.assessment.findUnique({
      where: { id: attempt.assessment_id },
      select: { lesson_id: true },
    })
    if (assess?.lesson_id) {
      await prisma.lessonProgress.upsert({
        where: {
          user_id_lesson_id: {
            user_id: userId,
            lesson_id: assess.lesson_id,
          },
        },
        create: {
          user_id: userId,
          lesson_id: assess.lesson_id,
          completed: true,
          completed_at: new Date(),
        },
        update: {
          completed: true,
          completed_at: new Date(),
        },
      })
    }
  }

  // For response: return all attempt questions in order
  const resultAnswers = allQuestions.map((aq) => {
    const ans = answers.find((a) => a.question_id === aq.question_id)
    const isCorrect = ans?.selected_option?.is_correct || false
    const correctOption = aq.question.options.find((o) => o.is_correct) || null

    return {
      questionId: aq.question_id,
      isCorrect,
      selectedOptionId: ans?.selected_option_id || null,
      ...(passed ? {
        correctOptionId: correctOption?.id || null,
        explanation: aq.question.explanation || (correctOption ? `Đáp án đúng: ${correctOption.option_text}` : null),
      } : {}),
    }
  })

  return NextResponse.json({
    attemptId: attempt.id,
    score: Math.round(score),
    scorePercent: Math.round(scoreRatio * 100),
    totalPoints,
    passed,
    answers: resultAnswers,
  })
}
