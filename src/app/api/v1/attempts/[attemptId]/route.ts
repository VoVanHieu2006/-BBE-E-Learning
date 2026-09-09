import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== (auth as any).context!.userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })

  const status = attempt.status
  if (status !== 'SUBMITTED' && status !== 'AUTO_SUBMITTED') return NextResponse.json({ error: { code: 'AttemptNotSubmitted', message: 'Chưa nộp bài' } }, { status: 400 })

  const allAttemptQuestions = await prisma.attemptQuestion.findMany({
    where: { attempt_id: params.attemptId },
    include: { question: { include: { options: true } } },
    orderBy: { display_order: 'asc' },
  })

  const answers = await prisma.attemptAnswer.findMany({
    where: { attempt_id: params.attemptId },
    include: { question: true, selected_option: true },
  })

  const passed = attempt.passed || false

  const answerResults = allAttemptQuestions.map((aq) => {
    const ans = answers.find((a) => a.question_id === aq.question_id)
    const isCorrect = ans?.is_correct || (ans?.selected_option?.is_correct || false)
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
    score: attempt.score ? Number(attempt.score) * 100 : 0,
    passed,
    answers: answerResults,
  })
}

/**
 * DELETE /api/v1/attempts/{attemptId}
 * Cancel an in-progress attempt (BR-04: không tính vào lịch sử điểm, sau 24h mới được làm lại)
 */
export async function DELETE(request: NextRequest, { params }: { params: { attemptId: string } }) {
  const auth = await authenticate(request)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: 401 })

  const attempt = await prisma.attempt.findUnique({ where: { id: params.attemptId } })
  if (!attempt) return NextResponse.json({ error: { code: 'AttemptNotFound' } }, { status: 404 })
  if (attempt.user_id !== (auth as any).context!.userId) return NextResponse.json({ error: { code: 'AccessDenied' } }, { status: 403 })
  if (attempt.status !== 'IN_PROGRESS') return NextResponse.json({ error: { code: 'AttemptNotInProgress', message: 'Chỉ có thể hủy bài đang trong tiến trình' } }, { status: 400 })

  const updated = await prisma.attempt.update({
    where: { id: params.attemptId },
    data: {
      status: 'CANCELLED',
      submitted_at: new Date(),
    },
  })

  return NextResponse.json({
    attemptId: updated.id,
    status: 'CANCELLED',
    message: 'Đã hủy bài làm thành công. Bạn cần đợi 24 giờ để bắt đầu lượt mới.',
  }, { status: 200 })
}

